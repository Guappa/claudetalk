import { describe, it, expect, beforeEach, vi } from "vitest";
import { actionId, askingSink, quietSink, recordingSink } from "./helpers/sinks.ts";
import { record, usage, wait } from "./helpers/records.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveClaudeBin,
  claudeProjectsDir,
  assertSpawnable,
  attachmentsRoot,
  expandShortPath,
  isWithin,
  longTmpDir,
  samePath,
  turnSpawnOptions,
} from "../src/platform.ts";
import { detectClaudeError } from "../src/claude/errors.ts";
import { buildOptions, bridgeSystemNote } from "../src/claude/runner.ts";
import { scanTranscript } from "../src/sessions/transcriptScanner.ts";
import { parseAgentsJson } from "../src/sessions/activeSessions.ts";
import { resolveByChannelName, resolveByFolder, resolveByName } from "../src/sessions/resolve.ts";
import { OutboxDelivery } from "../src/discord/outboxDelivery.ts";
import { randomUUID } from "node:crypto";
import { PENDING_TTL_MS, PendingCreates } from "../src/discord/pendingCreate.ts";
import { ConversationStore } from "../src/conversations.ts";
import { OperatorStore } from "../src/operators.ts";
import { loadConfig } from "../src/config.ts";
import { UsageLedger } from "../src/claude/usageLedger.ts";
import { PlanUsage, describePlanUsage, parsePlanUsage } from "../src/claude/planUsage.ts";
import { parseAuthStatus, SIGNED_OUT } from "../src/claude/auth.ts";
import { ApprovalPrompts, describeRequest } from "../src/discord/approvals.ts";
import { isFromGuild, isMessageInScope } from "../src/discord/gate.ts";
import { chunkForDiscord, shouldSpillToFile, DISCORD_MESSAGE_LIMIT } from "../src/discord/renderer.ts";
import {
  StatusMessage,
  formatElapsed,
  renderActivity,
  tickIntervalMs,
} from "../src/discord/statusMessage.ts";
import { describeStop, preflight } from "../src/discord/turnFlow.ts";
import { ContextTracker } from "../src/claude/contextTracker.ts";
import { classifyPrompt } from "../src/discord/commands/settings.ts";
import {
  describeHidden,
  formatSessionList,
  newestPerName,
  sessionChoice,
  humanSize,
  humanAge,
  withoutScratch,
} from "../src/discord/commands/sessionList.ts";
import { displayName } from "../src/sessions/displayName.ts";
import { toChannelName, fromChannelName } from "../src/discord/channelName.ts";
import { acquireInstanceLock, releaseInstanceLock, isLockHeld, STALE_AFTER_MS } from "../src/instanceLock.ts";
import {
  DISCORD_MENUS_PER_MESSAGE,
  describeSkillMenus,
  menuPlaceholder,
  parsePluginList,
  pluginSelectOptions,
  skillSelectMenus,
} from "../src/claude/pluginCatalog.ts";
import {
  PLUGIN_SELECT,
  PURGE_CANCEL,
  PURGE_CONFIRM,
  SKILL_SELECT,
  UNBIND_DELETE,
  UNBIND_KEEP,
  parseCustomId,
  pluginToggleId,
  skillSelectId,
} from "../src/discord/menus.ts";
import { describeDefault, parseHostDefaults } from "../src/claude/hostSettings.ts";
import { describePurge, isBulkDeletable, purgeChannel } from "../src/discord/purge.ts";
import { displayPath, redactHome } from "../src/displayPath.ts";
import {
  EMBED_DESCRIPTION_LIMIT,
  EMBED_FIELD_LIMIT,
  detail,
} from "../src/discord/embeds.ts";
import {
  CHANNELS_PER_CATEGORY,
  MAX_CATEGORY_NAME,
  describeCategoryFull,
  findCategory,
  normaliseCategoryName,
} from "../src/discord/category.ts";
import {
  requestStop,
  stopRequestPath,
  takeStopRequest,
  watchForStop,
} from "../src/stopSignal.ts";
import { forkName } from "../src/discord/commands/fork.ts";
import {
  addressesBot,
  addressesSomeoneElse,
  shouldQuoteReplied,
  type Addressing,
} from "../src/discord/addressing.ts";
import {
  ATTACHMENT_TTL_MS,
  MAX_ATTACHMENT_BYTES,
  describeRefused,
  describeUnfetched,
  downloadAttachments,
  extensionFor,
  isExpired,
  screenAttachments,
} from "../src/attachments.ts";
import { nothingToSend } from "../src/discord/handlers/message.ts";
import { TurnQueue, describeDepth, describeQueued, MAX_QUEUE_DEPTH } from "../src/discord/turnQueue.ts";
import {
  collectOutbox,
  describeSkipped,
  outboxPath,
  MAX_FILE_BYTES,
  MAX_FILES_PER_MESSAGE,
  OUTBOX_DIR,
  SETTLE_MS,
} from "../src/discord/outbox.ts";
import { readExchanges, lastExchanges, lastCompactionCeiling } from "../src/sessions/exchanges.ts";
import { formatExchanges, describeDrift } from "../src/discord/transcriptView.ts";
import {
  attributionOnly,
  buildContext,
  composePrompt,
  noContext,
  stripBotMention,
} from "../src/discord/context.ts";
import { bridgeCommandDefinitions } from "../src/discord/commands/registry.ts";
import { workingDirFor } from "../src/discord/policy.ts";
import { tierFor, canRunCommand, workspaceFor } from "../src/access.ts";
import { conversationOverwrites } from "../src/discord/channelAccess.ts";
import { PermissionFlagsBits } from "discord.js";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);

describe("platform", () => {
  it("prefers CLAUDE_BIN when set", () => {
    expect(resolveClaudeBin({ CLAUDE_BIN: "/opt/claude" })).toBe("/opt/claude");
  });

  it("finds a real executable rather than guessing a name", () => {
    const bin = resolveClaudeBin({});
    expect(bin.length).toBeGreaterThan(0);
    if (process.platform === "win32") expect(bin.toLowerCase()).not.toMatch(/\.(cmd|bat)$/);
  });

  it("rejects a script shim on Windows with an actionable message", () => {
    if (process.platform !== "win32") return;
    expect(() => assertSpawnable("C:/npm/claude.cmd")).toThrow(/CLAUDE_BIN/);
  });

  it("accepts a real executable", () => {
    expect(() => assertSpawnable("C:/Users/x/.local/bin/claude.exe")).not.toThrow();
  });

  it("resolves the projects directory under the user home", () => {
    expect(claudeProjectsDir()).toBe(path.join(os.homedir(), ".claude", "projects"));
  });
});

describe("detectClaudeError", () => {
  const busy =
    "Error: Session 11111111-2222-4333-8444-555555555555 is running as a background session (11111111). " +
    "Run `claude attach 11111111` to open it, or `claude stop 11111111` first to resume it here.";

  it("detects a busy session and extracts the short id", () => {
    const error = detectClaudeError(busy);
    expect(error?.kind).toBe("session-busy");
    expect(error?.kind === "session-busy" && error.shortId).toBe("11111111");
  });

  it("returns null for ordinary output", () => {
    expect(detectClaudeError("Done. The file was written.")).toBeNull();
  });

  it("returns null for output that merely mentions an error", () => {
    expect(detectClaudeError("I fixed the error in your test.")).toBeNull();
  });
});

describe("buildOptions", () => {
  const base = { sessionId: "abc-123", cwd: "/tmp/x", prompt: "hello", settings: {} };

  it("resumes an existing session", () => {
    const options = buildOptions({ ...base, resume: true });
    expect(options.resume).toBe("abc-123");
    expect(options.sessionId).toBeUndefined();
  });

  it("creates a new session under the id the bridge already bound, with a title", () => {
    const options = buildOptions({ ...base, resume: false, name: "Deploy Scripts" });
    expect(options.sessionId).toBe("abc-123");
    expect(options.title).toBe("Deploy Scripts");
    expect(options.resume).toBeUndefined();
  });

  it("forks only when asked, leaving the source session untouched", () => {
    expect(buildOptions({ ...base, resume: true }).forkSession).toBeUndefined();
    expect(buildOptions({ ...base, resume: true, fork: true }).forkSession).toBe(true);
  });

  it("bypasses permission prompts, since a hook is what gates a turn", () => {
    expect(buildOptions({ ...base, resume: true }).permissionMode).toBe("bypassPermissions");
  });

  it("omits the model when no override is set, preserving the session's own", () => {
    expect(buildOptions({ ...base, resume: true }).model).toBeUndefined();
  });

  it("passes bridge-owned settings as typed options", () => {
    const options = buildOptions({ ...base, resume: true, settings: { model: "opus", effort: "high" } });
    expect(options.model).toBe("opus");
    expect(options.effort).toBe("high");
  });

  // No typed option covers autocompact, so it has to keep reaching the flag it had before.
  it("still reaches autocompact through the escape hatch", () => {
    const options = buildOptions({ ...base, resume: true, settings: { autocompact: "false" } });
    expect(options.extraArgs).toEqual({ autocompact: "false" });
  });

  it("gates nothing unless the turn was given an approver", () => {
    expect(buildOptions({ ...base, resume: true }).hooks).toBeUndefined();
  });
});

describe("scanTranscript", () => {
  it("takes the last custom-title, not the first", async () => {
    expect((await scanTranscript(fixture("transcript-titled.jsonl"))).name).toBe("Server Notes");
  });

  it("reads cwd from inside the transcript", async () => {
    expect((await scanTranscript(fixture("transcript-titled.jsonl"))).cwd).toBe("/home/u/projects/deploy-scripts");
  });

  it("reports the last activity timestamp", async () => {
    const info = await scanTranscript(fixture("transcript-titled.jsonl"));
    expect(info.lastActivity?.toISOString()).toBe("2026-09-10T10:00:05.000Z");
  });

  it("marks a title-only stub as having no content", async () => {
    const info = await scanTranscript(fixture("transcript-stub.jsonl"));
    expect(info.name).toBe("Server Notes");
    expect(info.hasContent).toBe(false);
  });

  it("returns empty info for a missing file rather than throwing", async () => {
    expect(await scanTranscript(fixture("does-not-exist.jsonl"))).toEqual({
      name: null,
      cwd: null,
      lastActivity: null,
      hasContent: false,
    });
  });
});

describe("parseAgentsJson", () => {
  const raw = JSON.stringify([
    { pid: 1, cwd: "/a", kind: "interactive", sessionId: "s-a", name: "Release Notes", status: "idle" },
    { pid: 2, cwd: "/b", kind: "background", sessionId: "s-b", id: "11111111" },
  ]);

  it("keeps the background short id used by attach and stop", () => {
    expect(parseAgentsJson(raw).find((session) => session.kind === "background")?.id).toBe("11111111");
  });

  it("tolerates a background entry with no status yet", () => {
    expect(parseAgentsJson(raw).find((session) => session.kind === "background")?.status).toBeUndefined();
  });

  it("returns an empty list for unparseable output rather than throwing", () => {
    expect(parseAgentsJson("requires an interactive terminal")).toEqual([]);
  });
});


describe("resolveByName", () => {
  const records = [
    record({ sessionId: "a", name: "Release Notes", lastActivity: new Date("2026-09-12T22:51:00Z") }),
    record({ sessionId: "b", name: "Release Notes", lastActivity: new Date("2026-09-02T06:55:00Z") }),
    record({ sessionId: "c", name: "project-notes", lastActivity: new Date("2026-09-13T17:12:00Z") }),
  ];

  it("matches case-insensitively", () => {
    expect(resolveByName(records, "release notes").match?.sessionId).toBe("a");
  });

  it("prefers the most recently active on a duplicate name", () => {
    const resolution = resolveByName(records, "Release Notes");
    expect(resolution.match?.sessionId).toBe("a");
    expect(resolution.match && "shadowed" in resolution && resolution.shadowed.map((record) => record.sessionId)).toEqual(["b"]);
  });

  it("resolves a unique prefix", () => {
    expect(resolveByName(records, "proj").match?.sessionId).toBe("c");
  });

  it("returns candidates when a prefix spans different names", () => {
    const extra = [...records, record({ sessionId: "d", name: "project-other" })];
    const resolution = resolveByName(extra, "project");
    expect(resolution.match).toBeNull();
    expect(resolution.match === null && resolution.candidates).toHaveLength(2);
  });

  it("returns nothing for a name that does not exist", () => {
    const resolution = resolveByName(records, "zzzz");
    expect(resolution.match).toBeNull();
    expect(resolution.match === null && resolution.candidates).toHaveLength(0);
  });
});

describe("ConversationStore", () => {
  let file: string;

  beforeEach(async () => {
    file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "conv-")), "conversations.json");
  });

  const conversation = {
    sessionId: "s1",
    cwd: "/tmp",
    boundAt: "2026-09-13T00:00:00Z",
    settings: { model: "opus" },
    channels: { text: "c-text" },
    ownerId: "owner1",
    memberIds: [] as string[],
  };

  it("starts empty when the file does not exist", async () => {
    const store = new ConversationStore(file);
    await store.load();
    expect(store.byChannel("c-text")).toBeUndefined();
  });

  it("round-trips a conversation through disk", async () => {
    const first = new ConversationStore(file);
    await first.load();
    await first.bind("c-text", { ...conversation });

    const second = new ConversationStore(file);
    await second.load();
    expect(second.byChannel("c-text")?.sessionId).toBe("s1");
    expect(second.byChannel("c-text")?.settings.model).toBe("opus");
  });

  it("resolves a voice channel to the same conversation as its text channel", async () => {
    const store = new ConversationStore(file);
    await store.load();
    await store.bind("c-text", { ...conversation });
    await store.attachChannel("s1", "c-voice", "voice");

    expect(store.byChannel("c-voice")?.sessionId).toBe("s1");
    expect(store.byChannel("c-text")?.sessionId).toBe("s1");
    expect(store.bySession("s1")?.channels.voice).toBe("c-voice");
  });

  it("unbinding the voice channel leaves the conversation intact", async () => {
    const store = new ConversationStore(file);
    await store.load();
    await store.bind("c-text", { ...conversation });
    await store.attachChannel("s1", "c-voice", "voice");
    await store.unbind("c-voice");

    expect(store.byChannel("c-text")?.sessionId).toBe("s1");
    expect(store.byChannel("c-voice")).toBeUndefined();
  });

  it("unbinding the text channel drops the conversation", async () => {
    const store = new ConversationStore(file);
    await store.load();
    await store.bind("c-text", { ...conversation });
    await store.unbind("c-text");
    expect(store.bySession("s1")).toBeUndefined();
  });

  it("leaves no temp file behind after writing", async () => {
    const store = new ConversationStore(file);
    await store.load();
    await store.bind("c-text", { ...conversation });
    expect(await fs.readdir(path.dirname(file))).toEqual(["conversations.json"]);
  });
});

describe("loadConfig", () => {
  const valid = {
    DISCORD_BOT_TOKEN: "t",
    DISCORD_GUILD_ID: "g",
    DISCORD_OWNER_IDS: "100000000000000001,987654321098765432",
    PROJECTS_ROOT: "/home/u/projects",
  };

  it("parses a comma separated owner list", () => {
    expect(loadConfig(valid).ownerIds).toEqual(["100000000000000001", "987654321098765432"]);
  });

  it("names the missing variable when one is absent", () => {
    expect(() => loadConfig({ ...valid, DISCORD_BOT_TOKEN: undefined })).toThrow(/DISCORD_BOT_TOKEN/);
  });

  // Owners are the root of every access decision, so a bad list has to stop the bridge starting.
  it("refuses to start with no owner", () => {
    expect(() => loadConfig({ ...valid, DISCORD_OWNER_IDS: undefined })).toThrow(/DISCORD_OWNER_IDS/);
    expect(() => loadConfig({ ...valid, DISCORD_OWNER_IDS: " , " })).toThrow(/DISCORD_OWNER_IDS/);
  });

  it("refuses an owner id that is not a Discord id", () => {
    expect(() => loadConfig({ ...valid, DISCORD_OWNER_IDS: "not-a-snowflake" })).toThrow(/not a Discord user id/);
    expect(() => loadConfig({ ...valid, DISCORD_OWNER_IDS: "12345" })).toThrow(/not a Discord user id/);
  });

  it("names which entry is wrong when only one of several is", () => {
    const broken = { ...valid, DISCORD_OWNER_IDS: "100000000000000001,oops" };
    expect(() => loadConfig(broken)).toThrow(/oops/);
  });
});

describe("gate", () => {
  const config = { guildId: "g1" };

  it("accepts messages from the configured guild", () => {
    expect(isFromGuild(config, "g1", false)).toBe(true);
  });

  it("rejects another guild", () => {
    expect(isFromGuild(config, "g2", false)).toBe(false);
  });

  it("rejects bots, including itself", () => {
    expect(isFromGuild(config, "g1", true)).toBe(false);
  });

  it("rejects a DM, where guildId is null", () => {
    expect(isFromGuild(config, null, false)).toBe(false);
  });
});

describe("chunkForDiscord", () => {
  it("leaves short text as one chunk", () => {
    expect(chunkForDiscord("hello")).toEqual(["hello"]);
  });

  it("keeps every chunk within the Discord limit", () => {
    expect(chunkForDiscord("x".repeat(5000)).every((chunk) => chunk.length <= 2000)).toBe(true);
  });

  it("loses no characters when splitting plain text", () => {
    const text = Array.from({ length: 400 }, (_, index) => `line ${index}`).join("\n");
    expect(chunkForDiscord(text).join("\n")).toBe(text);
  });

  it("reopens a code fence that a split would otherwise leave dangling", () => {
    const text = "```ts\n" + "const value = 1;\n".repeat(300) + "```";
    const chunks = chunkForDiscord(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.endsWith("```")).toBe(true);
    expect(chunks[1]!.startsWith("```")).toBe(true);
  });

  it("returns a placeholder for empty text so Discord never rejects the send", () => {
    expect(chunkForDiscord("")).toEqual(["_(no output)_"]);
  });
});

describe("shouldSpillToFile", () => {
  it("is false at four chunks", () => {
    expect(shouldSpillToFile(new Array(4).fill("x"))).toBe(false);
  });

  it("is true at five", () => {
    expect(shouldSpillToFile(new Array(5).fill("x"))).toBe(true);
  });
});

describe("StatusMessage", () => {

  it("shows the turn as working before anything has happened", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(sink, () => 0);
    await status.start();
    status.stop();
    expect(sink.written.at(-1)).toBe("**Working** 0s");
  });

  it("replaces the activity log with the answer when the turn ends", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(sink, () => 0);
    await status.start();
    status.note("Looking at the schema first.");
    await status.finish("Done.");
    expect(sink.written.at(-1)).toBe("Done.");
  });

  it("does not keep the answer in the trail it is about to be posted under", () => {
    const sink = recordingSink();
    const status = new StatusMessage(sink, () => 0);
    status.note("Weighing whether the field is optional.");
    status.note("It is optional, so the validator warns rather than fails.");
    status.dropEcho("It is optional, so the validator warns rather than fails.");
    expect(status.hasNotes()).toBe(true);
  });

  it("leaves no trail at all when the only thing said was the answer", () => {
    const sink = recordingSink();
    const status = new StatusMessage(sink, () => 0);
    status.note("The tree is clean, nothing to back out.");
    status.dropEcho("The tree is clean, nothing to back out.");
    expect(status.hasNotes()).toBe(false);
  });

  it("matches a remark that was cut short against the full answer", () => {
    const sink = recordingSink();
    const status = new StatusMessage(sink, () => 0);
    const long = "a".repeat(2500);
    status.note(long);
    status.dropEcho(long);
    expect(status.hasNotes()).toBe(false);
  });

  it("keeps a remark the answer does not repeat", () => {
    const sink = recordingSink();
    const status = new StatusMessage(sink, () => 0);
    status.note("Checking the schema first.");
    status.dropEcho("Something else entirely.");
    expect(status.hasNotes()).toBe(true);
  });

  it("ignores an empty thought rather than logging a blank line", () => {
    const sink = recordingSink();
    const status = new StatusMessage(sink, () => 0);
    status.note("   ");
    status.note("");
    expect(status.hasNotes()).toBe(false);
  });
});

describe("stop requests", () => {
  let lockPath: string;

  beforeEach(async () => {
    lockPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "stop-")), "bridge.lock");
  });

  it("is consumed exactly once, so a stale request cannot stop the next run", async () => {
    await requestStop(lockPath);
    expect(await takeStopRequest(lockPath)).toBe(true);
    expect(await takeStopRequest(lockPath)).toBe(false);
  });

  it("reports nothing when no stop was asked for", async () => {
    expect(await takeStopRequest(lockPath)).toBe(false);
  });

  it("keeps the request beside the lock, not inside it", async () => {
    await requestStop(lockPath);
    expect(path.dirname(stopRequestPath(lockPath))).toBe(path.dirname(lockPath));
    expect(stopRequestPath(lockPath)).not.toBe(lockPath);
  });

  it("calls back once the request appears", async () => {
    const stopped = vi.fn();
    const timer = watchForStop(lockPath, stopped);
    await requestStop(lockPath);
    await vi.waitFor(() => expect(stopped).toHaveBeenCalled(), { timeout: 3000 });
    clearInterval(timer);
  });
});

describe("resolveByFolder", () => {
  it("finds the conversations already working in a folder, newest first", () => {
    const older = {
      ...record({ sessionId: "old", name: "Old", cwd: "/p/app" }),
      lastActivity: new Date("2026-01-01T00:00:00Z"),
    };
    const newer = {
      ...record({ sessionId: "new", name: "New", cwd: "/p/app" }),
      lastActivity: new Date("2026-02-01T00:00:00Z"),
    };
    const elsewhere = record({ sessionId: "other", name: "Other", cwd: "/p/different" });

    const found = resolveByFolder([older, newer, elsewhere], "/p/app");
    expect(found.map((record) => record.sessionId)).toEqual(["new", "old"]);
  });

  it("treats a trailing separator and a relative hop as the same folder", () => {
    const one = record({ sessionId: "s", name: "One", cwd: "/p/app" });
    expect(resolveByFolder([one], "/p/app/").map((record) => record.sessionId)).toEqual(["s"]);
    expect(resolveByFolder([one], "/p/other/../app").map((record) => record.sessionId)).toEqual(["s"]);
  });

  it("ignores a conversation whose directory could not be read", () => {
    const noCwd = { ...record({ sessionId: "s", name: "x", cwd: "/p/app" }), cwd: null };
    expect(resolveByFolder([noCwd], "/p/app")).toEqual([]);
  });
});

describe("PendingCreates", () => {
  it("hands a request back exactly once", () => {
    const pending = new PendingCreates(() => 0);
    pending.remember("m1", { name: "App", cwd: "/p/app" });
    expect(pending.take("m1")?.name).toBe("App");
    expect(pending.take("m1")).toBeNull();
  });

  it("forgets a request nobody answered", () => {
    let now = 0;
    const pending = new PendingCreates(() => now);
    pending.remember("m1", { name: "App", cwd: "/p/app" });
    now = PENDING_TTL_MS + 1;
    expect(pending.take("m1")).toBeNull();
  });

  it("returns nothing for a button it never saw", () => {
    expect(new PendingCreates(() => 0).take("unknown")).toBeNull();
  });
});

describe("redactHome", () => {
  it("rewrites a home path in prose the model wrote", () => {
    const text = `I wrote it to ${path.join(os.homedir(), "Desktop", "out.md")}`;
    const shown = redactHome(text);
    expect(shown).not.toContain(path.basename(os.homedir()));
    expect(shown).toContain("~");
  });

  it("catches both separators and either case", () => {
    const account = path.basename(os.homedir());
    const forward = os.homedir().split(path.sep).join("/");
    for (const variant of [forward, forward.toUpperCase(), os.homedir()]) {
      expect(redactHome(`ran in ${variant}/x`)).not.toContain(account);
    }
  });

  it("leaves text without a home path alone", () => {
    expect(redactHome("nothing to redact here")).toBe("nothing to redact here");
  });
});

describe("outbox settling", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sweep-"));
    await fs.mkdir(path.join(cwd, OUTBOX_DIR, "s1"), { recursive: true });
  });

  it("leaves a file that is still being written", async () => {
    await fs.writeFile(path.join(cwd, OUTBOX_DIR, "s1", "half.png"), "partial");
    const result = await collectOutbox(cwd, "s1", SETTLE_MS);
    expect(result.files).toEqual([]);
    expect(await fs.readdir(path.join(cwd, OUTBOX_DIR, "s1"))).toEqual(["half.png"]);
  });

  it("takes a file that has stopped changing", async () => {
    const file = path.join(cwd, OUTBOX_DIR, "s1", "done.png");
    await fs.writeFile(file, "complete");
    const old = new Date(Date.now() - SETTLE_MS * 2);
    await fs.utimes(file, old, old);
    const result = await collectOutbox(cwd, "s1", SETTLE_MS);
    expect(result.files.map((file) => file.name)).toEqual(["done.png"]);
  });

  it("still takes everything when no settling is asked for", async () => {
    await fs.writeFile(path.join(cwd, OUTBOX_DIR, "s1", "now.png"), "fresh");
    expect((await collectOutbox(cwd, "s1")).files.map((file) => file.name)).toEqual(["now.png"]);
  });
});

describe("purgeChannel", () => {
  const fakeMessage = (id: string, deletable = true) => ({
    id,
    createdAt: new Date(),
    delete: vi.fn(async () => {
      if (!deletable) throw new Error("Unknown Message");
      return undefined;
    }),
  });

  const fakeChannel = (pages: ReturnType<typeof fakeMessage>[][], bulk: () => unknown) => ({
    messages: { fetch: vi.fn(async () => new Map((pages.shift() ?? []).map((message) => [message.id, message]))) },
    bulkDelete: vi.fn(async () => bulk()),
  });

  it("falls back to deleting one at a time when the bulk call throws", async () => {
    const messages = [fakeMessage("a"), fakeMessage("b")];
    const channel = fakeChannel([messages, []], () => {
      throw new Error("Unknown Message");
    });

    const result = await purgeChannel(channel as never);
    expect(result.bulkDeleted).toBe(2);
    expect(result.failed).toBe(0);
    for (const message of messages) expect(message.delete).toHaveBeenCalled();
  });

  it("counts one that is already gone as failed rather than giving up", async () => {
    const messages = [fakeMessage("a"), fakeMessage("b", false)];
    const channel = fakeChannel([messages, []], () => {
      throw new Error("Unknown Message");
    });

    const result = await purgeChannel(channel as never);
    expect(result.bulkDeleted).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("returns rather than throwing, so a caller can always report", async () => {
    const channel = fakeChannel([[fakeMessage("a")], []], () => {
      throw new Error("boom");
    });
    await expect(purgeChannel(channel as never)).resolves.toMatchObject({ bulkDeleted: 1 });
  });
});

describe("categories", () => {
  const categories = [
    { id: "1", name: "Projects" },
    { id: "2", name: "Archive" },
  ];

  it("matches an existing category whatever the case", () => {
    expect(findCategory(categories, "projects")?.id).toBe("1");
    expect(findCategory(categories, "  ARCHIVE  ")?.id).toBe("2");
  });

  it("reports nothing to match when there is no such category", () => {
    expect(findCategory(categories, "Nope")).toBeNull();
    expect(findCategory(categories, "   ")).toBeNull();
  });

  it("keeps the case and spacing a category was given, unlike a channel name", () => {
    expect(normaliseCategoryName("  My Projects  ")).toBe("My Projects");
  });

  it("trims a name Discord would reject as too long", () => {
    expect(normaliseCategoryName("x".repeat(200)).length).toBe(MAX_CATEGORY_NAME);
  });

  it("explains a full category rather than letting Discord refuse opaquely", () => {
    const message = describeCategoryFull("Projects");
    expect(message).toContain("Projects");
    expect(message).toContain(String(CHANNELS_PER_CATEGORY));
  });
});

describe("embeds", () => {
  it("fits a list that would not fit in a plain message", () => {
    const long = "x".repeat(3000);
    const embed = detail("Conversations", long).toJSON();
    expect(embed.description?.length).toBe(3000);
    expect(EMBED_DESCRIPTION_LIMIT).toBeGreaterThan(2000);
  });

  it("trims anything past what Discord accepts rather than being refused", () => {
    const embed = detail("t", "y".repeat(9000), [{ name: "f", value: "z".repeat(4000) }]).toJSON();
    expect(embed.description?.length).toBe(EMBED_DESCRIPTION_LIMIT);
    expect(embed.fields?.[0]?.value.length).toBe(EMBED_FIELD_LIMIT);
  });

  it("leaves out a field with nothing in it", () => {
    const embed = detail("t", "d", [
      { name: "Set", value: "yes" },
      { name: "Empty", value: "   " },
    ]).toJSON();
    expect(embed.fields?.map((field) => field.name)).toEqual(["Set"]);
  });
});

describe("displayName", () => {
  it("uses the conversation's own title when it has one", () => {
    expect(displayName(record({ sessionId: "s", name: "Deploy Scripts", cwd: "/p/thing" }))).toBe(
      "Deploy Scripts",
    );
  });

  it("names an untitled conversation after the folder it works in", () => {
    const untitled = { ...record({ sessionId: "s", name: "x", cwd: "/p/thing" }), name: null };
    expect(displayName(untitled)).toBe("thing");
  });

  it("never names one after the account, when it works in the home folder", () => {
    const untitled = { ...record({ sessionId: "s", name: "x", cwd: os.homedir() }), name: null };
    const shown = displayName(untitled);
    expect(shown).toBe("home");
    expect(shown).not.toContain(path.basename(os.homedir()));
  });

  it("falls back when there is no directory either", () => {
    const bare = { ...record({ sessionId: "s", name: "x", cwd: "/p" }), name: null, cwd: null };
    expect(displayName(bare)).toBe("(untitled)");
  });

  it("is what /resume names the channel and the reply after", () => {
    const sessionId = "4c241d90-c5ad-44e4-94d7-a8d374b00000";
    const untitled = { ...record({ sessionId, name: "x", cwd: "/p/kitchen-site" }), name: null };
    // Autocomplete submits the session id, so a fallback to it named the channel after a UUID.
    expect(displayName(untitled)).toBe("kitchen-site");
    expect(displayName(untitled)).not.toContain(sessionId);
  });

  it("lets an untitled conversation be found by its folder name", () => {
    const untitled = { ...record({ sessionId: "s", name: "x", cwd: "/p/kitchen-site" }), name: null };
    expect(displayName(untitled).toLowerCase().includes("kitchen")).toBe(true);
  });
});

describe("resolving an untitled conversation by name", () => {
  it("finds it by the folder it works in", () => {
    const untitled = { ...record({ sessionId: "s1", name: "x", cwd: "/p/kitchen-site" }), name: null };
    const other = record({ sessionId: "s2", name: "Other", cwd: "/p/other" });
    expect(resolveByName([untitled, other], "kitchen-site").match?.sessionId).toBe("s1");
    expect(resolveByName([untitled, other], "kitchen").match?.sessionId).toBe("s1");
  });

  it("still prefers an explicit title over a folder", () => {
    const titled = record({ sessionId: "s1", name: "Other", cwd: "/p/kitchen-site" });
    expect(resolveByName([titled], "Other").match?.sessionId).toBe("s1");
  });
});

describe("displayPath", () => {
  it("writes a path under home as a tilde path, so no account name is posted", () => {
    const shown = displayPath(path.join(os.homedir(), "Documents", "code", "thing"));
    expect(shown).toBe("~/Documents/code/thing");
    expect(shown).not.toContain(path.basename(os.homedir()));
  });

  it("leaves a path outside home alone", () => {
    const outside = process.platform === "win32" ? "D:\\srv\\app" : "/srv/app";
    expect(displayPath(outside)).toBe(outside);
  });

  it("writes home itself as a tilde rather than spelling it out", () => {
    expect(displayPath(os.homedir())).toBe("~");
  });

  it("does not mistake a sibling of home for a child of it", () => {
    expect(displayPath(`${os.homedir()}-backup`)).toBe(`${os.homedir()}-backup`);
  });
});

describe("renderActivity", () => {
  it("shows what Claude said, newest last, as paragraphs", () => {
    const rendered = renderActivity(["Checking the schema first.", "It is a rounding bug."], 5000);
    const expected = ["**Working** 5s", "", "Checking the schema first.", "", "It is a rounding bug."];
    expect(rendered.split("\n")).toEqual(expected);
  });

  it("says only that it is working when nothing has been said yet", () => {
    expect(renderActivity([], 12_000)).toBe("**Working** 12s");
  });

  it("counts the steps taken, so a quiet turn still shows it is getting somewhere", () => {
    expect(renderActivity([], 272_000, 7)).toBe("**Working** 4m 32s · 7 steps");
    expect(renderActivity([], 5000, 1)).toBe("**Working** 5s · 1 step");
  });

  it("leaves the count off before anything has been done", () => {
    expect(renderActivity([], 5000, 0)).toBe("**Working** 5s");
  });

  it("shows the newest notes and elides the rest", () => {
    const notes = Array.from({ length: 40 }, (_, index) => `Note ${index}`);
    const paragraphs = renderActivity(notes, 0).split("\n\n");
    expect(paragraphs[1]).toBe("...");
    expect(paragraphs.at(-1)).toBe("Note 39");
  });

  it("stays inside a Discord message however much was said", () => {
    const notes = Array.from({ length: 40 }, (_, index) => `${index} `.repeat(120));
    expect(renderActivity(notes, 600_000).length).toBeLessThan(2000);
  });

  it("keeps a long remark whole while the budget has room for it", () => {
    const long = "word ".repeat(150).trim();
    const rendered = renderActivity([long], 1000);
    expect(rendered).toContain(long);
    expect(rendered).not.toContain("...");
  });

  it("drops an older remark rather than cutting it in half", () => {
    const big = "a".repeat(1000);
    const rendered = renderActivity([big, big], 1000);
    const paragraphs = rendered.split("\n\n");
    expect(paragraphs[1]).toBe("...");
    expect(paragraphs[2]).toBe(big);
  });

  it("cuts only when one remark alone is larger than the whole budget", () => {
    const huge = "b".repeat(4000);
    const rendered = renderActivity([huge], 1000);
    expect(rendered.length).toBeLessThan(2000);
    expect(rendered.endsWith("...")).toBe(true);
  });

  it("does not cut commentary off after a few words", () => {
    const sentence =
      "Prices are identical to last week, but something else moved: 25 articles now have a " +
      "takeawayPrice that differs from price, where last week only three did.";
    expect(renderActivity([sentence], 1000)).toContain("where last week only three did.");
  });

  it("counts elapsed time in minutes past a minute", () => {
    expect(formatElapsed(72_000)).toBe("1m 12s");
    expect(formatElapsed(9_000)).toBe("9s");
  });

  it("slows its edits as a turn drags on", () => {
    expect(tickIntervalMs(0)).toBe(2000);
    expect(tickIntervalMs(90_000)).toBe(5000);
    expect(tickIntervalMs(600_000)).toBe(15_000);
  });
});

describe("preflight", () => {
  const base = record({ sessionId: "s1", name: "Deploy Scripts", cwd: "/p" });

  it("allows a session nothing is holding", () => {
    expect(preflight(base).kind).toBe("ok");
  });

  it("offers takeover for a background holder", () => {
    const held = {
      ...base,
      live: { pid: 1, cwd: "/p", kind: "background" as const, sessionId: "s1", id: "abc123" },
    };
    const result = preflight(held);
    expect(result.kind).toBe("takeover-available");
    expect(result.kind === "takeover-available" && result.shortId).toBe("abc123");
  });

  it("refuses an interactive holder and names its directory", () => {
    const held = {
      ...base,
      live: { pid: 42, cwd: "/home/u/projects/deploy-scripts", kind: "interactive" as const, sessionId: "s1" },
    };
    const result = preflight(held);
    expect(result.kind).toBe("refused");
    expect(result.kind === "refused" && result.message).toContain("/home/u/projects/deploy-scripts");
  });
});

describe("attachment screening", () => {
  const file = (name: string, size = 1000) => ({ url: "https://cdn.example/x", name, contentType: null, size });

  it("keeps source and scripts, which are the point of a coding bridge", () => {
    const { allowed, refused } = screenAttachments([
      file("server.ts"), file("deploy.sh"), file("notes.md"), file("shot.png"), file("build.ps1"),
    ]);
    expect(allowed.map((attachment) => attachment.name)).toEqual(["server.ts", "deploy.sh", "notes.md", "shot.png", "build.ps1"]);
    expect(refused).toEqual([]);
  });

  it("refuses formats that exist only to be executed", () => {
    const { allowed, refused } = screenAttachments([file("setup.exe"), file("payload.SCR"), file("x.lnk")]);
    expect(allowed).toEqual([]);
    expect(refused.map((file) => file.name)).toEqual(["setup.exe", "payload.SCR", "x.lnk"]);
  });

  it("refuses a file too large to be worth saving", () => {
    const { refused } = screenAttachments([file("dump.bin", MAX_ATTACHMENT_BYTES + 1)]);
    expect(refused[0]?.reason).toContain("over 25 MB");
  });

  it("says which file was refused and why, and stays quiet when none was", () => {
    const { refused } = screenAttachments([file("setup.exe")]);
    const notice = describeRefused(refused);
    expect(notice).toContain("setup.exe");
    expect(notice).toContain("executable format");
    expect(describeRefused([])).toBeNull();
  });
});

describe("ApprovalPrompts", () => {
  const OWNER = "owner-1";

  it("allows the tool once an owner approves", async () => {
    const prompts = new ApprovalPrompts();
    const decision = prompts.ask("turn-1", askingSink((actions) => {
      prompts.decide(actionId(actions, "approve"), OWNER, "approve");
    }), [OWNER], "Bash", { command: "ls" });

    expect(await decision).toEqual({ allow: true });
  });

  it("denies, and says so where the model can read it", async () => {
    const prompts = new ApprovalPrompts();
    const decision = await prompts.ask("turn-1", askingSink((actions) => {
      prompts.decide(actionId(actions, "deny"), OWNER, "deny");
    }), [OWNER], "Bash", { command: "rm -rf /" });

    expect(decision.allow).toBe(false);
    expect(decision.allow === false && decision.reason).toContain("Denied");
  });

  // A stranger with the button in front of them is still not an owner.
  it("refuses a decision from anyone but an owner", async () => {
    const prompts = new ApprovalPrompts();
    let refusal = "";
    const decision = prompts.ask("turn-1", askingSink((actions) => {
      refusal = prompts.decide(actionId(actions, "approve"), "someone-else", "approve");
      prompts.decide(actionId(actions, "deny"), OWNER, "deny");
    }), [OWNER], "Bash", { command: "ls" });

    await decision;
    expect(refusal).toContain("Only an owner");
  });

  it("stops asking for the rest of a turn once approved wholesale", async () => {
    const prompts = new ApprovalPrompts();
    let asks = 0;
    const sink = askingSink((actions) => {
      asks += 1;
      prompts.decide(actionId(actions, "approve-all"), OWNER, "approve-all");
    });

    expect(await prompts.ask("turn-1", sink, [OWNER], "Bash", { command: "ls" })).toEqual({ allow: true });
    expect(await prompts.ask("turn-1", sink, [OWNER], "Edit", { file_path: "a.ts" })).toEqual({ allow: true });
    expect(asks).toBe(1);
  });

  // The standing approval was given for one turn, so the next one starts from nothing.
  it("does not carry a wholesale approval into the next turn", async () => {
    const prompts = new ApprovalPrompts();
    let asks = 0;
    const sink = askingSink((actions) => {
      asks += 1;
      prompts.decide(actionId(actions, "approve-all"), OWNER, "approve-all");
    });

    await prompts.ask("turn-1", sink, [OWNER], "Bash", { command: "ls" });
    prompts.finish("turn-1");
    await prompts.ask("turn-2", sink, [OWNER], "Bash", { command: "ls" });
    expect(asks).toBe(2);
  });

  it("denies when the conversation has no way to show buttons", async () => {
    const prompts = new ApprovalPrompts();
    const decision = await prompts.ask("turn-1", quietSink(), [OWNER], "Bash", { command: "ls" });
    expect(decision.allow).toBe(false);
  });

  it("names the tool and shows what it would run", () => {
    const text = describeRequest("Bash", { command: "git push --force" });
    expect(text).toContain("Bash");
    expect(text).toContain("git push --force");
  });
});

describe("UsageLedger", () => {
  const result = (sessionCostUsd: number, startedHere = false, input = 100, output = 10) => ({
    sessionCostUsd,
    startedHere,
    usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 },
  });

  it("reads cost as the running total Claude Code reports, so two results do not add up", () => {
    const ledger = new UsageLedger();
    ledger.record("s1", result(0.5, true));
    ledger.record("s1", result(0.75));

    expect(ledger.forSession("s1")).toMatchObject({
      turns: 2, costUsd: 0.75, inputTokens: 200, outputTokens: 20, cachedTokens: 14, lastCostUsd: 0.25,
    });
  });

  it("prices the first turn of a conversation the bridge started as the whole total", () => {
    const ledger = new UsageLedger();
    ledger.record("s1", result(0.5, true));
    expect(ledger.forSession("s1").lastCostUsd).toBe(0.5);
  });

  // A resumed conversation's first result already carries the turns run before the bridge saw it.
  it("has no last-turn cost until a resumed conversation has reported twice", () => {
    const ledger = new UsageLedger();
    ledger.record("s1", result(105.03));
    expect(ledger.forSession("s1")).toMatchObject({ costUsd: 105.03, lastCostUsd: null });
    ledger.record("s1", result(105.5));
    expect(ledger.forSession("s1").lastCostUsd).toBeCloseTo(0.47);
  });

  it("never lets a crashed result that reports zero pull the total backwards", () => {
    const ledger = new UsageLedger();
    ledger.record("s1", result(1, true));
    ledger.record("s1", result(0));
    expect(ledger.forSession("s1")).toMatchObject({ turns: 2, costUsd: 1, lastCostUsd: null });
  });

  it("reports nothing rather than failing for a conversation it has not seen", () => {
    expect(new UsageLedger().forSession("unknown")).toMatchObject({ turns: 0, costUsd: 0, lastCostUsd: null });
  });

  it("counts a turn whose cost Claude Code did not report", () => {
    const ledger = new UsageLedger();
    ledger.record("s1", {});
    expect(ledger.forSession("s1")).toMatchObject({ turns: 1, costUsd: 0 });
  });

  // Resuming can mint a new id, and the spend belongs to the conversation rather than to the id.
  it("carries spend across a session id change", () => {
    const ledger = new UsageLedger();
    ledger.record("old", result(1, true));
    ledger.migrate("old", "new");
    ledger.record("new", result(2));

    expect(ledger.forSession("old").turns).toBe(0);
    expect(ledger.forSession("new")).toMatchObject({ turns: 2, costUsd: 2, lastCostUsd: 1 });
  });

  it("totals every conversation the bridge has touched", () => {
    const ledger = new UsageLedger();
    ledger.record("s1", result(1, true));
    ledger.record("s2", result(2, true));
    expect(ledger.total()).toMatchObject({ turns: 2, costUsd: 3 });
  });
});

describe("ContextTracker", () => {

  it("stays quiet well below the threshold", () => {
    expect(new ContextTracker(200_000).observe(usage(50_000))).toBeNull();
  });

  it("warns once at 75 percent", () => {
    const tracker = new ContextTracker(200_000);
    expect(tracker.observe(usage(150_000))?.level).toBe("approaching");
    expect(tracker.observe(usage(151_000))).toBeNull();
  });

  it("escalates at 90 percent and names the remedy", () => {
    const tracker = new ContextTracker(200_000);
    tracker.observe(usage(150_000));
    const warning = tracker.observe(usage(185_000));
    expect(warning?.level).toBe("critical");
    expect(warning?.message).toContain("/compact");
  });

  it("rearms after a compaction", () => {
    const tracker = new ContextTracker(200_000);
    tracker.observe(usage(150_000));
    tracker.reset();
    expect(tracker.observe(usage(150_000))?.level).toBe("approaching");
  });

  it("sums cached tokens into the total", () => {
    const warning = new ContextTracker(200_000).observe({
      input_tokens: 1000,
      output_tokens: 0,
      cache_read_input_tokens: 140_000,
      cache_creation_input_tokens: 10_000,
    });
    expect(warning?.level).toBe("approaching");
  });
});

describe("classifyPrompt", () => {
  const terminalOnly = ["doctor", "color", "reload-plugins"];

  it("treats ordinary text as a turn", () => {
    expect(classifyPrompt("what does this repo do?", terminalOnly).kind).toBe("turn");
  });

  it("passes a Claude Code slash command through", () => {
    expect(classifyPrompt("/compact", terminalOnly).kind).toBe("passthrough");
  });

  it("passes a namespaced skill command through", () => {
    expect(classifyPrompt("/superpowers:brainstorming", terminalOnly).kind).toBe("passthrough");
  });

  it("rejects a terminal-only command with an explanation", () => {
    const result = classifyPrompt("/doctor", terminalOnly);
    expect(result.kind).toBe("terminal-only");
    expect(result.kind === "terminal-only" && result.message).toContain("doctor");
  });

  it("refuses to pass through /model, which would silently revert", () => {
    const result = classifyPrompt("/model opus", terminalOnly);
    expect(result.kind).toBe("bridge-owned");
    expect(result.kind === "bridge-owned" && result.message).toContain("/model");
  });

  it("refuses to pass through /effort for the same reason", () => {
    expect(classifyPrompt("/effort high", terminalOnly).kind).toBe("bridge-owned");
  });

  it("does not treat a path at the start of a message as a command", () => {
    expect(classifyPrompt("/home/u/x is the path", terminalOnly).kind).toBe("turn");
  });
});

describe("formatSessionList", () => {
  it("marks a live session", () => {
    const output = formatSessionList([
      record({
        sessionId: "a",
        name: "Deploy Scripts",
        cwd: "/p/deploy-scripts",
        live: { pid: 1, cwd: "/p/deploy-scripts", kind: "interactive", sessionId: "a", status: "idle" },
      }),
    ]);
    expect(output).toContain("Deploy Scripts");
    expect(output).toContain("live (interactive, idle)");
  });

  it("says so when there is nothing to list", () => {
    expect(formatSessionList([])).toMatch(/no conversations/i);
  });
});

describe("workingDirFor", () => {
  const bridge = (workspacesRoot?: string) =>
    ({
      ownerId: "host",
      config: { projectsRoot: path.resolve("/srv/projects"), workspacesRoot },
    }) as never;

  it("puts the host owner in the projects root", () => {
    expect(workingDirFor(bridge(), "owner", "host")).toBe(path.resolve("/srv/projects"));
  });

  it("puts an operator in their own workspace", () => {
    const dir = workingDirFor(bridge(path.resolve("/srv/ws")), "operator", "u1");
    expect(dir).toBe(path.join(path.resolve("/srv/ws"), "u1"));
  });

  it("joins a bare project name onto whichever root applies", () => {
    const dir = workingDirFor(bridge(path.resolve("/srv/ws")), "operator", "u1", "notes");
    expect(dir).toBe(path.join(path.resolve("/srv/ws"), "u1", "notes"));
  });

  // Nothing confines a conversation, so refusing a path would be friction without a boundary.
  it("lets any tier name an absolute path", () => {
    const dir = workingDirFor(bridge(path.resolve("/srv/ws")), "operator", "u1", path.resolve("/srv/other"));
    expect(dir).toBe(path.resolve("/srv/other"));
  });

  it("refuses an operator with no workspace root configured", () => {
    expect(() => workingDirFor(bridge(), "operator", "u1")).toThrow(/WORKSPACES_ROOT/);
  });
});

describe("toChannelName", () => {
  it("slugifies a conversation name", () => {
    expect(toChannelName("Release Notes")).toBe("release-notes");
  });

  it("collapses punctuation such as dots", () => {
    expect(toChannelName("project-notes")).toBe("project-notes");
  });

  it("trims leading and trailing separators", () => {
    expect(toChannelName("  !! hello !!  ")).toBe("hello");
  });

  it("falls back rather than producing an empty channel name", () => {
    expect(toChannelName("!!!")).toBe("conversation");
  });

  it("round-trips back to a resolvable conversation name", () => {
    expect(fromChannelName(toChannelName("Release Notes"))).toBe("release notes");
  });
});

describe("acquireInstanceLock", () => {
  let lockPath: string;

  beforeEach(async () => {
    lockPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "lock-")), "bridge.lock");
  });

  it("acquires a lock when none exists", async () => {
    clearInterval(await acquireInstanceLock(lockPath));
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).pid).toBe(process.pid);
  });

  it("refuses when another live process is still beating", async () => {
    const now = new Date().toISOString();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: now, heartbeatAt: now }));
    await expect(acquireInstanceLock(lockPath, () => true)).rejects.toThrow(/already running/i);
  });

  it("takes over a lock whose pid was reused but whose heartbeat stopped", async () => {
    const old = new Date(Date.now() - STALE_AFTER_MS - 1000).toISOString();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: old, heartbeatAt: old }));
    const beat = await acquireInstanceLock(lockPath, () => true);
    clearInterval(beat);
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).pid).toBe(process.pid);
  });

  it("names the lock file so a stale one can be cleared", async () => {
    const now = new Date().toISOString();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: now, heartbeatAt: now }));
    await expect(acquireInstanceLock(lockPath, () => true)).rejects.toThrow(lockPath);
  });

  it("takes over a lock whose process is gone", async () => {
    const now = new Date().toISOString();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: now, heartbeatAt: now }));
    clearInterval(await acquireInstanceLock(lockPath, () => false));
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).pid).toBe(process.pid);
  });

  it("never treats its own pid as a competing holder", () => {
    const now = new Date().toISOString();
    expect(isLockHeld({ pid: process.pid, startedAt: now, heartbeatAt: now }, Date.now(), () => true)).toBe(false);
  });

  it("takes over a corrupt lock file rather than wedging", async () => {
    await fs.writeFile(lockPath, "not json");
    clearInterval(await acquireInstanceLock(lockPath));
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).pid).toBe(process.pid);
  });

  it("releases only its own lock", async () => {
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: "x" }));
    await releaseInstanceLock(lockPath);
    expect(await fs.readFile(lockPath, "utf8")).toContain("999999");
  });
});

describe("pluginSelectOptions", () => {
  const raw = JSON.stringify([
    { id: "superpowers@claude-plugins-official", version: "6.3.0", scope: "user", enabled: true, installPath: "/x" },
    { id: "code-review@claude-plugins-official", version: "1.0.0", scope: "user", enabled: false, installPath: "/y" },
  ]);

  it("shows the enabled state in the description", () => {
    const options = pluginSelectOptions(parsePluginList(raw));
    expect(options[0]!.description).toMatch(/enabled/);
    expect(options[1]!.description).toMatch(/disabled/);
  });

  it("keeps labels within the Discord 100 character limit", () => {
    const long = JSON.stringify([{ id: "x".repeat(200), version: "1", scope: "user", enabled: true, installPath: "/z" }]);
    expect(pluginSelectOptions(parsePluginList(long))[0]!.label.length).toBeLessThanOrEqual(100);
  });

  it("caps at the Discord 25 option limit", () => {
    const many = JSON.stringify(
      Array.from({ length: 40 }, (_, index) => ({ id: `p${index}`, version: "1", scope: "user", enabled: true, installPath: "/z" })),
    );
    expect(pluginSelectOptions(parsePluginList(many))).toHaveLength(25);
  });

  it("returns an empty list for unparseable output", () => {
    expect(parsePluginList("not json")).toEqual([]);
  });
});

describe("parseCustomId", () => {
  it("reads a chosen plugin from the select menu", () => {
    const action = parseCustomId(PLUGIN_SELECT, "superpowers@claude-plugins-official");
    expect(action).toEqual({ kind: "plugin-chosen", id: "superpowers@claude-plugins-official" });
  });

  it("reads a chosen skill", () => {
    expect(parseCustomId(SKILL_SELECT, "superpowers:brainstorming")).toEqual({
      kind: "skill-chosen",
      skill: "superpowers:brainstorming",
    });
  });

  it("round-trips an enable button", () => {
    const id = pluginToggleId("superpowers@claude-plugins-official", true);
    expect(parseCustomId(id)).toEqual({
      kind: "plugin-toggle",
      id: "superpowers@claude-plugins-official",
      enable: true,
    });
  });

  it("round-trips a disable button", () => {
    const action = parseCustomId(pluginToggleId("code-review@x", false));
    expect(action.kind === "plugin-toggle" && action.enable).toBe(false);
  });

  it("keeps a custom id within the Discord 100 character limit", () => {
    expect(pluginToggleId("x".repeat(300), true).length).toBeLessThanOrEqual(100);
  });

  it("reports unknown for a stale custom id", () => {
    expect(parseCustomId("something:else").kind).toBe("unknown");
  });
});

describe("readExchanges", () => {
  const transcript = () => fixture("transcript-exchanges.jsonl");

  it("returns only real prompts and replies", async () => {
    const exchanges = await readExchanges(transcript());
    expect(exchanges.map((exchange) => exchange.text)).toEqual([
      "first prompt from discord",
      "first reply",
      "typed in the terminal",
      "terminal reply",
      "a real question about the code",
      "a real answer",
    ]);
  });

  it("excludes slash command plumbing stored as user messages", async () => {
    const texts = (await readExchanges(transcript())).map((exchange) => exchange.text);
    expect(texts.some((text) => text.includes("command-name"))).toBe(false);
    expect(texts.some((text) => text.includes("local-command-stdout"))).toBe(false);
  });

  it("excludes task notifications and shell escapes", async () => {
    const texts = (await readExchanges(transcript())).map((exchange) => exchange.text);
    expect(texts.some((text) => text.includes("task-notification"))).toBe(false);
    expect(texts.some((text) => text.includes("bash-input"))).toBe(false);
  });

  it("excludes tool_use and tool_result records", async () => {
    const texts = (await readExchanges(transcript())).map((exchange) => exchange.text);
    expect(texts.some((text) => text.includes("data"))).toBe(false);
  });

  it("excludes injected and sidechain records", async () => {
    const texts = (await readExchanges(transcript())).map((exchange) => exchange.text);
    expect(texts).not.toContain("injected marker");
    expect(texts).not.toContain("subagent chatter");
  });

  it("returns only what happened after the watermark", async () => {
    const drift = await readExchanges(transcript(), new Date("2026-09-13T10:30:00Z"));
    expect(drift.map((exchange) => exchange.text)).toEqual([
      "typed in the terminal",
      "terminal reply",
      "a real question about the code",
      "a real answer",
    ]);
  });

  it("returns nothing when the watermark is current", async () => {
    expect(await readExchanges(transcript(), new Date("2026-09-13T23:00:00Z"))).toEqual([]);
  });

  it("returns the last N exchanges for a resume recap, skipping plumbing", async () => {
    const recent = await lastExchanges(transcript(), 2);
    expect(recent.map((exchange) => exchange.text)).toEqual(["a real question about the code", "a real answer"]);
  });

  it("returns nothing for a missing transcript rather than throwing", async () => {
    expect(await readExchanges(fixture("nope.jsonl"))).toEqual([]);
  });
});

describe("transcript view", () => {
  const exchanges = [
    { at: new Date("2026-09-13T14:32:00Z"), role: "user" as const, text: "check the nas" },
    { at: new Date("2026-09-13T14:33:00Z"), role: "assistant" as const, text: "mounted" },
  ];

  const stamp = (at: Date) => `<t:${Math.floor(at.getTime() / 1000)}:t>`;

  it("labels the source, and the time as a Discord timestamp so it shows in the reader's zone", () => {
    const out = formatExchanges(exchanges);
    expect(out).toContain(`**You** · terminal · ${stamp(exchanges[0]!.at)}`);
    expect(out).toContain(`**Claude** · terminal · ${stamp(exchanges[1]!.at)}`);
  });

  it("uses a plain clock where Discord will not render one", () => {
    const out = formatExchanges(exchanges, "plain");
    expect(out).toContain("**You** · terminal · 14:32 UTC");
    expect(out).not.toContain("<t:");
  });

  it("truncates a very long exchange", () => {
    const long = [{ at: new Date("2026-09-13T14:32:00Z"), role: "assistant" as const, text: "x".repeat(5000) }];
    expect(formatExchanges(long).length).toBeLessThan(1400);
  });

  it("describes drift with a count and the last time", () => {
    const notice = describeDrift(exchanges);
    expect(notice).toContain("2 messages");
    expect(notice).toContain(stamp(exchanges[1]!.at));
    expect(notice).toContain("/sync");
  });

  it("uses the singular for one message", () => {
    expect(describeDrift(exchanges.slice(0, 1))).toContain("1 message happened");
  });
});

describe("isMessageInScope", () => {
  const scoped = { guildId: "g", categoryId: "cat" };

  it("allows any channel when no category is configured", () => {
    expect(isMessageInScope({ guildId: "g" }, "anything", false)).toBe(true);
  });

  it("allows a channel inside the configured category", () => {
    expect(isMessageInScope(scoped, "cat", false)).toBe(true);
  });

  it("ignores an unbound channel outside the category, so bridges do not collide", () => {
    expect(isMessageInScope(scoped, "other", false)).toBe(false);
  });

  it("always allows a channel this bridge already owns, wherever it sits", () => {
    expect(isMessageInScope(scoped, "other", true)).toBe(true);
    expect(isMessageInScope(scoped, null, true)).toBe(true);
  });
});

describe("stripBotMention", () => {
  it("removes the mention and trims", () => {
    expect(stripBotMention("<@123> check the nas", "123")).toBe("check the nas");
  });

  it("removes the nickname form of the mention", () => {
    expect(stripBotMention("<@!123> hello", "123")).toBe("hello");
  });

  it("leaves other people's mentions alone", () => {
    expect(stripBotMention("<@123> ask <@456> about it", "123")).toBe("ask <@456> about it");
  });
});

describe("buildContext", () => {
  const messages = [
    { authorId: "u1", authorName: "First", content: "the nas is full", at: new Date("2026-09-13T14:30:00Z"), isBot: false },
    { authorId: "u2", authorName: "Second", content: "since when?", at: new Date("2026-09-13T14:31:00Z"), isBot: false },
    { authorId: "bot", authorName: "TheBot", content: "earlier reply", at: new Date("2026-09-13T14:32:00Z"), isBot: true },
  ];

  it("names each speaker with a taggable id", () => {
    const context = buildContext(messages);
    expect(context.text).toContain("First (<@u1>) at 14:30: the nas is full");
    expect(context.text).toContain("Second (<@u2>) at 14:31: since when?");
  });

  it("lets the bot tag back the humans it saw", () => {
    expect(buildContext(messages).mentionableUserIds).toEqual(["u1", "u2"]);
  });

  it("never marks a bot as mentionable", () => {
    expect(buildContext(messages).mentionableUserIds).not.toContain("bot");
  });

  it("fences quoted messages behind a marker they cannot guess", () => {
    const context = buildContext(messages);
    const token = /BEGIN CHANNEL MESSAGES ([0-9a-f]{16})/.exec(context.text)?.[1];
    expect(token).toBeDefined();
    expect(context.text).toContain(`END CHANNEL MESSAGES ${token}`);
    expect(buildContext(messages).text).not.toContain(token!);
  });

  it("marks quoted text so the turn knows it is data", () => {
    expect(buildContext(messages).quoted).toBe(true);
    expect(attributionOnly(messages[0]!).quoted).toBe(false);
    expect(noContext().quoted).toBe(false);
  });

  it("skips empty messages such as bare attachments", () => {
    const context = buildContext([{ ...messages[0]!, content: "   " }]);
    expect(context.text).toBe("");
    expect(context.mentionableUserIds).toEqual([]);
  });

  it("truncates a very long message", () => {
    const context = buildContext([{ ...messages[0]!, content: "x".repeat(5000) }]);
    expect(context.text).toContain("x".repeat(600));
    expect(context.text).not.toContain("x".repeat(601));
  });

  it("deduplicates a speaker who said several things", () => {
    const repeated = [messages[0]!, { ...messages[0]!, content: "and growing" }];
    expect(buildContext(repeated).mentionableUserIds).toEqual(["u1"]);
  });
});

describe("attributionOnly", () => {
  const asker = { authorId: "u1", authorName: "First", content: "hi", at: new Date(), isBot: false };

  it("costs one line and still allows tagging back", () => {
    const context = attributionOnly(asker);
    expect(context.text.split("\n")).toHaveLength(1);
    expect(context.mentionableUserIds).toEqual(["u1"]);
  });

  it("adds nothing to a prompt when there is no context", () => {
    expect(composePrompt(noContext(), "just this")).toBe("just this");
  });

  it("separates context from the prompt when there is context", () => {
    const composed = composePrompt(attributionOnly(asker), "do the thing");
    expect(composed).toContain("The request to act on:");
    expect(composed.endsWith("do the thing")).toBe(true);
  });
});

describe("access tiers", () => {
  const ctx = { ownerIds: ["host", "cohost"], operatorIds: ["op"] };

  it("recognises an owner from the host's own list", () => {
    expect(tierFor(ctx, "host")).toBe("owner");
  });

  it("supports more than one owner", () => {
    expect(tierFor(ctx, "cohost")).toBe("owner");
  });

  it("recognises an operator", () => {
    expect(tierFor(ctx, "op")).toBe("operator");
  });

  it("rejects everybody else", () => {
    expect(tierFor(ctx, "nobody")).toBe("none");
  });

  it("lets an owner run anything", () => {
    expect(canRunCommand("owner", "operator")).toBe(true);
    expect(canRunCommand("owner", "invite")).toBe(true);
  });

  it("stops an operator changing who has access", () => {
    expect(canRunCommand("operator", "create")).toBe(true);
    expect(canRunCommand("operator", "operator")).toBe(false);
    expect(canRunCommand("operator", "invite")).toBe(false);
    expect(canRunCommand("operator", "uninvite")).toBe(false);
  });

  // Tier "none" is the only security boundary the bridge has: anyone past it runs as the host user.
  it("lets anyone below operator run nothing at all", () => {
    const everyCommand = [
      "ask", "sync", "whoami", "members", "skills", "stop",
      "create", "resume", "invite", "operator", "unbind", "purge", "takeover",
    ];
    for (const command of everyCommand) {
      expect(canRunCommand("none", command)).toBe(false);
    }
  });
});

describe("workspaceFor", () => {
  it("gives each user their own folder under the root", () => {
    expect(workspaceFor("/srv/ws", "u1")).toBe(path.join("/srv/ws", "u1"));
    expect(workspaceFor("/srv/ws", "u1")).not.toBe(workspaceFor("/srv/ws", "u2"));
  });
});

describe("conversationOverwrites", () => {
  const audience = { everyoneRoleId: "everyone", botUserId: "bot", ownerId: "owner", memberIds: [] as string[] };

  it("hides the channel from everyone by default", () => {
    const [first] = conversationOverwrites(audience);
    expect(first!.id).toBe("everyone");
    expect(first!.deny).toContain(PermissionFlagsBits.ViewChannel);
  });

  it("keeps the bot able to post in its own private channel", () => {
    const bot = conversationOverwrites(audience).find((overwrite) => overwrite.id === "bot");
    expect(bot!.allow).toContain(PermissionFlagsBits.ViewChannel);
    expect(bot!.allow).toContain(PermissionFlagsBits.SendMessages);
  });

  it("gives the owner access", () => {
    const owner = conversationOverwrites(audience).find((overwrite) => overwrite.id === "owner");
    expect(owner!.allow).toContain(PermissionFlagsBits.ViewChannel);
  });

  it("gives each invited guest access", () => {
    const overwrites = conversationOverwrites({ ...audience, memberIds: ["g1", "g2"] });
    expect(overwrites.find((overwrite) => overwrite.id === "g1")).toBeDefined();
    expect(overwrites.find((overwrite) => overwrite.id === "g2")).toBeDefined();
  });

  it("never grants a guest channel management", () => {
    const guest = conversationOverwrites({ ...audience, memberIds: ["g1"] }).find((overwrite) => overwrite.id === "g1");
    expect(guest!.allow).not.toContain(PermissionFlagsBits.ManageChannels);
  });

  it("does not duplicate an owner who is also listed as a member", () => {
    const overwrites = conversationOverwrites({ ...audience, memberIds: ["owner"] });
    expect(overwrites.filter((overwrite) => overwrite.id === "owner")).toHaveLength(1);
  });
});

describe("turnSpawnOptions", () => {
  // The SDK speaks to the CLI over stdin, so closing it would cut the transport.
  it("pipes all three streams for the SDK transport", () => {
    expect(turnSpawnOptions("/tmp/x").stdio).toEqual(["pipe", "pipe", "pipe"]);
  });

  it("runs the turn in the conversation's directory, without a shell", () => {
    const options = turnSpawnOptions("/tmp/x");
    expect(options.cwd).toBe("/tmp/x");
    expect(options.shell).toBe(false);
  });
});

describe("auth status", () => {
  it("reads a signed-in account and its plan", () => {
    const status = parseAuthStatus(JSON.stringify({ loggedIn: true, subscriptionType: "max", email: "x@example.test" }));
    expect(status).toEqual({ loggedIn: true, subscriptionType: "max" });
  });

  it("reads a signed-out account", () => {
    expect(parseAuthStatus(JSON.stringify({ loggedIn: false }))).toEqual({ loggedIn: false, subscriptionType: undefined });
  });

  // Refusing to start on output nobody recognises would turn a changed CLI into an outage.
  it("treats anything it cannot read as unknown rather than as signed out", () => {
    expect(parseAuthStatus("")).toBeNull();
    expect(parseAuthStatus("not json at all")).toBeNull();
    expect(parseAuthStatus(JSON.stringify({ status: "ok" }))).toBeNull();
    expect(parseAuthStatus(JSON.stringify({ loggedIn: "yes" }))).toBeNull();
  });

  it("says what to run when it is signed out", () => {
    expect(SIGNED_OUT).toContain("claude auth login");
  });
});

describe("samePath", () => {
  const asPlatform = (value: string, run: () => void): void => {
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value, configurable: true });
    try {
      run();
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  };

  it("treats case as identity on Linux, where two spellings are two folders", () => {
    asPlatform("linux", () => {
      expect(samePath("/home/u/Projects", "/home/u/projects")).toBe(false);
      expect(samePath("/home/u/Projects", "/home/u/Projects")).toBe(true);
    });
  });

  // Default APFS is case-insensitive, so a Mac would otherwise see one folder as two conversations.
  it("ignores case on macOS and Windows, where one folder has many spellings", () => {
    asPlatform("darwin", () => {
      expect(samePath("/Users/me/Projects", "/Users/me/projects")).toBe(true);
    });
    asPlatform("win32", () => {
      expect(samePath("C:/Users/me/Projects", "c:/users/me/projects")).toBe(true);
    });
  });
});

describe("attachmentsRoot", () => {
  it("never contains an 8.3 short name, which restricted mode rejects", () => {
    expect(attachmentsRoot()).not.toContain("~");
  });

  it("resolves under the real temp directory", () => {
    expect(attachmentsRoot().startsWith(longTmpDir())).toBe(true);
  });
});

describe("session choices", () => {
  it("renders sizes at a readable scale", () => {
    expect(humanSize(512)).toBe("512 B");
    expect(humanSize(48 * 1024 ** 2)).toBe("48 MB");
    expect(humanSize(923_000_000)).toBe("880 MB");
    expect(humanSize(2 * 1024 ** 3)).toBe("2.0 GB");
  });

  it("renders ages at a readable scale", () => {
    const now = new Date("2026-09-14T12:00:00Z");
    expect(humanAge(new Date("2026-09-14T11:45:00Z"), now)).toBe("15m ago");
    expect(humanAge(new Date("2026-09-14T09:00:00Z"), now)).toBe("3h ago");
    expect(humanAge(new Date("2026-09-11T12:00:00Z"), now)).toBe("3d ago");
    expect(humanAge(null, now)).toBe("unknown");
  });

  it("submits the session id so duplicate names stay distinguishable", () => {
    const large = record({ sessionId: "id-a", name: "project-notes", sizeBytes: 48 * 1024 ** 2 });
    const small = record({ sessionId: "id-b", name: "project-notes", sizeBytes: 1024 });
    expect(sessionChoice(large).value).toBe("id-a");
    expect(sessionChoice(small).value).toBe("id-b");
    expect(sessionChoice(large).name).not.toBe(sessionChoice(small).name);
  });

  // Every untitled conversation in a folder takes that folder's name, so size and age alone
  // cannot tell two of them apart.
  it("tags an untitled conversation with its id", () => {
    const one = record({ sessionId: "4e5b4e8e-ec44-4942", name: null, cwd: "/p/claudetalk", sizeBytes: 1024 });
    const two = record({ sessionId: "89e4c5e6-ccfd-4880", name: null, cwd: "/p/claudetalk", sizeBytes: 1024 });
    expect(sessionChoice(one).name).toContain("4e5b4e8e");
    expect(sessionChoice(two).name).toContain("89e4c5e6");
    expect(sessionChoice(one).name).not.toBe(sessionChoice(two).name);
  });

  it("leaves a titled conversation's label alone", () => {
    const named = record({ sessionId: "4e5b4e8e-ec44-4942", name: "Deploy Scripts", sizeBytes: 1024 });
    expect(sessionChoice(named).name).not.toContain("4e5b4e8e");
    expect(sessionChoice(named).name).toBe("Deploy Scripts · 1 KB · unknown");
  });

  it("tags untitled conversations in the listing too", () => {
    const output = formatSessionList([
      record({ sessionId: "4e5b4e8e-ec44-4942", name: null, cwd: "/p/claudetalk", sizeBytes: 1024 }),
    ]);
    expect(output).toContain("4e5b4e8e");
  });

  it("keeps only the newest of the conversations sharing a name", () => {
    const older = record({ sessionId: "old", name: null, cwd: "/p/notes", lastActivity: new Date("2026-09-01") });
    const newer = record({ sessionId: "new", name: null, cwd: "/p/notes", lastActivity: new Date("2026-09-10") });
    const collapsed = newestPerName([older, newer]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]![0].sessionId).toBe("new");
    expect(collapsed[0]![1]).toBe(1);
  });

  it("keeps conversations with different names apart", () => {
    const notes = record({ sessionId: "a", name: null, cwd: "/p/notes", lastActivity: new Date("2026-09-01") });
    const other = record({ sessionId: "b", name: null, cwd: "/p/other", lastActivity: new Date("2026-09-02") });
    expect(newestPerName([notes, other])).toHaveLength(2);
  });

  it("orders the collapsed list by recency", () => {
    const alpha = record({ sessionId: "a", name: "Alpha", lastActivity: new Date("2026-09-01") });
    const beta = record({ sessionId: "b", name: "Beta", lastActivity: new Date("2026-09-09") });
    expect(newestPerName([alpha, beta]).map(([newest]) => newest.sessionId)).toEqual(["b", "a"]);
  });

  it("says how many older ones a row stands in for", () => {
    const one = record({ sessionId: "4e5b4e8e-x", name: null, cwd: "/p/notes", sizeBytes: 1024 });
    expect(sessionChoice(one, 6).name).toContain("+6 older");
    expect(sessionChoice(one, 0).name).not.toContain("older");
  });

  it("shows the size so the primary conversation is obvious", () => {
    const big = record({ sessionId: "s", name: "project-notes", sizeBytes: 48 * 1024 ** 2 });
    expect(sessionChoice(big).name).toContain("48 MB");
  });

  it("keeps a label within the Discord 100 character limit", () => {
    const long = record({ sessionId: "s", name: "x".repeat(300), sizeBytes: 1024 ** 3 });
    expect(sessionChoice(long).name.length).toBeLessThanOrEqual(100);
  });

  it("lists sizes so an oversized transcript is visible", () => {
    const output = formatSessionList([record({ sessionId: "s", name: "Big", sizeBytes: 923_000_000 })]);
    expect(output).toContain("880 MB");
  });
});

describe("ContextTracker ceiling", () => {

  it("stays silent until it knows where this session compacts", () => {
    expect(new ContextTracker().observe(usage(500_000))).toBeNull();
  });

  it("learns the ceiling from a compaction", () => {
    const tracker = new ContextTracker();
    tracker.learnCeiling(951_650);
    expect(tracker.knownCeiling()).toBe(951_650);
  });

  it("never lowers a learned ceiling when a manual compaction happens early", () => {
    const tracker = new ContextTracker();
    tracker.learnCeiling(951_650);
    tracker.learnCeiling(558_784);
    expect(tracker.knownCeiling()).toBe(951_650);
  });

  it("does not call 558k tokens 279 percent full on a one-million window", () => {
    const tracker = new ContextTracker(951_650);
    expect(tracker.observe(usage(558_784))).toBeNull();
  });

  it("warns against the real ceiling rather than a guessed one", () => {
    const tracker = new ContextTracker(951_650);
    const warning = tracker.observe(usage(800_000));
    expect(warning?.level).toBe("approaching");
    expect(warning?.message).toContain("84%");
  });

  it("never reports more than 99 percent", () => {
    const tracker = new ContextTracker(200_000);
    expect(tracker.observe(usage(10_000_000))?.message).toContain("99%");
  });
});

describe("purge", () => {
  const now = Date.parse("2026-09-14T00:00:00Z");

  it("bulk deletes anything under fourteen days old", () => {
    expect(isBulkDeletable(new Date("2026-09-13T00:00:00Z"), now)).toBe(true);
  });

  it("refuses to bulk delete anything older, which Discord rejects", () => {
    expect(isBulkDeletable(new Date("2026-08-20T00:00:00Z"), now)).toBe(false);
  });

  it("reports a plain total", () => {
    expect(describePurge({ bulkDeleted: 42, slowDeleted: 0, failed: 0 }, true)).toContain("Deleted 42 messages");
  });

  it("says how many needed the slow path", () => {
    const text = describePurge({ bulkDeleted: 10, slowDeleted: 3, failed: 0 }, true);
    expect(text).toContain("Deleted 13 messages");
    expect(text).toContain("older than 14 days");
  });

  it("reports failures rather than hiding them", () => {
    expect(describePurge({ bulkDeleted: 5, slowDeleted: 0, failed: 2 }, true)).toContain("2 could not be deleted");
  });

  it("says the conversation survives when the channel is one", () => {
    expect(describePurge({ bulkDeleted: 1, slowDeleted: 0, failed: 0 }, true)).toContain(
      "conversation itself is untouched",
    );
  });

  it("says nothing about /sync in a channel that is not a conversation", () => {
    const text = describePurge({ bulkDeleted: 1, slowDeleted: 0, failed: 0 }, false);
    expect(text).not.toContain("/sync");
    expect(text).not.toContain("conversation");
    expect(text).toContain("Deleted 1 message");
  });

  it("handles an already empty channel", () => {
    expect(describePurge({ bulkDeleted: 0, slowDeleted: 0, failed: 0 }, true)).toMatch(/already empty/);
  });

  it("round-trips the confirm and cancel buttons", () => {
    expect(parseCustomId(PURGE_CONFIRM).kind).toBe("purge-confirm");
    expect(parseCustomId(PURGE_CANCEL).kind).toBe("purge-cancel");
  });
});

describe("/clear is not passed through", () => {
  it("explains the two meanings instead of wiping session memory", () => {
    const result = classifyPrompt("/clear", ["doctor"]);
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.message).toContain("/purge");
  });

});

describe("attachment lifetime", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");

  it("keeps a file long enough for a follow-up to act on it", () => {
    expect(isExpired(Date.parse("2026-09-14T11:58:00Z"), now)).toBe(false);
  });

  it("expires a file once it is past the retention window", () => {
    expect(isExpired(Date.parse("2026-09-14T10:00:00Z"), now)).toBe(true);
  });

  it("retains for an hour", () => {
    expect(ATTACHMENT_TTL_MS).toBe(60 * 60 * 1000);
  });
});

describe("bridge system note", () => {
  const base = { sessionId: "s1", cwd: "/tmp", prompt: "hi", settings: {}, resume: true };

  it("tells the session it is on Discord", () => {
    const prompt = buildOptions(base).systemPrompt;
    expect(prompt).toMatchObject({ type: "preset", preset: "claude_code" });
    expect((prompt as { append?: string }).append).toContain("Discord");
  });

  it("appends rather than replacing, so the session keeps its own instructions", () => {
    expect((buildOptions(base).systemPrompt as { type?: string }).type).toBe("preset");
  });

  it("stays focused, since a long note dilutes the instructions inside it", () => {
    expect(bridgeSystemNote("s1").length).toBeLessThan(700);
  });

  it("asks for the progress remarks the activity log is built to show", () => {
    expect(bridgeSystemNote("s1")).toMatch(/think out loud/i);
  });
});

describe("turn queue", () => {

  it("runs the first message immediately", () => {
    expect(new TurnQueue().admit("s1").kind).toBe("run-now");
  });

  it("queues rather than dropping a message sent mid-turn", async () => {
    const queue = new TurnQueue();
    const order: string[] = [];
    const first = queue.enqueue("s1", async () => {
      await wait(30);
      order.push("first");
    });
    expect(queue.admit("s1")).toEqual({ kind: "queued", ahead: 1 });
    const second = queue.enqueue("s1", async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("keeps different conversations independent", async () => {
    const queue = new TurnQueue();
    const slow = queue.enqueue("s1", () => wait(40));
    expect(queue.admit("s2").kind).toBe("run-now");
    await slow;
  });

  it("refuses once the queue is full rather than growing without bound", async () => {
    const queue = new TurnQueue();
    const running = Array.from({ length: MAX_QUEUE_DEPTH }, () => queue.enqueue("s1", () => wait(20)));
    const outcome = queue.admit("s1");
    expect(outcome.kind).toBe("full");
    expect(outcome.kind === "full" && outcome.message).toContain("/stop");
    // The lane counts the running turn, so the refusal must not call all five of them queued.
    expect(outcome.kind === "full" && outcome.message).toContain("one running");
    await Promise.all(running);
  });

  it("a failed turn does not block what is queued behind it", async () => {
    const queue = new TurnQueue();
    const order: string[] = [];
    const failing = queue.enqueue("s1", async () => {
      await wait(10);
      throw new Error("turn blew up");
    });
    const after = queue.enqueue("s1", async () => {
      order.push("ran anyway");
    });
    await Promise.allSettled([failing, after]);
    expect(order).toEqual(["ran anyway"]);
  });

  it("empties itself so a later message runs immediately again", async () => {
    const queue = new TurnQueue();
    await queue.enqueue("s1", () => wait(5));
    expect(queue.depth("s1")).toBe(0);
    expect(queue.admit("s1").kind).toBe("run-now");
  });

  it("names how many are ahead", () => {
    expect(describeQueued(1)).toContain("still running");
    expect(describeQueued(3)).toContain("3 messages");
  });
});

describe("outbox", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-"));
  });

  const writeOutbox = async (name: string, contents: string | Buffer): Promise<void> => {
    const dir = outboxPath(cwd, "s1");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), contents);
  };

  it("returns nothing when the turn wrote no files", async () => {
    const result = await collectOutbox(cwd, "s1");
    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("collects what the turn left for the person", async () => {
    await writeOutbox("report.md", "# findings");
    const result = await collectOutbox(cwd, "s1");
    expect(result.files.map((file) => file.name)).toEqual(["report.md"]);
    expect(result.files[0]!.data.toString()).toBe("# findings");
  });

  it("removes a file once it has been delivered, so it is never sent twice", async () => {
    await writeOutbox("once.txt", "x");
    await (await collectOutbox(cwd, "s1")).discard();
    expect((await collectOutbox(cwd, "s1")).files).toEqual([]);
  });

  it("keeps a collected file until delivery is confirmed", async () => {
    await writeOutbox("retry.txt", "x");
    await collectOutbox(cwd, "s1");
    expect((await collectOutbox(cwd, "s1")).files.map((file) => file.name)).toEqual(["retry.txt"]);
  });

  it("skips a file too large for Discord rather than failing the turn", async () => {
    await writeOutbox("huge.bin", Buffer.alloc(MAX_FILE_BYTES + 1));
    const result = await collectOutbox(cwd, "s1");
    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual(["huge.bin"]);
  });

  it("leaves a skipped file on disk so it is not lost", async () => {
    await writeOutbox("huge.bin", Buffer.alloc(MAX_FILE_BYTES + 1));
    await collectOutbox(cwd, "s1");
    expect(await fs.readdir(outboxPath(cwd, "s1"))).toEqual(["huge.bin"]);
  });

  it("caps how many go in one message", async () => {
    for (let i = 0; i < MAX_FILES_PER_MESSAGE + 3; i++) await writeOutbox(`f${i}.txt`, "x");
    const result = await collectOutbox(cwd, "s1");
    expect(result.files).toHaveLength(MAX_FILES_PER_MESSAGE);
    expect(result.skipped).toHaveLength(3);
  });

  it("says where a skipped file still is", () => {
    expect(describeSkipped(["huge.bin"], "s1")).toContain(".discord-outbox");
    expect(describeSkipped([], "s1")).toBe("");
  });
});

describe("fork", () => {
  const base = { sessionId: "s1", cwd: "/tmp", prompt: "hi", settings: {}, resume: true };

  it("names the branch after the original by default", () => {
    expect(forkName("Release Notes")).toBe("Release Notes-fork");
  });

  it("uses a given name when there is one", () => {
    expect(forkName("Release Notes", "experiment")).toBe("experiment");
  });

  it("ignores a blank name", () => {
    expect(forkName("Release Notes", "   ")).toBe("Release Notes-fork");
  });

  it("never forks when creating a session, where there is nothing to fork from", () => {
    expect(buildOptions({ ...base, resume: false, fork: true }).forkSession).toBeUndefined();
  });
});

describe("the message limit reaches the model", () => {
  it("states the Discord cap so replies are written to fit", () => {
    expect(bridgeSystemNote("s1")).toContain(String(DISCORD_MESSAGE_LIMIT));
  });

  it("does not drift from the limit the renderer actually enforces", () => {
    const quoted = bridgeSystemNote("s1").match(/(\d{3,5}) characters/);
    expect(quoted).not.toBeNull();
    expect(Number(quoted![1])).toBe(DISCORD_MESSAGE_LIMIT);
  });

  it("points at the outbox as the better answer for long output", () => {
    expect(bridgeSystemNote("s1")).toContain(".discord-outbox");
  });
});

describe("deciding a message is for the bot", () => {
  const bot = "bot-id";
  const me = "me";
  const addressing = (over: Partial<Addressing> = {}): Addressing => ({
    mentionsBot: false,
    repliedAuthorId: null,
    botUserId: bot,
    authorId: me,
    ...over,
  });

  it("accepts an explicit tag", () => {
    expect(addressesBot(addressing({ mentionsBot: true }))).toBe(true);
  });

  it("accepts a reply to the bot even with the ping switched off", () => {
    expect(addressesBot(addressing({ repliedAuthorId: bot }))).toBe(true);
  });

  it("ignores a plain message", () => {
    expect(addressesBot(addressing())).toBe(false);
  });

  it("ignores a reply to somebody else", () => {
    expect(addressesBot(addressing({ repliedAuthorId: "someone-else" }))).toBe(false);
  });

  it("quotes the message when replying to another person", () => {
    expect(shouldQuoteReplied(addressing({ mentionsBot: true, repliedAuthorId: "someone-else" }))).toBe(true);
  });

  it("does not re-quote the bot's own message, which the session already has", () => {
    expect(shouldQuoteReplied(addressing({ repliedAuthorId: bot }))).toBe(false);
  });

  it("has nothing to quote when the message is not a reply", () => {
    expect(shouldQuoteReplied(addressing({ mentionsBot: true }))).toBe(false);
  });

  it("stays out of a reply aimed at another person", () => {
    expect(addressesSomeoneElse(addressing({ repliedAuthorId: "someone-else" }))).toBe(true);
  });

  it("joins a reply to another person once it is tagged in", () => {
    expect(
      addressesSomeoneElse(addressing({ mentionsBot: true, repliedAuthorId: "someone-else" })),
    ).toBe(false);
  });

  it("still hears someone replying to their own earlier message", () => {
    expect(addressesSomeoneElse(addressing({ repliedAuthorId: me }))).toBe(false);
  });

  it("still hears a reply to the bot", () => {
    expect(addressesSomeoneElse(addressing({ repliedAuthorId: bot }))).toBe(false);
  });

  it("still hears a plain message", () => {
    expect(addressesSomeoneElse(addressing())).toBe(false);
  });
});

describe("outbox tidiness", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-tidy-"));
  });

  it("removes the folder once everything in it has been sent", async () => {
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "a.txt"), "x");
    await (await collectOutbox(cwd, "s1")).discard();
    await expect(fs.stat(outboxPath(cwd, "s1"))).rejects.toThrow();
  });

  it("removes an empty folder a turn created but never used", async () => {
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await (await collectOutbox(cwd, "s1")).discard();
    await expect(fs.stat(outboxPath(cwd, "s1"))).rejects.toThrow();
  });

  it("keeps the folder when something was left behind", async () => {
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "huge.bin"), Buffer.alloc(MAX_FILE_BYTES + 1));
    await (await collectOutbox(cwd, "s1")).discard();
    expect(await fs.readdir(outboxPath(cwd, "s1"))).toEqual(["huge.bin"]);
  });
});

describe("the file limit reaches the model", () => {
  it("states a size cap so it does not write a file that will be refused", () => {
    expect(bridgeSystemNote("s1")).toMatch(/\d+ MB/);
  });

  it("does not drift from the limit the outbox actually enforces", () => {
    const quoted = bridgeSystemNote("s1").match(/(\d+) MB/);
    expect(quoted).not.toBeNull();
    expect(Number(quoted![1]) * 1024 * 1024).toBe(MAX_FILE_BYTES);
  });

  it("says what happens to something larger, rather than leaving it to be discovered", () => {
    expect(bridgeSystemNote("s1")).toMatch(/refused|too large/i);
  });
});


describe("command visibility", () => {
  const defs = bridgeCommandDefinitions();

  it("hides operator and owner commands from ordinary members", () => {
    const hidden = defs.filter((definition) => definition.default_member_permissions != null).map((definition) => definition.name);
    expect(hidden).toContain("create");
    expect(hidden).toContain("invite");
    expect(hidden).toContain("purge");
  });

  it("hides every command, since nobody below operator may run one", () => {
    const open = defs.filter((definition) => definition.default_member_permissions == null).map((definition) => definition.name);
    expect(open).toEqual([]);
  });
});

describe("OperatorStore", () => {
  let filePath: string;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "operators-"));
    filePath = path.join(dir, "operators.json");
  });

  it("starts empty when nothing has been stored", async () => {
    const store = new OperatorStore(filePath);
    await store.load();
    expect(store.all()).toEqual([]);
    expect(store.has("u1")).toBe(false);
  });

  it("remembers someone across a reload", async () => {
    const store = new OperatorStore(filePath);
    await store.load();
    await store.add("u1");

    const reopened = new OperatorStore(filePath);
    await reopened.load();
    expect(reopened.has("u1")).toBe(true);
  });

  it("reports whether the call changed anything", async () => {
    const store = new OperatorStore(filePath);
    await store.load();
    expect(await store.add("u1")).toBe(true);
    expect(await store.add("u1")).toBe(false);
    expect(await store.remove("u1")).toBe(true);
    expect(await store.remove("u1")).toBe(false);
  });

  it("survives a corrupt file rather than refusing to start", async () => {
    await fs.writeFile(filePath, "{ not json", "utf8");
    const store = new OperatorStore(filePath);
    await store.load();
    expect(store.all()).toEqual([]);
  });

  it("ignores entries that are not ids", async () => {
    await fs.writeFile(filePath, JSON.stringify(["u1", 42, null, "u2"]), "utf8");
    const store = new OperatorStore(filePath);
    await store.load();
    expect(store.all()).toEqual(["u1", "u2"]);
  });
});

describe("stopping drains the queue", () => {

  it("skips what has not started and leaves the running turn to its own stop", async () => {
    const queue = new TurnQueue();
    const order: string[] = [];
    const first = queue.enqueue("s1", async () => {
      await wait(30);
      order.push("first");
    });
    const second = queue.enqueue("s1", async () => void order.push("second"));
    const third = queue.enqueue("s1", async () => void order.push("third"));

    // The first message starts on the next tick, which is the earliest a stop can reach a turn.
    await wait(1);
    expect(queue.drain("s1")).toBe(2);
    expect(await Promise.all([first, second, third])).toEqual([true, false, false]);
    expect(order).toEqual(["first"]);
  });

  it("drains nothing from a conversation with nothing queued", () => {
    expect(new TurnQueue().drain("s1")).toBe(0);
  });

  it("empties the lane after a drain so the next message runs at once", async () => {
    const queue = new TurnQueue();
    const first = queue.enqueue("s1", () => wait(10));
    const second = queue.enqueue("s1", () => wait(10));
    queue.drain("s1");
    await Promise.all([first, second]);
    expect(queue.admit("s1").kind).toBe("run-now");
  });

  it("tells the stopper how many messages went with the turn", () => {
    expect(describeStop({ stopped: true, dropped: 0 })).toMatch(/^Stopped\./);
    expect(describeStop({ stopped: true, dropped: 0 })).not.toContain("dropped");
    expect(describeStop({ stopped: true, dropped: 1 })).toContain("The message queued behind it was dropped");
    expect(describeStop({ stopped: true, dropped: 3 })).toContain("3 messages queued behind it were dropped");
    expect(describeStop({ stopped: false, dropped: 0 })).toBe("Nothing is running here.");
  });

  it("points the full-queue refusal at a stop that clears everything", async () => {
    const queue = new TurnQueue();
    const running = Array.from({ length: MAX_QUEUE_DEPTH }, () => queue.enqueue("s1", () => wait(5)));
    const outcome = queue.admit("s1");
    expect(outcome.kind === "full" && outcome.message).toContain("everything queued");
    await Promise.all(running);
  });

  it("describes the lane for /queue", () => {
    expect(describeDepth(0)).toBe("Nothing is running here.");
    expect(describeDepth(1)).toContain("nothing queued");
    expect(describeDepth(2)).toContain("1 message queued");
    expect(describeDepth(4)).toContain("3 messages queued");
  });
});

describe("a repeated status reads as one line", () => {

  it("does not grow the trail when the same status arrives again", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(sink, () => 0);
    await status.start();
    status.noteOnce("Compacting the conversation, which can take a while.");
    status.noteOnce("Compacting the conversation, which can take a while.");
    status.noteOnce("Compacting the conversation, which can take a while.");
    await status.settle();
    expect(sink.written.at(-1)!.split("Compacting").length - 1).toBe(1);
  });

  it("still records the status again once something else has been said", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(sink, () => 0);
    await status.start();
    status.noteOnce("Compacting.");
    status.note("Reading the schema.");
    status.noteOnce("Compacting.");
    await status.settle();
    expect(sink.written.at(-1)!.split("Compacting").length - 1).toBe(2);
  });
});

describe("8.3 short paths", () => {
  it("expands a short segment to the long name Windows knows it by", () => {
    if (process.platform !== "win32") return;
    const short = os.tmpdir();
    if (!/~\d/.test(short)) return;
    expect(expandShortPath(short)).not.toMatch(/~\d/);
  });

  it("leaves a path without a short segment exactly as written", () => {
    expect(expandShortPath("/p/thing")).toBe("/p/thing");
  });

  it("does nothing outside Windows, where a tilde is just a character", () => {
    if (process.platform === "win32") return;
    expect(expandShortPath("/tmp/RUNNER~1")).toBe("/tmp/RUNNER~1");
  });
});

describe("isWithin", () => {
  it("is true for a folder inside the parent and false for the parent itself", () => {
    expect(isWithin("/p", "/p/thing")).toBe(true);
    expect(isWithin("/p", "/p/thing/deeper")).toBe(true);
    expect(isWithin("/p", "/p")).toBe(false);
  });

  it("does not mistake a sibling that shares a prefix", () => {
    expect(isWithin("/p", "/pthing")).toBe(false);
    expect(isWithin("/p", "/q/p")).toBe(false);
  });

  it("follows the platform's idea of case", () => {
    if (process.platform === "linux") return;
    expect(isWithin("/P", "/p/thing")).toBe(true);
  });
});

describe("scratch conversations stay out of the picker", () => {
  const scratch = record({ sessionId: "probe", cwd: path.join(longTmpDir(), "probe-1") });
  const real = record({ sessionId: "site", cwd: "/p/kitchen-site" });

  it("hides what works inside the temp folder and counts it", () => {
    const { shown, hidden } = withoutScratch([scratch, real]);
    expect(shown.map((record) => record.sessionId)).toEqual(["site"]);
    expect(hidden).toBe(1);
  });

  it("keeps a conversation with no directory, which is not scratch, just unknown", () => {
    const bare = record({ sessionId: "bare", cwd: null });
    expect(withoutScratch([bare]).shown).toEqual([bare]);
  });

  it("says how many were left out and how to see them", () => {
    expect(describeHidden(0)).toBe("");
    expect(describeHidden(1)).toContain("1 conversation in the temp folder is left out");
    expect(describeHidden(3)).toContain("3 conversations in the temp folder are left out");
    expect(describeHidden(3)).toContain("filter");
  });
});

describe("the saved extension follows the bytes", () => {
  it("renames an image whose name disagrees with what Discord says it is", () => {
    expect(extensionFor("shot.png", "image/webp")).toBe(".webp");
    expect(extensionFor("dump", "application/pdf")).toBe(".pdf");
  });

  it("keeps a name that already fits the type, as written", () => {
    expect(extensionFor("photo.JPEG", "image/jpeg")).toBe(".JPEG");
    expect(extensionFor("notes.md", null)).toBe(".md");
  });

  it("never renames source, whatever generic type Discord attaches to it", () => {
    expect(extensionFor("server.ts", "text/plain; charset=utf-8")).toBe(".ts");
    expect(extensionFor("deploy.sh", "application/octet-stream")).toBe(".sh");
  });
});

describe("a message with nothing left in it spends no turn", () => {
  it("is empty when there is no text and no file survived", () => {
    expect(nothingToSend("", 0)).toBe(true);
    expect(nothingToSend("   ", 0)).toBe(true);
  });

  it("still runs for text alone or a file alone", () => {
    expect(nothingToSend("look at this", 0)).toBe(false);
    expect(nothingToSend("", 1)).toBe(false);
  });
});

describe("plan usage", () => {
  const event = {
    status: "allowed",
    resetsAt: 1790109600,
    rateLimitType: "five_hour",
    unifiedWindows: {
      five_hour: { utilization: 0.17, resetsAt: 1790109600 },
      seven_day: { utilization: 0.04, resetsAt: 1790589600 },
    },
  };

  it("reads every window the CLI sends", () => {
    const windows = parsePlanUsage(event);
    expect(windows.get("five_hour")).toEqual({ utilization: 0.17, resetsAt: 1790109600 });
    expect(windows.get("seven_day")?.utilization).toBe(0.04);
  });

  it("falls back to the single-window shape the SDK documents", () => {
    const windows = parsePlanUsage({ rateLimitType: "five_hour", utilization: 0.5, resetsAt: 1 });
    expect(windows.get("five_hour")).toEqual({ utilization: 0.5, resetsAt: 1 });
  });

  it("ignores an event with nothing usable in it", () => {
    expect(parsePlanUsage({ status: "allowed" }).size).toBe(0);
    expect(parsePlanUsage(null).size).toBe(0);
  });

  it("renders percentages and Discord timestamps, and says when it was seen", () => {
    const usage = new PlanUsage();
    usage.record(event, new Date("2026-09-22T18:00:00Z"));
    const text = describePlanUsage(usage.latest());
    expect(text).toContain("5-hour window 17% used, resets <t:1790109600:R>");
    expect(text).toContain("week, all models 4% used");
    expect(text).toContain("as of <t:");
  });

  it("says so before any turn has reported", () => {
    expect(describePlanUsage(new PlanUsage().latest())).toContain("not reported yet");
  });

  it("keeps the latest value per window across turns", () => {
    const usage = new PlanUsage();
    usage.record(event);
    usage.record({ unifiedWindows: { five_hour: { utilization: 0.2, resetsAt: 1790109600 } } });
    expect(usage.latest()?.windows.get("five_hour")?.utilization).toBe(0.2);
    expect(usage.latest()?.windows.get("seven_day")?.utilization).toBe(0.04);
  });
});

describe("host defaults", () => {
  it("reads the model and effort Claude Code falls back to", () => {
    expect(parseHostDefaults(JSON.stringify({ model: "opus", effortLevel: "high" }))).toEqual({
      model: "opus",
      effort: "high",
    });
  });

  it("treats a missing key as no host default, not as an error", () => {
    expect(parseHostDefaults("{}")).toEqual({ model: null, effort: null });
    expect(parseHostDefaults("not json")).toEqual({ model: null, effort: null });
  });

  it("says where a value comes from, so 'session default' never has to be asked about", () => {
    expect(describeDefault("low", "high")).toBe("`low`");
    expect(describeDefault(undefined, "high")).toBe("`high` (host default)");
    expect(describeDefault(undefined, null)).toBe("Claude Code's default");
  });
});

describe("skills across several menus", () => {
  const names = (count: number) => Array.from({ length: count }, (_, index) => `skill-${String(index).padStart(3, "0")}`);

  it("splits sixty-three skills across three sorted menus and leaves none out", () => {
    const menus = skillSelectMenus(["zeta", ...names(62)]);
    expect(menus.pages.map((page) => page.length)).toEqual([25, 25, 13]);
    expect(menus.pages[0]![0]!.label).toBe("skill-000");
    expect(menus.pages[2]!.at(-1)!.label).toBe("zeta");
    expect(menus.omitted).toBe(0);
  });

  it("stops at the five menus a message can hold and counts the rest", () => {
    const menus = skillSelectMenus(names(130));
    expect(menus.pages).toHaveLength(DISCORD_MENUS_PER_MESSAGE);
    expect(menus.omitted).toBe(5);
  });

  it("labels each menu by the range it covers", () => {
    const menus = skillSelectMenus(names(30));
    expect(menuPlaceholder(menus.pages[0]!)).toBe("skill-000 to skill-024");
    expect(menuPlaceholder(menus.pages[1]!)).toBe("skill-025 to skill-029");
    expect(menuPlaceholder([{ label: "only", value: "only", description: "" }])).toBe("only");
  });

  it("tells the reader how many there are, and how to reach the ones that did not fit", () => {
    expect(describeSkillMenus(63, skillSelectMenus(names(63)))).toBe("63 skills available in this conversation, A to Z across 3 menus.");
    expect(describeSkillMenus(130, skillSelectMenus(names(130)))).toContain("The last 5 did not fit; send `/name`");
    expect(describeSkillMenus(1, skillSelectMenus(["one"]))).toBe("1 skill available in this conversation.");
  });

  it("reads a chosen skill from any page's menu", () => {
    expect(parseCustomId(skillSelectId(2), "superpowers:brainstorming")).toEqual({
      kind: "skill-chosen",
      skill: "superpowers:brainstorming",
    });
  });
});

describe("the ceiling comes only from automatic compactions", () => {
  const transcriptWith = async (records: object[]): Promise<string> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ceiling-"));
    const file = path.join(dir, "session.jsonl");
    await fs.writeFile(file, records.map((record) => JSON.stringify(record)).join("\n"), "utf8");
    return file;
  };

  it("ignores a manual compaction, which marks where someone asked rather than where the session fills", async () => {
    const file = await transcriptWith([
      { type: "system", compactMetadata: { trigger: "manual", preTokens: 42_012 } },
    ]);
    expect(await lastCompactionCeiling(file)).toBeNull();
  });

  it("learns from an automatic one", async () => {
    const file = await transcriptWith([
      { type: "system", compactMetadata: { trigger: "manual", preTokens: 42_012 } },
      { type: "system", compactMetadata: { trigger: "auto", preTokens: 951_650 } },
    ]);
    expect(await lastCompactionCeiling(file)).toBe(951_650);
  });
});

describe("an approval names a file the way the rest of the bridge does", () => {
  it("shows a path under the home folder as ~/ with forward slashes", () => {
    const text = describeRequest("Write", { file_path: path.join(os.homedir(), "Documents", "notes.txt") });
    expect(text).toContain("~/Documents/notes.txt");
    expect(text).not.toContain("\\");
  });

  it("still hides the home folder inside a command", () => {
    const text = describeRequest("Bash", { command: `cat ${path.join(os.homedir(), "x.txt")}` });
    expect(text).not.toContain(path.basename(os.homedir()));
  });
});

describe("an approval belongs to the turn that asked", () => {
  const OWNER = "owner-1";

  it("ending one conversation's turn leaves another conversation's prompt waiting", async () => {
    const prompts = new ApprovalPrompts();
    let otherId = "";
    const other = prompts.ask("turn-b", askingSink((actions) => void (otherId = actionId(actions, "approve"))), [OWNER], "Bash", { command: "ls" });
    await new Promise((resolve) => setTimeout(resolve, 5));

    prompts.finish("turn-a");
    expect(prompts.decide(otherId, OWNER, "approve")).toBe("Approved once.");
    expect(await other).toEqual({ allow: true });
  });

  it("still denies its own turn's pending prompt when that turn ends", async () => {
    const prompts = new ApprovalPrompts();
    const own = prompts.ask("turn-a", askingSink(() => undefined), [OWNER], "Bash", { command: "ls" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    prompts.finish("turn-a");
    expect((await own).allow).toBe(false);
  });
});

describe("redactHome matches the home folder, not words that happen to share its letters", () => {
  it("hides a path under the home folder", () => {
    expect(redactHome(`see ${path.join(os.homedir(), "code", "thing")}`)).toMatch(/see ~[\\/]code[\\/]thing/);
  });

  it("leaves a longer name that merely starts with the home path alone", () => {
    const longer = `${os.homedir()}ger`;
    expect(redactHome(longer)).toBe(longer);
  });

  it("does not touch the home folder's bare name in prose", () => {
    const word = path.basename(os.homedir());
    expect(redactHome(`the ${word} cause`)).toBe(`the ${word} cause`);
  });
});

describe("a channel named after a hyphenated conversation still binds to it", () => {
  const untitled = { ...record({ sessionId: "s", name: "x", cwd: "/p/claude-discord" }), name: null };

  it("matches by slug, which un-slugging would have lost", () => {
    expect(resolveByChannelName([untitled], "claude-discord").match?.sessionId).toBe("s");
  });

  it("falls back to name resolution for a channel that is not a slug of a folder", () => {
    const titled = record({ sessionId: "t", name: "Deploy Scripts" });
    expect(resolveByChannelName([titled], "deploy-scripts").match?.sessionId).toBe("t");
  });
});

describe("a download that fails is named, not skipped in silence", () => {
  it("reports the file and saves nothing for it", async () => {
    const { saved, failed } = await downloadAttachments(
      [{ url: "http://127.0.0.1:1/nothing", name: "shot.png", contentType: "image/png", size: 10 }],
      randomUUID(),
    );
    expect(saved).toEqual([]);
    expect(failed).toEqual(["shot.png"]);
    expect(describeUnfetched(failed)).toContain("`shot.png`");
    expect(describeUnfetched([])).toBeNull();
  });
});

describe("outbox delivery", () => {

  it("names a file it cannot attach once, not on every sweep", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-once-"));
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "huge.bin"), Buffer.alloc(MAX_FILE_BYTES + 1));
    const delivery = new OutboxDelivery();
    const sink = recordingSink();

    await delivery.deliver(cwd, "s1", sink);
    await delivery.deliver(cwd, "s1", sink);
    await delivery.deliver(cwd, "s1", sink);
    expect(sink.written.filter((line) => line.includes("huge.bin"))).toHaveLength(1);
  });

  it("names it again if it goes away and comes back", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-again-"));
    const big = path.join(outboxPath(cwd, "s1"), "huge.bin");
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(big, Buffer.alloc(MAX_FILE_BYTES + 1));
    const delivery = new OutboxDelivery();
    const sink = recordingSink();

    await delivery.deliver(cwd, "s1", sink);
    await fs.rm(big);
    await delivery.deliver(cwd, "s1", sink);
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(big, Buffer.alloc(MAX_FILE_BYTES + 1));
    await delivery.deliver(cwd, "s1", sink);
    expect(sink.written.filter((line) => line.includes("huge.bin"))).toHaveLength(2);
  });

  it("never sends one file twice when a sweep and the turn's delivery overlap", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-race-"));
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "report.md"), "done");
    const delivery = new OutboxDelivery();
    const sink = recordingSink();

    await Promise.all([delivery.deliver(cwd, "s1", sink), delivery.deliver(cwd, "s1", sink)]);
    expect(sink.files).toEqual(["report.md"]);
  });

  it("keeps one conversation's files out of another's channel in the same folder", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-two-"));
    await fs.mkdir(outboxPath(cwd, "private"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "private"), "secret.md"), "x");
    await fs.writeFile(path.join(cwd, OUTBOX_DIR, "loose.md"), "x");
    const delivery = new OutboxDelivery();
    const sink = recordingSink();

    expect(await delivery.hasFiles(cwd, "public")).toBe(false);
    await delivery.deliver(cwd, "public", sink);
    expect(sink.files).toEqual([]);
    expect(await delivery.hasFiles(cwd, "private")).toBe(true);
  });

  it("removes the parent folder too once the last conversation's folder is empty", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-parent-"));
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "a.txt"), "x");
    await (await collectOutbox(cwd, "s1")).discard();
    await expect(fs.stat(path.join(cwd, OUTBOX_DIR))).rejects.toThrow();
  });

  it("tells the session which folder is its own", () => {
    expect(bridgeSystemNote("11111111-2222-4333-8444-555555555555")).toContain(".discord-outbox/11111111-2222-4333-8444-555555555555/");
  });
});

describe("unbind offers to delete the channel", () => {
  it("round-trips both answers", () => {
    expect(parseCustomId(UNBIND_DELETE)).toEqual({ kind: "unbind-delete" });
    expect(parseCustomId(UNBIND_KEEP)).toEqual({ kind: "unbind-keep" });
  });
});
