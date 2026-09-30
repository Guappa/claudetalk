import { describe, it, expect, beforeEach, vi } from "vitest";
import { actionId, askingSink, menuAskingSink, quietSink, recordingSink, type MenuAsk } from "./helpers/sinks.ts";
import { record, usage, wait } from "./helpers/records.ts";
import { fakeChannel as fakeDiscordChannel } from "./helpers/discord.ts";
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
  killTree,
  longTmpDir,
  samePath,
  turnSpawnOptions,
} from "../src/platform.ts";
import { detectClaudeError } from "../src/claude/errors.ts";
import { buildOptions, bridgeSystemNote, foldResult, gate, resultError } from "../src/claude/runner.ts";
import { scanTranscript } from "../src/sessions/transcriptScanner.ts";
import { parseAgentsJson, readListing } from "../src/sessions/activeSessions.ts";
import { resolveByChannelName, resolveByFolder, resolveByName } from "../src/sessions/resolve.ts";
import { OutboxDelivery } from "../src/discord/outboxDelivery.ts";
import { randomUUID } from "node:crypto";
import { PENDING_TTL_MS, Pending, PendingCreates } from "../src/discord/pendingCreate.ts";
import { ConversationStore } from "../src/conversations.ts";
import { OperatorStore } from "../src/operators.ts";
import { bindingsPathFrom, loadConfig } from "../src/config.ts";
import { UsageLedger } from "../src/claude/usageLedger.ts";
import { PlanUsage, describePlanUsage, parsePlanUsage } from "../src/claude/planUsage.ts";
import { parseAuthStatus, SIGNED_OUT } from "../src/claude/auth.ts";
import { ApprovalPrompts, describeRequest } from "../src/discord/approvals.ts";
import { OTHER_VALUE, QUESTION_TIMEOUT_MS, QuestionPrompts, describeQuestions, menusFor } from "../src/discord/questions.ts";
import { parseQuestions, type Question } from "../src/claude/questions.ts";
import { HeldPrompt } from "../src/claude/heldPrompt.ts";
import {
  agentEvent,
  commandsChanged,
  parentToolUseId,
  takenUp,
  type ClaudeEvent,
  type SessionCommand,
} from "../src/claude/events.ts";
import { commandChoices, describeRun, refusal } from "../src/discord/commands/run.ts";
import { CapabilityCache } from "../src/claude/capabilities.ts";
import { AgentBoard, agentsTitle } from "../src/discord/agentBoard.ts";
import type { MessageSink } from "../src/discord/messageSink.ts";
import { isFromGuild } from "../src/discord/gate.ts";
import { chunkForDiscord, DISCORD_MESSAGE_LIMIT } from "../src/discord/renderer.ts";
import { choicesForDiscord, forDiscord, optionForDiscord, splitForDiscord } from "../src/discord/outgoing.ts";
import { StatusMessage, formatElapsed, renderActivity, tickIntervalMs } from "../src/discord/statusMessage.ts";
import { describeStop, preflight } from "../src/discord/turnFlow.ts";
import { ContextTracker } from "../src/claude/contextTracker.ts";
import { classifyPrompt, describeNotRun } from "../src/discord/commands/settings.ts";
import { describeClear } from "../src/discord/commands/clear.ts";
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
import { toChannelName } from "../src/discord/channelName.ts";
import { acquireInstanceLock, isLockHeld, lockPathBeside, STALE_AFTER_MS } from "../src/instanceLock.ts";
import { ActiveTurns } from "../src/discord/activeTurns.ts";
import {
  collectReferences,
  linkPlain,
  linkReferences,
  referenceLinks,
  remoteWebUrl,
  resolveReferences,
} from "../src/discord/repoLinks.ts";
import { execFile, execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { convertTables } from "../src/discord/tables.ts";
import { describeToolUse } from "../src/discord/toolTrail.ts";
import { defuseStrayMarkup } from "../src/discord/strayMarkup.ts";
import { STATE_EMOJI } from "../src/discord/reactions.ts";
import { describeSendNow, describeStopAgents, describeStopTurn } from "../src/discord/turnFlow.ts";
import { sendNowActionId, stopActionId, stopAgentsActionId, stopAllActionId } from "../src/discord/menus.ts";
import {
  DISCORD_MENUS_PER_MESSAGE,
  describeSkillMenus,
  menuPlaceholder,
  parsePluginList,
  pluginSelectOptions,
  skillSelectMenus,
} from "../src/claude/pluginCatalog.ts";
import {
  CLEAR_CANCEL,
  clearConfirmId,
  RUN_CANCEL,
  RUN_CONFIRM,
  PLUGIN_SELECT,
  PURGE_CANCEL,
  PURGE_CONFIRM,
  SKILL_SELECT,
  UNBIND_DELETE,
  UNBIND_KEEP,
  parseCustomId,
  pluginToggleId,
  questionOtherId,
  questionPickId,
  questionSkipId,
  questionSubmitId,
  skillSelectId,
} from "../src/discord/menus.ts";
import { describeDefault, parseHostDefaults, readHostDefaults } from "../src/claude/hostSettings.ts";
import { describePurge, isBulkDeletable, purgeChannel } from "../src/discord/purge.ts";
import { channelSink } from "../src/discord/sink.ts";
import { sweepOutboxes } from "../src/discord/outboxWatcher.ts";
import { truncate } from "../src/text.ts";
import { displayPath, homePatterns, redactHome, redactPaths } from "../src/displayPath.ts";
import { shortPrefix } from "../src/platform.ts";
import { EMBED_DESCRIPTION_LIMIT, EMBED_FIELD_LIMIT, detail } from "../src/discord/embeds.ts";
import {
  CHANNELS_PER_CATEGORY,
  MAX_CATEGORY_NAME,
  describeCategoryFull,
  findCategory,
  normaliseCategoryName,
} from "../src/discord/category.ts";
import { requestStop, stopRequestPath, takeStopRequest, watchForStop } from "../src/stopSignal.ts";
import { forkName } from "../src/discord/commands/fork.ts";
import { addressesBot, addressesSomeoneElse, shouldQuoteReplied, type Addressing } from "../src/discord/addressing.ts";
import {
  ATTACHMENT_TTL_MS,
  MAX_ATTACHMENT_BYTES,
  describeRefused,
  describeUnfetched,
  downloadAttachments,
  extensionFor,
  isExpired,
  keepAttachmentsAwhile,
  screenAttachments,
  sweepAttachments,
} from "../src/attachments.ts";
import { nothingToSend } from "../src/discord/handlers/message.ts";
import { sayIn } from "../src/i18n/index.ts";
import { TurnQueue, describeDepth, describeFull, describeQueued, MAX_QUEUE_DEPTH } from "../src/discord/turnQueue.ts";
import {
  collectOutbox,
  describeSkipped,
  outboxPath,
  MAX_FILE_BYTES,
  MAX_FILES_PER_MESSAGE,
  MAX_MESSAGE_BYTES,
  OUTBOX_DIR,
  SETTLE_MS,
} from "../src/discord/outbox.ts";
import { readExchanges, readExchangesSince, lastExchanges, lastCompactionCeiling } from "../src/sessions/exchanges.ts";
import { SessionIndex } from "../src/sessions/index.ts";
import { readTail } from "../src/sessions/transcriptTail.ts";
import { formatExchanges, describeDrift, latestThatFit } from "../src/discord/transcriptView.ts";
import { attributionOnly, buildContext, composePrompt, noContext, stripBotMention } from "../src/discord/context.ts";
import { bridgeCommandDefinitions } from "../src/discord/commands/registry.ts";
import { workingDirFor } from "../src/discord/policy.ts";
import { tierFor, canRunCommand, workspaceFor } from "../src/access.ts";
import { conversationOverwrites } from "../src/discord/channelAccess.ts";
import { PermissionFlagsBits } from "discord.js";

const say = sayIn("en");
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

  // Claude Code words a resume of an id it holds no transcript for this way, as the errors of a failed result.
  it("recognises a resume of a session Claude Code does not have", () => {
    const refused = ["No conversation found with session ID: 11111111-2222-4333-8444-555555555555"];
    expect(resultError("error_during_execution", refused)).toEqual({ kind: "unknown-session" });
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

  // No typed option covers autocompact, so it travels as a flag of its own.
  it("still reaches autocompact through the escape hatch", () => {
    const options = buildOptions({ ...base, resume: true, settings: { autocompact: "false" } });
    expect(options.extraArgs).toEqual({ "replay-user-messages": null, autocompact: "false" });
  });

  it("gates nothing unless the turn was given an approver", () => {
    expect(buildOptions({ ...base, resume: true }).hooks).toBeUndefined();
  });

  // Claude Code offers the question tool only to a client that can prompt, so a turn that can answer declares one.
  it("declares a prompt surface only when the turn can answer questions", () => {
    expect(buildOptions({ ...base, resume: true }).permissionPromptToolName).toBeUndefined();
    const options = buildOptions({ ...base, resume: true, askQuestions: async () => ({ answered: false, reason: "" }) });
    expect(options.permissionPromptToolName).toBe("stdio");
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

  // Claude Code stamps each record with where its shell stands, so the last one is often a subfolder the session only visited.
  describe("the directory a session belongs to", () => {
    const transcriptIn = async (projectFolder: string, stamps: string[]): Promise<string> => {
      const folder = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "stamped-")), projectFolder);
      await fs.mkdir(folder, { recursive: true });
      const records = stamps.map((cwd) => JSON.stringify({ type: "user", cwd, timestamp: "2026-09-10T10:00:00.000Z" }));
      const file = path.join(folder, "session.jsonl");
      await fs.writeFile(file, `${records.join("\n")}\n`);
      return file;
    };

    it("is the one its folder is named after, not wherever the shell went last", async () => {
      const file = await transcriptIn("-srv-app", ["/srv/app", "/srv/app/scripts", "/srv/app/scripts"]);
      expect((await scanTranscript(file)).cwd).toBe("/srv/app");
    });

    it("is found above the shell's directory when the tail only shows the subfolder", async () => {
      const file = await transcriptIn("-srv-app", ["/srv/app/scripts/deep", "/srv/app/scripts"]);
      expect((await scanTranscript(file)).cwd).toBe("/srv/app");
    });

    it("reads a Windows path the same way, drive letter in either case", async () => {
      const file = await transcriptIn("C--work-my-app", ["c:\\work\\my app\\tools\\release"]);
      expect((await scanTranscript(file)).cwd).toBe("c:\\work\\my app");
    });

    // Claude Code cuts a folder's name at 200 characters and ends it with a hash of the whole path.
    it("is found for a path too long for its folder's name to hold", async () => {
      const started = `/srv/${"a-rather-long-folder-name-for-a-project/".repeat(5)}app`;
      const folder = `${started.replace(/[^A-Za-z0-9]/g, "-").slice(0, 200)}-87cf77`;
      const file = await transcriptIn(folder, [started, `${started}/scripts`]);
      expect((await scanTranscript(file)).cwd).toBe(started);

      const stamped = `c:\\work\\${"a rather long folder name for a project\\".repeat(5)}app`;
      const named = `C${stamped
        .slice(1)
        .replace(/[^A-Za-z0-9]/g, "-")
        .slice(0, 199)}-zgx6i8`;
      const onWindows = await transcriptIn(named, [`${stamped}\\tools\\release`]);
      expect((await scanTranscript(onWindows)).cwd).toBe(stamped);
    });

    it("falls back to the last directory stamped when none matches the folder's name", async () => {
      const file = await transcriptIn("somewhere-else", ["/srv/app", "/srv/app/scripts"]);
      expect((await scanTranscript(file)).cwd).toBe("/srv/app/scripts");
    });
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

  // Loaded as empty, the next save would write that emptiness over every binding.
  it("refuses to load a file that does not parse, and leaves it exactly as it was", async () => {
    const damaged = '{ "conversations": { "keep": { "sessionId": "keep" } }, "channelIndex": { "c1": "keep" }, }';
    await fs.writeFile(file, damaged, "utf8");
    const store = new ConversationStore(file);

    await expect(store.load()).rejects.toThrow(/not valid JSON[\s\S]*Nothing was changed[\s\S]*move it aside/);
    expect(await fs.readFile(file, "utf8")).toBe(damaged);
  });

  it("starts empty when there is no file yet", async () => {
    const store = new ConversationStore(file);
    await store.load();
    expect(store.all()).toEqual([]);
  });

  // Saves that overlap must not share a temporary file, or one loses its rename to the other.
  it("lands every save when several overlap, and ends holding the last state", async () => {
    const store = new ConversationStore(file);
    await store.load();
    for (let index = 0; index < 5; index += 1) {
      await store.bindNew({ sessionId: `s${index}`, cwd: "/tmp", channelId: `c${index}`, ownerId: "u1" });
    }
    for (let round = 0; round < 10; round += 1) {
      const stamp = new Date(Date.UTC(2026, 8, 1, 12, round)).toISOString();
      const saves = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => store.markSynced(`s${index}`, stamp)));
      expect(saves.filter((save) => save.status === "rejected")).toEqual([]);
    }
    const onDisk = JSON.parse(await fs.readFile(file, "utf8")) as { conversations: Record<string, { syncedThrough: string }> };
    expect(Object.values(onDisk.conversations).map((entry) => entry.syncedThrough)).toEqual(
      Array.from({ length: 5 }, () => new Date(Date.UTC(2026, 8, 1, 12, 9)).toISOString()),
    );
    expect((await fs.readdir(path.dirname(file))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  // A voice channel left in the index routes into whatever is bound under the same session next.
  it("forgets every channel of a conversation when its text channel is unbound", async () => {
    const store = new ConversationStore(file);
    await store.load();
    await store.bindNew({ sessionId: "s1", cwd: "/tmp", channelId: "text-1", ownerId: "u1" });
    await store.attachChannel("s1", "voice-1", "voice");
    await store.unbind("text-1");

    await store.bindNew({ sessionId: "s1", cwd: "/tmp", channelId: "text-2", ownerId: "u1" });
    expect(store.byChannel("voice-1")).toBeUndefined();
    expect(store.byChannel("text-2")?.sessionId).toBe("s1");
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

describe("where the lock lives", () => {
  it("is beside the bindings, wherever the setting puts them", () => {
    expect(lockPathBeside(bindingsPathFrom({}))).toBe(path.join("data", "bridge.lock"));
    const elsewhere = path.join("srv", "bridge", "conversations.json");
    expect(lockPathBeside(bindingsPathFrom({ BINDINGS_PATH: ` ${elsewhere} ` }))).toBe(path.join("srv", "bridge", "bridge.lock"));
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
    const text = `\`\`\`ts\n${"const value = 1;\n".repeat(300)}\`\`\``;
    const chunks = chunkForDiscord(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.endsWith("```")).toBe(true);
    expect(chunks[1]!.startsWith("```")).toBe(true);
  });

  it("gives nothing for empty text, leaving what stands in for it to the caller", () => {
    expect(chunkForDiscord("")).toEqual([]);
  });

  // An opener closed at once is an empty code block, with the code after it outside any block.
  it("does not leave an empty code block when a fenced line needs a chunk to itself", () => {
    const chunks = chunkForDiscord(`\`\`\`\n${"x".repeat(1995)}\n\`\`\``);
    expect(chunks).not.toContain("```\n```");
    expect(chunks.every((chunk) => chunk.length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
    expect(chunks.every((chunk) => chunk.startsWith("```") && chunk.endsWith("```"))).toBe(true);
  });

  it("moves a fence that opens on a chunk's last line to the next chunk, whole", () => {
    // 1,980 characters of prose leave room for the opener and its closing fence, and for no line of code after it.
    const filler = [...Array.from({ length: 39 }, () => "y".repeat(49)), "y".repeat(29)].join("\n");
    const chunks = chunkForDiscord(`${filler}\n\`\`\`js\n${"const value = 1;\n".repeat(20)}\`\`\``);
    expect(chunks.every((chunk) => chunk.length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
    expect(chunks[0]).not.toContain("```");
    expect(chunks[1]?.startsWith("```js\n")).toBe(true);
  });

  it("keeps a fence indented under a list item closed and reopened across chunks", () => {
    const chunks = chunkForDiscord(`- item\n   \`\`\`js\n${"const value = 1;\n".repeat(200)}   \`\`\`\nafter`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(1, -1)) {
      expect(chunk.startsWith("   ```js\n")).toBe(true);
      expect(chunk.endsWith("\n```")).toBe(true);
    }
    expect(chunks.at(-1)).toContain("after");
  });

  it("does not take a one-line block, or a fence quoted inside a block, for a fence opening or closing", () => {
    const oneLine = chunkForDiscord(`\`\`\`echo hi\`\`\`\n${"word ".repeat(450)}`);
    expect(oneLine.at(-1)?.endsWith("```")).toBe(false);

    const quoted = chunkForDiscord(`\`\`\`md\n\`\`\`python\n${"print(1)\n".repeat(300)}\`\`\``);
    expect(quoted.every((chunk) => chunk.startsWith("```md") && chunk.endsWith("```"))).toBe(true);
  });

  // Markdown that itself holds a code block is shown inside a longer fence, which a shorter one inside it does not close.
  it("closes a fence only on a line of at least as many backticks as opened it", () => {
    const shown = ["Put this in README.md:", "````md", "## Usage", "```bash", "npm run stop", "```", "````", "That is all."].join(
      "\n",
    );
    expect(chunkForDiscord(shown)).toEqual([shown]);

    const table = "| a | b |\n|---|---|\n| 1 | 2 |";
    expect(convertTables(`${shown}\n${table}`)).toBe(`${shown}\n- **1**: 2`);
    const quoted = ["````md", table, "````"].join("\n");
    expect(convertTables(quoted)).toBe(quoted);

    const inner = "```sh\nls\n```\n".repeat(200);
    const long = chunkForDiscord(["````md", `${inner}\`\`\`\``, "after"].join("\n"));
    expect(long.length).toBeGreaterThan(1);
    expect(long.slice(0, -1).every((chunk) => chunk.startsWith("````md") && chunk.endsWith("````"))).toBe(true);
    expect(long.at(-1)?.endsWith("after")).toBe(true);
  });

  // The opener is carried into every later chunk, so a line of content that merely starts with a fence must not be carried whole.
  it("carries only a fence and its language into the next chunk, however long the line that opened it", () => {
    const body = "x".repeat(3000);
    const pieces = chunkForDiscord(["```".concat(body), "last line"].join("\n"));
    expect(pieces.every((piece) => piece.length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
    expect(pieces.join("").split("x").length - 1).toBe(3000);

    const tagged = chunkForDiscord(["```python", "print(1)\n".repeat(400).trimEnd(), "```"].join("\n"));
    expect(tagged.every((piece) => piece.startsWith("```python\n"))).toBe(true);
  });
});

describe("an answer with a very long line that starts a fence", () => {
  // The split is tightened when prose grows under escaping, and a limit that leaves such a line no room would never advance.
  it("is split, and every piece fits, where the prose around it grows when escaped", () => {
    const prose = Array.from({ length: 12 }, () => "the x_y_z and a_b_c of 2 * 3 [ then".repeat(4)).join("\n");
    for (const width of [1000, 1300, 1647, 1690, 3000]) {
      const pieces = splitForDiscord([prose, "```".concat("x".repeat(width)), "done"].join("\n"));
      expect(
        pieces.every((piece) => forDiscord(piece).length <= DISCORD_MESSAGE_LIMIT),
        String(width),
      ).toBe(true);
      expect(pieces.join("").split("x").length - 1, String(width)).toBeGreaterThanOrEqual(width);
    }
  });

  it("leaves the room it is asked to, for a heading that goes above the first piece", () => {
    const answer = Array.from({ length: 60 }, (_, index) => `Point ${index + 1}: `.padEnd(99, "y")).join("\n");
    expect(splitForDiscord(answer, 1900).every((piece) => forDiscord(piece).length <= 1900)).toBe(true);
  });
});

describe("a command typed as a message", () => {
  it("is known by a name holding an underscore or a dot, as plugins name theirs", () => {
    for (const typed of ["/my_plugin:do_it now", "/tools.v2 x", "/ledger:audit 2026"]) {
      expect(classifyPrompt(typed, [], []).kind, typed).toBe("passthrough");
    }
    expect(classifyPrompt("/1st", [], []).kind).toBe("turn");
  });

  // The refusal points at a command of the bridge's own, which has to exist.
  it("refuses only the settings the bridge has a command of its own for", () => {
    for (const owned of ["/model opus", "/effort high"]) expect(classifyPrompt(owned, [], []).kind, owned).toBe("bridge-owned");
    for (const passed of ["/autocompact", "/agent reviewer", "/fallback-model sonnet"]) {
      expect(classifyPrompt(passed, [], []).kind, passed).toBe("passthrough");
    }
  });
});

describe("the conversation store", () => {
  it("forgets the conversation a channel held when another is bound to it", async () => {
    const store = new ConversationStore(path.join(await fs.mkdtemp(path.join(os.tmpdir(), "conv-")), "conversations.json"));
    await store.load();
    await store.bindNew({ sessionId: "first", cwd: "/srv/app", channelId: "c1", ownerId: "o" });
    await store.bindNew({ sessionId: "second", cwd: "/srv/app", channelId: "c1", ownerId: "o" });

    expect(store.all().map((conversation) => conversation.sessionId)).toEqual(["second"]);
    expect(store.bySession("first")).toBeUndefined();
  });
});

describe("the outbox sweep", () => {
  it("delivers for the conversations after one whose delivery fails, and says the failure once", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sweep-"));
    for (const session of ["broken", "fine"]) {
      await fs.mkdir(outboxPath(cwd, session), { recursive: true });
      await fs.writeFile(path.join(outboxPath(cwd, session), "report.md"), "done");
      await fs.utimes(path.join(outboxPath(cwd, session), "report.md"), new Date(0), new Date(0));
    }
    const sent: string[] = [];
    const channel = (id: string) => ({
      id,
      isSendable: () => true,
      send: async () => {
        if (id === "c-broken") throw new Error("Missing Permissions");
        sent.push(id);
        return { id: `${id}-1` };
      },
    });
    const bridge = {
      store: { all: () => ["broken", "fine"].map((sessionId) => ({ sessionId, cwd, channels: { text: `c-${sessionId}` } })) },
      outbox: new OutboxDelivery(),
      language: { say },
      latestPosts: new Map<string, string>(),
    };
    const client = { channels: { fetch: async (id: string) => channel(id) } };
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const failing = new Set<string>();
      await sweepOutboxes(bridge as never, client as never, failing);
      await sweepOutboxes(bridge as never, client as never, failing);
      expect(sent).toEqual(["c-fine"]);
      expect(logged).toHaveBeenCalledOnce();
    } finally {
      logged.mockRestore();
    }
  });
});

describe("a home path in what is posted", () => {
  const home = os.homedir();
  const account = path.basename(home);

  // The gate sees a piece at a time, and half a path is not a path to it.
  it("is redacted before an answer is cut, so a cut that falls inside one leaks none of it", () => {
    const line = `${"w".repeat(1990)} ${path.join(home, "Documents", "notes.md")} and on`;
    const pieces = splitForDiscord(line);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map(forDiscord).join("")).not.toContain(account);
  });

  it("is redacted in an embed's description and fields, and in what a menu shows", () => {
    const where = path.join(home, "Documents", "ledger");
    const embed = detail(`Title in ${where}`, `Runs in ${where}`, [{ name: `Folder ${where}`, value: where }]).toJSON();
    expect(JSON.stringify(embed)).not.toContain(account);

    expect(JSON.stringify(optionForDiscord({ label: where, value: where, description: `in ${where}` }))).toBe(
      JSON.stringify({ label: redactHome(where), value: where, description: `in ${redactHome(where)}` }),
    );
    expect(choicesForDiscord([{ name: `run in ${where}`, value: "x" }])[0]!.name).not.toContain(account);
  });
});

describe("splitForDiscord", () => {
  // Escaping lengthens a piece, and Discord refuses one over the limit, so an answer cut before escaping may never appear.
  it("cuts pieces that still fit once stray markers in them are escaped", () => {
    const answer = Array.from({ length: 200 }, () => "word my_var_name other_var_name and 2 * 3 then").join("\n");
    expect(chunkForDiscord(answer).some((piece) => forDiscord(piece).length > DISCORD_MESSAGE_LIMIT)).toBe(true);

    const pieces = splitForDiscord(answer);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((piece) => forDiscord(piece).length).every((length) => length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
    expect(pieces.join("\n")).toBe(answer);
  });

  it("fits even a text made of nothing but markers", () => {
    const pieces = splitForDiscord("_".repeat(5000));
    expect(pieces.every((piece) => forDiscord(piece).length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
  });

  it("leaves a text that needs no escaping cut at the full limit", () => {
    const plain = Array.from({ length: 300 }, () => "plain words only").join("\n");
    expect(splitForDiscord(plain)).toEqual(chunkForDiscord(plain));
  });
});

describe("StatusMessage", () => {
  it("shows the turn as working before anything has happened", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.stop();
    expect(sink.written.at(-1)).toBe("⏳ **Working** 0s");
  });

  it("replaces the activity log with the answer when the turn ends", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("Looking at the schema first.");
    await status.finish("Done.");
    expect(sink.written.at(-1)).toBe("Done.");
  });

  it("does not keep the answer in the trail it is about to be posted under", () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    status.note("Weighing whether the field is optional.");
    status.note("It is optional, so the validator warns rather than fails.");
    status.dropEcho("It is optional, so the validator warns rather than fails.");
    expect(status.hasNotes()).toBe(true);
  });

  it("leaves no trail at all when the only thing said was the answer", () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    status.note("The tree is clean, nothing to back out.");
    status.dropEcho("The tree is clean, nothing to back out.");
    expect(status.hasNotes()).toBe(false);
  });

  it("matches a remark that was cut short against the full answer", () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    const long = "a".repeat(2500);
    status.note(long);
    status.dropEcho(long);
    expect(status.hasNotes()).toBe(false);
  });

  it("takes the answer back however many times it was said as a remark", () => {
    const status = new StatusMessage(say, recordingSink(), () => 0);
    const answer = `Summary of the change.\n\n${"z".repeat(2400)}`;
    status.note("Checking the diff first.");
    status.note(answer);
    status.note(answer);
    status.dropEcho(answer);
    expect(status.currentIsEmpty()).toBe(false);
    status.dropEcho("Checking the diff first.");
    expect(status.hasNotes()).toBe(false);
  });

  it("keeps a remark the answer does not repeat", () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    status.note("Checking the schema first.");
    status.dropEcho("Something else entirely.");
    expect(status.hasNotes()).toBe(true);
  });

  it("ignores an empty thought rather than logging a blank line", () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    status.note("   ");
    status.note("");
    expect(status.hasNotes()).toBe(false);
  });

  // The terminal scrolls; a trail that no longer fits carries on below instead of eliding what came first.
  it("continues in a new message once the trail would not fit, keeping every remark in order", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(
      say,
      sink,
      () => 0,
      () => [{ id: "stop", label: "Stop" }],
    );
    await status.start();
    const remarks = Array.from({ length: 12 }, (_, index) => `Remark ${index + 1}: ${"x".repeat(240)}`);
    for (const remark of remarks) status.note(remark);
    await status.settle();

    expect(sink.messages.length).toBeGreaterThan(1);
    const joined = sink.messages.join("\n");
    for (const remark of remarks) expect(joined).toContain(remark);
    expect(joined).not.toContain("...");
    for (const message of sink.messages) expect(message.length).toBeLessThan(2000);
    expect(sink.messages.map((message) => message.indexOf("Remark 12")).filter((at) => at >= 0)).toHaveLength(1);
    expect(sink.messages.at(-1)).toContain("**Worked**");
  });

  it("moves the trail below anything lasting posted beneath it, rather than writing above it", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("Before the question.");
    sink.othersBelow = true;
    status.note("After the question.");
    await status.settle();

    expect(sink.messages[0]).toBe("Before the question.");
    expect(sink.messages[1]).toContain("After the question.");
    expect(sink.messages[1]).not.toContain("Before the question.");
    expect(status.hasNotes()).toBe(true);
  });

  // Several remarks can land in one stream chunk before the queued move has run; they belong to the same new message.
  it("moves once for a burst of remarks arriving while the trail is still buried", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("Before.");
    sink.othersBelow = true;
    status.note("After one.");
    status.note("After two.");
    status.note("After three.");
    await status.settle();

    expect(sink.messages).toHaveLength(2);
    expect(sink.messages[1]).toContain("After one.");
    expect(sink.messages[1]).toContain("After three.");
  });

  it("leaves a plain marker, not a live heading, when it moves before any remark was made", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    sink.othersBelow = true;
    status.note("First remark, after an approval prompt.");
    await status.settle();

    expect(sink.messages[0]).toBe("**Started**");
    expect(sink.messages[0]).not.toContain("Working");
  });

  // Links are resolved once per message, when it is final, never on the two-second edits.
  it("finalizes a sealed segment and the settled trail, and nothing in between", async () => {
    const sink = recordingSink();
    const finalize = vi.fn(async (text: string) => text.replace("e2ea070", "[e2ea070](<url>)"));
    const status = new StatusMessage(
      say,
      sink,
      () => 0,
      () => [],
      undefined,
      finalize,
    );
    await status.start();
    status.note("Landed e2ea070.");
    sink.othersBelow = true;
    status.note("Then more.");
    await status.settle();

    expect(finalize).toHaveBeenCalledTimes(2);
    expect(sink.messages[0]).toBe("Landed [e2ea070](<url>).");
    expect(sink.messages[1]).toContain("**Worked**");
  });

  // The answer arrives as the last remark a moment before the turn ends, and an edit can fall in that moment.
  it("does not seal part of a long last remark into the trail, since it may be the answer posted beneath", async () => {
    const sink = recordingSink();
    vi.useFakeTimers();
    try {
      const status = new StatusMessage(say, sink);
      await status.start();
      status.note("Reading the three reports first.");
      const answer = Array.from({ length: 40 }, (_, index) => `Point ${index + 1}: ${"y".repeat(90)}`).join("\n");
      status.note(answer);
      await vi.advanceTimersByTimeAsync(2500);
      status.dropEcho(answer);
      await status.settle();
    } finally {
      vi.useRealTimers();
    }

    const trail = sink.messages.join("\n");
    expect(trail).toContain("Reading the three reports first.");
    expect(trail).not.toContain("Point 1:");
  });

  // A link is several times the length of the reference it replaces, and the trail is measured before it is linked.
  it("settles with its references unlinked when linking them would take it past what a message holds", async () => {
    const sink = recordingSink();
    const edit = sink.edit;
    sink.edit = async (text, actions) => {
      if (text.length > 2000) throw new Error("Invalid Form Body: content must be 2000 or fewer in length");
      await edit(text, actions);
    };
    const linked = async (text: string): Promise<string> =>
      text.replaceAll("notes.md", `[notes.md](<https://example.com/${"p".repeat(110)}>)`);
    const status = new StatusMessage(
      say,
      sink,
      () => 0,
      () => [],
      undefined,
      linked,
    );
    await status.start();
    for (let remark = 1; remark <= 8; remark += 1) status.note(`Step ${remark}: read notes.md. ${"w".repeat(140)}`);
    await status.settle("done");

    const trail = sink.messages.at(-1)!;
    expect(trail).toContain("**Worked**");
    expect(trail).toContain("Step 8: read notes.md.");
    expect(trail).not.toContain("https://example.com");

    const brief = recordingSink();
    const short = new StatusMessage(
      say,
      brief,
      () => 0,
      () => [],
      undefined,
      linked,
    );
    await short.start();
    short.note("Read notes.md.");
    await short.settle("done");
    expect(brief.messages.at(-1)).toContain("https://example.com");
  });

  it("tells the turn each time the trail moves, so the interruption record can follow", async () => {
    const sink = recordingSink();
    const moved = vi.fn(async () => undefined);
    const status = new StatusMessage(
      say,
      sink,
      () => 0,
      () => [],
      moved,
    );
    await status.start();
    status.note("First.");
    sink.othersBelow = true;
    status.note("Second.");
    await status.settle();
    expect(moved).toHaveBeenCalledTimes(1);
  });
});

describe("stop requests", () => {
  let lockPath: string;

  beforeEach(async () => {
    lockPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "stop-")), "bridge.lock");
  });

  it("is consumed exactly once, so a stale request cannot stop the next run", async () => {
    await requestStop(lockPath);
    expect(await takeStopRequest(lockPath)).toBe("drain");
    expect(await takeStopRequest(lockPath)).toBeNull();
  });

  it("reports nothing when no stop was asked for", async () => {
    expect(await takeStopRequest(lockPath)).toBeNull();
  });

  it("carries the mode, and reads an older timestamp request as a drain", async () => {
    await requestStop(lockPath, "now");
    expect(await takeStopRequest(lockPath)).toBe("now");
    await fs.writeFile(stopRequestPath(lockPath), "2026-01-01T00:00:00.000Z");
    expect(await takeStopRequest(lockPath)).toBe("drain");
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

// Paths are assembled from pieces: the private scan rightly refuses a literal home path or short name in the tree.
describe("no account's path reaches Discord, whoever's it is and however it is spelled", () => {
  const users = ["C:", "Users"].join("\\");
  const home = [users, "Pat Doe"].join("\\");
  const shortHome = [users, "PATDOE" + "~1"].join("\\");
  const ownHome = homePatterns([home, shortHome]);
  const slashed = (value: string) => value.split("\\").join("/");

  it("turns every spelling of the running account's home into ~", () => {
    const flattened = "C--Users-Pat-Doe-Documents-projects-ledger";
    const cases: Array<[string, string]> = [
      [
        `tail -40 "${slashed(shortHome)}/AppData/Local/Temp/claude/${flattened}/abc/tasks/x.output"`,
        `tail -40 "~/AppData/Local/Temp/claude/~-Documents-projects-ledger/abc/tasks/x.output"`,
      ],
      [`~/.claude/projects/${flattened}/memory/notes.md`, "~/.claude/projects/~-Documents-projects-ledger/memory/notes.md"],
      [`open file:///${slashed(home).replaceAll(" ", "%20")}/notes.md`, "open file:///~/notes.md"],
      [`cd ${home}\\ledger`, "cd ~\\ledger"],
    ];
    for (const [text, expected] of cases) expect(redactPaths(text, ownHome)).toBe(expected);
  });

  it("hides the account in anyone else's home path by its shape alone", () => {
    const cases: Array<[string, string]> = [
      [[users, "Sam", "repo", "x.ts"].join("\\"), [users, "…", "repo", "x.ts"].join("\\")],
      [[users, "SAMUEL" + "~1", "x"].join("\\"), [users, "…", "x"].join("\\")],
      ["/c/" + "Users/" + "Sam/x", "/c/Users/…/x"],
      ["/home/" + "sam/src", "/home/…/src"],
      ["/Users/" + "sam/Desktop", "/Users/…/Desktop"],
      [`"${slashed(users)}/Jo Ann/notes"`, `"${slashed(users)}/…/notes"`],
    ];
    for (const [text, expected] of cases) expect(redactPaths(text, ownHome)).toBe(expected);
  });

  it("leaves shared folders, look-alike names and web addresses alone, and settles after one pass", () => {
    const untouched = [
      [users, "Public", "Documents"].join("\\"),
      "/Users/" + "Shared/x",
      "https://example.com/home/about",
      "C--Users-Pat-Doe2-elsewhere",
      "the Users folder",
    ];
    for (const text of untouched) expect(redactPaths(text, ownHome)).toBe(text);
    const once = redactPaths(`${home}\\a and ${[users, "Sam", "b"].join("\\")}`, ownHome);
    expect(redactPaths(once, ownHome)).toBe(once);
  });

  // WSL spells a Windows home under /mnt/c and Cygwin under /cygdrive/c, and a command run through either carries that spelling.
  it("knows the home as WSL and Cygwin spell it, and at the end of a sentence", () => {
    const cases: Array<[string, string]> = [
      [`cd '/mnt${slashed(home).replace("C:", "/c")}/Documents/projects/x'`, "cd '~/Documents/projects/x'"],
      [`ls /cygdrive${slashed(home).replace("C:", "/c")}/Documents`, "ls ~/Documents"],
      [`It is in ${home}.`, "It is in ~."],
      [`${[`${home}.bak`, "x"].join("\\")} is another account's`, `${[users, "…", "x"].join("\\")} is another account's`],
      ["/mnt/c/" + "Users/" + "Sam/x", "/mnt/c/Users/…/x"],
    ];
    for (const [text, expected] of cases) expect(redactPaths(text, ownHome)).toBe(expected);
  });

  it("hides another account named where the path ends, without taking the sentence after it", () => {
    const cases: Array<[string, string]> = [
      [`${[users, "Sam"].join("\\")}.`, `${[users, "…"].join("\\")}.`],
      [`in ${[users, "Sam"].join("\\")}, then see src/a.ts`, `in ${[users, "…"].join("\\")}, then see src/a.ts`],
      [[users, "Sam"].join("\\"), [users, "…"].join("\\")],
      ["It is in /home/" + "sam.", "It is in /home/…."],
      ["(/Users/" + "sam), then /home/" + "sam: done", "(/Users/…), then /home/…: done"],
      ["/home/" + "sam.lee/x", "/home/…/x"],
    ];
    for (const [text, expected] of cases) expect(redactPaths(text, ownHome)).toBe(expected);
  });

  it("does not take a web address or a flag for a POSIX home", () => {
    const rootHome = homePatterns(["/root"]);
    expect(redactPaths("see https://example.org/root and --root", rootHome)).toBe("see https://example.org/root and --root");
    expect(redactPaths("cd /root/x && ls /root/.claude/projects/-root-projects", rootHome)).toBe(
      "cd ~/x && ls ~/.claude/projects/~-projects",
    );

    const named = homePatterns(["/home/" + "pat"]);
    const address = "https://example.org/home/" + "pat/about";
    expect(redactPaths(address, named)).toBe(address);
  });

  // A home one folder below the root is called root, app or data, which are ordinary folder names and flags as well.
  it("takes a home one folder below the root for the home only where a path starts", () => {
    const rootHome = homePatterns(["/root"]);
    const untouched = [
      "edit packages/root/index.ts",
      "cd /app/root/src",
      "github.com/acme/root is the repository",
      "pass -root to the tool",
      ["C:", "work", "root", "file.txt"].join("\\"),
    ];
    for (const text of untouched) expect(redactPaths(text, rootHome), text).toBe(text);
    expect(redactPaths('run "/root/bin/tool" in /root', rootHome)).toBe('run "~/bin/tool" in ~');
  });

  // A sentence goes on after a path that ends at the account's name, and its words are not part of the name.
  it("hides another account's name without taking the words after it", () => {
    const sam = [users, "sam"].join("\\");
    const hidden = [users, "…"].join("\\");
    const cases: Array<[string, string]> = [
      [`open ${sam} then read the file in docs/readme.md please`, `open ${hidden} then read the file in docs/readme.md please`],
      [`${sam} holds it and/or the other one`, `${hidden} holds it and/or the other one`],
      [`cd ${sam} && ls src/x`, `cd ${hidden} && ls src/x`],
      [`He said "look in ${sam} and tell me now" twice`, `He said "look in ${hidden} and tell me now" twice`],
      [`${[users, "Jo Ann", "notes"].join("\\")} is hers`, `${[users, "…", "notes"].join("\\")} is hers`],
      [`${slashed(users)}/sam\\x`, `${slashed(users)}/…\\x`],
    ];
    for (const [text, expected] of cases) expect(redactPaths(text, ownHome), text).toBe(expected);
  });

  // A path is written straight after a compiler flag, behind a UNC host and under a volume, with no space before its first slash.
  it("knows a POSIX home whatever is written right before it", () => {
    const named = homePatterns(["/home/" + "pat"]);
    const cases: Array<[string, string]> = [
      ["gcc -I/home/" + "pat/include -L/home/" + "pat/lib main.c", "gcc -I~/include -L~/lib main.c"],
      ["\\\\wsl$\\Ubuntu\\home\\" + "pat\\proj", "\\\\wsl$\\Ubuntu~\\proj"],
      ["/System/Volumes/Data/home/" + "pat/notes.md", "/System/Volumes/Data~/notes.md"],
      ["file://localhost/home/" + "pat/report.html", "file://localhost~/report.html"],
      ["../../home/" + "pat/x and /home/" + "pat/x", "../..~/x and ~/x"],
    ];
    for (const [text, expected] of cases) expect(redactPaths(text, named)).toBe(expected);
  });

  it("finds the short spelling of the home folder from the temp folder, and nothing when there is none", () => {
    const tail = "\\AppData\\Local\\Temp";
    expect(shortPrefix(home, `${shortHome}${tail}`, `${home}${tail}`)).toBe(shortHome);
    expect(shortPrefix(home, `${home}${tail}`, `${home}${tail}`)).toBeNull();
    expect(shortPrefix("/home/" + "pat", "/tmp", "/tmp")).toBeNull();
  });
});

describe("redactHome", () => {
  it("rewrites a home path in prose the model wrote", () => {
    const text = `I wrote it to ${path.join(os.homedir(), "Desktop", "out.md")}`;
    const shown = redactHome(text);
    expect(shown).not.toContain(path.basename(os.homedir()));
    expect(shown).toContain("~");
  });

  it("catches both separators, either case, and the Git Bash spelling of a Windows home", () => {
    const account = path.basename(os.homedir());
    const forward = os.homedir().split(path.sep).join("/");
    // Git Bash and MSYS tools spell a Windows home with a lowercase drive letter and forward slashes.
    const msys = forward.replace(/^([A-Za-z]):/, (_, letter: string) => `/${letter.toLowerCase()}`);
    for (const variant of [forward, forward.toUpperCase(), os.homedir(), msys]) {
      expect(redactHome(`ran in ${variant}/x`)).not.toContain(account);
      expect(redactHome(`ran in ${variant}/x`)).toContain("~/x");
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

  // A message that cannot be deleted stays at the top of the channel, and would be fetched again with every page read from the top.
  it("goes on past messages it cannot delete, and counts each of them once", async () => {
    const held = Array.from({ length: 1000 }, (_, index) => ({ ...fakeMessage(`m${index}`, index >= 10), gone: false }));
    const channel = {
      messages: {
        fetch: async ({ limit, before }: { limit: number; before?: string }) => {
          const left = held.filter((message) => !message.gone);
          const below = left.filter((message) => !before || Number(message.id.slice(1)) > Number(before.slice(1)));
          return new Map(below.slice(0, limit).map((message) => [message.id, message]));
        },
      },
      bulkDelete: async (wanted: typeof held) => {
        const deleted = wanted.filter((message) => Number(message.id.slice(1)) >= 10);
        for (const message of deleted) message.gone = true;
        return new Map(deleted.map((message) => [message.id, message]));
      },
    };

    const result = await purgeChannel(channel as never);
    expect(result).toEqual({ bulkDeleted: 990, slowDeleted: 0, failed: 10 });
    expect(held.filter((message) => !message.gone).map((message) => message.id)).toEqual(
      held.slice(0, 10).map((message) => message.id),
    );
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
    const message = describeCategoryFull(say, "Projects");
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
    expect(displayName(record({ sessionId: "s", name: "Deploy Scripts", cwd: "/p/thing" }))).toBe("Deploy Scripts");
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
    // Autocomplete submits the session id, so a name that falls back to it would call the channel a UUID.
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
    const rendered = renderActivity(say, ["Checking the schema first.", "It is a rounding bug."], 5000);
    const expected = ["⏳ **Working** 5s", "", "Checking the schema first.", "", "It is a rounding bug."];
    expect(rendered.split("\n")).toEqual(expected);
  });

  it("says only that it is working when nothing has been said yet", () => {
    expect(renderActivity(say, [], 12_000)).toBe("⏳ **Working** 12s");
  });

  it("counts the steps taken, so a quiet turn still shows it is getting somewhere", () => {
    expect(renderActivity(say, [], 272_000, 7)).toBe("⏳ **Working** 4m 32s · 7 steps");
    expect(renderActivity(say, [], 5000, 1)).toBe("⏳ **Working** 5s · 1 step");
  });

  it("leaves the count off before anything has been done", () => {
    expect(renderActivity(say, [], 5000, 0)).toBe("⏳ **Working** 5s");
  });

  it("shows the newest notes and elides the rest", () => {
    const notes = Array.from({ length: 40 }, (_, index) => `Note ${index}`);
    const paragraphs = renderActivity(say, notes, 0).split("\n\n");
    expect(paragraphs[1]).toBe("...");
    expect(paragraphs.at(-1)).toBe("Note 39");
  });

  it("stays inside a Discord message however much was said", () => {
    const notes = Array.from({ length: 40 }, (_, index) => `${index} `.repeat(120));
    expect(renderActivity(say, notes, 600_000).length).toBeLessThan(2000);
  });

  it("keeps a long remark whole while the budget has room for it", () => {
    const long = "word ".repeat(150).trim();
    const rendered = renderActivity(say, [long], 1000);
    expect(rendered).toContain(long);
    expect(rendered).not.toContain("...");
  });

  it("drops an older remark rather than cutting it in half", () => {
    const big = "a".repeat(1000);
    const rendered = renderActivity(say, [big, big], 1000);
    const paragraphs = rendered.split("\n\n");
    expect(paragraphs[1]).toBe("...");
    expect(paragraphs[2]).toBe(big);
  });

  it("cuts only when one remark alone is larger than the whole budget", () => {
    const huge = "b".repeat(4000);
    const rendered = renderActivity(say, [huge], 1000);
    expect(rendered.length).toBeLessThan(2000);
    expect(rendered.endsWith("...")).toBe(true);
  });

  it("does not cut commentary off after a few words", () => {
    const sentence =
      "Prices are identical to last week, but something else moved: 25 articles now have a " +
      "takeawayPrice that differs from price, where last week only three did.";
    expect(renderActivity(say, [sentence], 1000)).toContain("where last week only three did.");
  });

  it("counts elapsed time in minutes past a minute", () => {
    expect(formatElapsed(say, 72_000)).toBe("1m 12s");
    expect(formatElapsed(say, 9_000)).toBe("9s");
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
    expect(preflight(say, base).kind).toBe("ok");
  });

  it("offers takeover for a background holder", () => {
    const held = {
      ...base,
      live: { pid: 1, cwd: "/p", kind: "background" as const, sessionId: "s1", id: "abc123" },
    };
    const result = preflight(say, held);
    expect(result.kind).toBe("takeover-available");
    expect(result.kind === "takeover-available" && result.shortId).toBe("abc123");
  });

  it("refuses an interactive holder and names its directory", () => {
    const held = {
      ...base,
      live: { pid: 42, cwd: "/home/u/projects/deploy-scripts", kind: "interactive" as const, sessionId: "s1" },
    };
    const result = preflight(say, held);
    expect(result.kind).toBe("refused");
    expect(result.kind === "refused" && result.message).toContain("/home/u/projects/deploy-scripts");
  });
});

describe("attachment screening", () => {
  const file = (name: string, size = 1000) => ({ url: "https://cdn.example/x", name, contentType: null, size });

  it("keeps source and scripts, which are the point of a coding bridge", () => {
    const { allowed, refused } = screenAttachments([
      file("server.ts"),
      file("deploy.sh"),
      file("notes.md"),
      file("shot.png"),
      file("build.ps1"),
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
    expect(refused[0]?.reason).toBe("too-large");
    expect(describeRefused(say, refused)).toContain("over 25 MB");
  });

  it("says which file was refused and why, and stays quiet when none was", () => {
    const { refused } = screenAttachments([file("setup.exe")]);
    const notice = describeRefused(say, refused);
    expect(notice).toContain("setup.exe");
    expect(notice).toContain("executable format");
    expect(describeRefused(say, [])).toBeNull();
  });
});

describe("ApprovalPrompts", () => {
  const OWNER = "owner-1";

  it("allows the tool once an owner approves", async () => {
    const prompts = new ApprovalPrompts();
    const decision = prompts.ask(
      say,
      "turn-1",
      askingSink((actions) => {
        prompts.decide(say, actionId(actions, "approve"), OWNER, "approve");
      }),
      [OWNER],
      "Bash",
      { command: "ls" },
    );

    expect(await decision).toEqual({ allow: true });
  });

  it("denies, and says so where the model can read it", async () => {
    const prompts = new ApprovalPrompts();
    const decision = await prompts.ask(
      say,
      "turn-1",
      askingSink((actions) => {
        prompts.decide(say, actionId(actions, "deny"), OWNER, "deny");
      }),
      [OWNER],
      "Bash",
      { command: "rm -rf /" },
    );

    expect(decision.allow).toBe(false);
    expect(decision.allow === false && decision.reason).toContain("Denied");
  });

  // A stranger with the button in front of them is still not an owner.
  it("refuses a decision from anyone but an owner", async () => {
    const prompts = new ApprovalPrompts();
    let refusal = "";
    const decision = prompts.ask(
      say,
      "turn-1",
      askingSink((actions) => {
        refusal = prompts.decide(say, actionId(actions, "approve"), "someone-else", "approve");
        prompts.decide(say, actionId(actions, "deny"), OWNER, "deny");
      }),
      [OWNER],
      "Bash",
      { command: "ls" },
    );

    expect(await decision).toEqual({ allow: false, reason: expect.stringContaining("Denied") });
    expect(refusal).toContain("Only an owner");
  });

  // Tools asked about side by side each put a prompt on screen before the first is answered.
  it("covers the prompts already open when the rest of the turn is approved, and asks again once that is withdrawn", async () => {
    const prompts = new ApprovalPrompts();
    const open: string[] = [];
    const sink = askingSink((actions) => void open.push(actionId(actions, "approve-all")));
    const first = prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "ls" });
    const second = prompts.ask(say, "turn-1", sink, [OWNER], "Edit", { file_path: "a.ts" });
    const elsewhere = prompts.ask(say, "turn-2", sink, [OWNER], "Bash", { command: "ls" });
    await vi.waitFor(() => expect(open).toHaveLength(3));

    prompts.decide(say, open[0]!, OWNER, "approve-all");
    expect(await Promise.all([first, second])).toEqual([{ allow: true }, { allow: true }]);
    expect(await prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "pwd" })).toEqual({ allow: true });
    expect(open).toHaveLength(3);

    prompts.revoke("turn-1");
    const again = prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "pwd" });
    await vi.waitFor(() => expect(open).toHaveLength(4));
    prompts.finish("turn-1");
    prompts.finish("turn-2");
    expect((await again).allow).toBe(false);
    expect((await elsewhere).allow).toBe(false);
  });

  it("stops asking for the rest of a turn once approved wholesale", async () => {
    const prompts = new ApprovalPrompts();
    let asks = 0;
    const sink = askingSink((actions) => {
      asks += 1;
      prompts.decide(say, actionId(actions, "approve-all"), OWNER, "approve-all");
    });

    expect(await prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "ls" })).toEqual({ allow: true });
    expect(await prompts.ask(say, "turn-1", sink, [OWNER], "Edit", { file_path: "a.ts" })).toEqual({ allow: true });
    expect(asks).toBe(1);
  });

  // The standing approval was given for one turn, so the next one starts from nothing.
  it("does not carry a wholesale approval into the next turn", async () => {
    const prompts = new ApprovalPrompts();
    let asks = 0;
    const sink = askingSink((actions) => {
      asks += 1;
      prompts.decide(say, actionId(actions, "approve-all"), OWNER, "approve-all");
    });

    await prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "ls" });
    prompts.finish("turn-1");
    await prompts.ask(say, "turn-2", sink, [OWNER], "Bash", { command: "ls" });
    expect(asks).toBe(2);
  });

  // Nobody at the phone is the usual end of a prompt, and the model is told it was time that refused it, not a person.
  it("denies once the time to answer is up, and says that is why", async () => {
    const closed: string[] = [];
    const sink = { ...quietSink(), ask: async () => ({ close: async (text: string) => void closed.push(text) }) };
    vi.useFakeTimers();
    try {
      const decision = new ApprovalPrompts().ask(say, "turn-1", sink, [OWNER], "Bash", { command: "ls" });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(await decision).toEqual({ allow: false, reason: expect.stringContaining("Nobody answered") });
    } finally {
      vi.useRealTimers();
    }
    expect(closed).toEqual(["No answer in 5 minutes, so it was denied."]);
  });

  // Claude Code runs the tool when the hook throws, so a prompt that cannot be posted has to come back as a refusal.
  it("denies when the prompt cannot be posted, and leaves nothing waiting on it", async () => {
    const prompts = new ApprovalPrompts();
    const sink = { ...quietSink(), ask: async () => Promise.reject(new Error("Missing Permissions")) };
    const decision = await prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "rm -rf /" });
    expect(decision).toEqual({ allow: false, reason: expect.stringContaining("could not be shown") });
  });

  it("refuses a tool when the gate itself fails, whatever failed inside it", async () => {
    const hooks = gate({
      approve: async () => {
        throw new Error("boom");
      },
    });
    const hook = hooks.PreToolUse![0]!.hooks[0]!;
    const output = await hook({ tool_name: "Bash", tool_input: { command: "ls" } } as never, undefined, {
      signal: new AbortController().signal,
    });
    expect(output).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });

    const asking = gate({
      askQuestions: async () => {
        throw new Error("boom");
      },
    });
    const answer = await asking.PreToolUse![0]!.hooks[0]!({ tool_name: "AskUserQuestion", tool_input: {} } as never, undefined, {
      signal: new AbortController().signal,
    });
    expect(answer).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  // Nobody denied it, so it must not read as denied.
  it("closes a prompt its turn outlived as ended, not as denied", async () => {
    const prompts = new ApprovalPrompts();
    const closed: string[] = [];
    const sink = { ...quietSink(), ask: async () => ({ close: async (outcome: string) => void closed.push(outcome) }) };
    const asking = prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "ls" });
    await wait(5);
    prompts.finish("turn-1");
    expect(await asking).toEqual({ allow: false, reason: expect.stringContaining("turn ended") });
    expect(closed).toEqual(["The turn ended before this was answered."]);
  });

  it("denies when the conversation has no way to show buttons", async () => {
    const prompts = new ApprovalPrompts();
    const decision = await prompts.ask(say, "turn-1", quietSink(), [OWNER], "Bash", { command: "ls" });
    expect(decision.allow).toBe(false);
  });

  it("names the tool and shows what it would run", () => {
    const text = describeRequest(say, "Bash", { command: "git push --force" });
    expect(text).toContain("Bash");
    expect(text).toContain("git push --force");
  });
});

describe("QuestionPrompts", () => {
  const library: Question = {
    question: "Which library should we use for dates?",
    header: "Library",
    multiSelect: false,
    options: [
      { label: "date-fns", description: "Functions over plain dates" },
      { label: "Day.js", description: "Small and chainable" },
    ],
  };
  const features: Question = {
    question: "Which features do you want?",
    header: "Features",
    multiSelect: true,
    options: [
      { label: "Caching", description: "Keep results around" },
      { label: "Retries", description: "Try again on failure" },
      { label: "Metrics", description: "Count what happens" },
    ],
  };
  const askIdOf = (ask: MenuAsk) => actionId(ask.actions, "question:submit");

  it("turns picks into an answer per question, keyed by the question text", async () => {
    const prompts = new QuestionPrompts();
    let shown: MenuAsk | undefined;
    const outcome = await prompts.ask(
      say,
      "turn-1",
      menuAskingSink((ask) => {
        shown = ask;
        const askId = askIdOf(ask);
        prompts.pick(say, askId, 0, ["1"]);
        prompts.pick(say, askId, 1, ["0", "1"]);
        expect(prompts.submit(say, askId)).toBeUndefined();
      }),
      [library, features],
    );

    expect(outcome).toEqual({
      answered: true,
      answers: { [library.question]: "Day.js", [features.question]: "Caching, Retries" },
    });
    expect(shown?.closed).toEqual(["Answered: Library = Day.js. Features = Caching, Retries."]);
  });

  it("takes an answer in the asker's own words alongside the picks", async () => {
    const prompts = new QuestionPrompts();
    const outcome = await prompts.ask(
      say,
      "turn-1",
      menuAskingSink((ask) => {
        const askId = askIdOf(ask);
        prompts.pick(say, askId, 0, ["0", OTHER_VALUE]);
        prompts.answerFreeText(say, askId, 0, "  Retries with jitter ");
        prompts.submit(say, askId);
      }),
      [features],
    );

    expect(outcome.answered && outcome.answers[features.question]).toBe("Caching, Retries with jitter");
  });

  it("refuses to send while a question has nothing picked", async () => {
    const prompts = new QuestionPrompts();
    let complaint: string | undefined;
    const outcome = await prompts.ask(
      say,
      "turn-1",
      menuAskingSink((ask) => {
        const askId = askIdOf(ask);
        prompts.pick(say, askId, 0, ["0"]);
        complaint = prompts.submit(say, askId);
        prompts.pick(say, askId, 1, ["2"]);
        prompts.submit(say, askId);
      }),
      [library, features],
    );

    expect(complaint).toContain("Question 2");
    expect(outcome.answered).toBe(true);
  });

  it("lets the model continue without answers when skipped, and says so", async () => {
    const prompts = new QuestionPrompts();
    let shown: MenuAsk | undefined;
    const outcome = await prompts.ask(
      say,
      "turn-1",
      menuAskingSink((ask) => {
        shown = ask;
        prompts.skip(say, actionId(ask.actions, "question:skip"));
      }),
      [library],
    );

    expect(outcome.answered).toBe(false);
    expect(outcome.answered === false && outcome.reason).toContain("skipped");
    expect(shown?.closed[0]).toContain("Skipped");
  });

  it("settles what a turn asked when that turn ends", async () => {
    const prompts = new QuestionPrompts();
    const outcome = prompts.ask(
      say,
      "turn-1",
      menuAskingSink(() => prompts.finish("turn-1")),
      [library],
    );
    expect(await outcome).toEqual({ answered: false, reason: expect.stringContaining("turn ended") });
  });

  it("tells a late press that the questions are gone", async () => {
    const prompts = new QuestionPrompts();
    let askId = "";
    await prompts.ask(
      say,
      "turn-1",
      menuAskingSink((ask) => {
        askId = askIdOf(ask);
        prompts.skip(say, askId);
      }),
      [library],
    );

    expect(prompts.submit(say, askId)).toContain("already answered");
    expect(prompts.pick(say, askId, 0, ["0"])).toContain("already answered");
  });

  it("continues without an answer when the questions cannot be posted", async () => {
    const prompts = new QuestionPrompts();
    const sink = { ...quietSink(), askWithMenus: async () => Promise.reject(new Error("Unknown Channel")) };
    const outcome = await prompts.ask(say, "turn-1", sink, [library]);
    expect(outcome).toEqual({ answered: false, reason: expect.stringContaining("could not be shown") });
  });

  it("continues without an answer when the conversation cannot show menus", async () => {
    const outcome = await new QuestionPrompts().ask(say, "turn-1", quietSink(), [library]);
    expect(outcome.answered).toBe(false);
  });

  it("draws one menu per question with an entry for an answer of one's own", () => {
    const menus = menusFor(say, "ask-1", [library, features]);
    expect(menus.map((menu) => menu.id)).toEqual([questionPickId("ask-1", 0), questionPickId("ask-1", 1)]);
    expect(menus[0]?.multiple).toBe(false);
    expect(menus[1]?.multiple).toBe(true);
    expect(menus[0]?.options.map((option) => option.value)).toEqual(["0", "1", OTHER_VALUE]);
    expect(menus[1]?.options.at(-1)?.label).toBe("Other...");
  });

  it("numbers the questions and shows a preview as a block", () => {
    const withPreview: Question = {
      ...library,
      options: [{ label: "Day.js", description: "Small", preview: "dayjs().format()" }],
    };
    const text = describeQuestions(say, [withPreview, features]);
    expect(text).toContain("Claude has 2 questions.");
    expect(text).toContain("**1. Library**");
    expect(text).toContain("**2. Features**");
    expect(text).toContain("Pick any that apply.");
    expect(text).toContain("```\ndayjs().format()\n```");
  });

  it("types the tool input without trusting any field to be present", () => {
    const parsed = parseQuestions({
      questions: [{ question: "Red or blue?", header: "Colour", options: [{ label: "Red" }], multiSelect: "yes" }],
    });
    expect(parsed).toEqual([
      { question: "Red or blue?", header: "Colour", options: [{ label: "Red", description: "" }], multiSelect: false },
    ]);
    expect(parseQuestions({})).toEqual([]);
  });

  it("round-trips every question control id", () => {
    expect(parseCustomId(questionPickId("ask-1", 2))).toEqual({ kind: "question-pick", askId: "ask-1", index: 2 });
    expect(parseCustomId(questionOtherId("ask-1", 0))).toEqual({ kind: "question-other", askId: "ask-1", index: 0 });
    expect(parseCustomId(questionSubmitId("ask-1"))).toEqual({ kind: "question-submit", askId: "ask-1" });
    expect(parseCustomId(questionSkipId("ask-1"))).toEqual({ kind: "question-skip", askId: "ask-1" });
    expect(parseCustomId("question:pick:ask-1").kind).toBe("unknown");
  });
});

describe("HeldPrompt", () => {
  const result: ClaudeEvent = { type: "result", subtype: "success", is_error: false, total_cost_usd: 0, usage: usage(10) };
  const init = { type: "system", subtype: "init" } as ClaudeEvent;
  const tasks = (live: number, ambient = 0): ClaudeEvent => ({
    type: "system",
    subtype: "background_tasks_changed",
    tasks: [
      ...Array.from({ length: live }, (_, index) => ({ task_id: `t${index}` })),
      ...Array.from({ length: ambient }, (_, index) => ({ task_id: `w${index}`, ambient: true })),
    ],
  });

  const orphan = { type: "system", subtype: "task_notification", status: "stopped" } as ClaudeEvent;

  const spoke = { type: "assistant", message: { content: [{ type: "text", text: "on it" }] } } as ClaudeEvent;

  // The prompt goes out once the handshake is done; whether the input then closes is what each case checks.
  async function settled(held: HeldPrompt, ms = 15): Promise<boolean> {
    const stream = held.stream();
    held.ready();
    await stream.next();
    const ended = stream.next().then(() => true);
    return await Promise.race([ended, wait(ms).then(() => false)]);
  }

  // A captured shape: replay echoes a handed-over message, at take-up mid-step and with the model's first output otherwise.
  const replay = (uuid: string) => ({ type: "user", message: { content: [] }, uuid, isReplay: true }) as ClaudeEvent;

  it("passes on a message handed over mid-turn, and refuses one before the turn is under way or after it has let go", async () => {
    const held = new HeldPrompt("hello", 5);
    expect(held.handOver("too early")).toBeNull();
    const stream = held.stream();
    held.ready();
    await stream.next();
    held.observe(spoke);

    const uuid = held.handOver("also this");
    expect(uuid).toEqual(expect.any(String));
    expect((await stream.next()).value).toMatchObject({ uuid, priority: "next", message: { content: "also this" } });

    held.observe(replay(uuid!));
    held.observe(result);
    expect((await stream.next()).done).toBe(true);
    expect(held.handOver("too late")).toBeNull();
  });

  // A turn that ends with a message still waiting is about to run it as the next turn, in the same process.
  it("stays open past an answer while a handed-over message is still to be taken up", async () => {
    const held = new HeldPrompt("hello", 5, 1000);
    const stream = held.stream();
    held.ready();
    await stream.next();
    held.observe(spoke);
    const uuid = held.handOver("also this")!;
    await stream.next();

    held.observe(result);
    expect(held.awaitsUntaken).toBe(true);
    const ended = stream.next().then(() => true);
    expect(await Promise.race([ended, wait(20).then(() => false)])).toBe(false);

    held.observe(init);
    held.observe(replay(uuid));
    held.observe(result);
    expect(await ended).toBe(true);
  });

  // Captured from a session with nothing in hand: it reports starting on the message 1.5s before it echoes it, and longer when it thinks first.
  it("counts a message as taken up when the session says it started on it, without waiting for the echo", async () => {
    const lifecycle = (uuid: string, state: string) => ({ type: "command_lifecycle", command_uuid: uuid, state }) as ClaudeEvent;
    const held = new HeldPrompt("hello", 5, 1000);
    const stream = held.stream();
    held.ready();
    await stream.next();
    held.observe(spoke);
    const uuid = held.handOver("also this")!;

    held.observe(lifecycle(uuid, "queued"));
    expect(held.awaitsUntaken).toBe(true);
    held.observe(lifecycle(uuid, "started"));
    expect(held.awaitsUntaken).toBe(false);

    expect(takenUp(lifecycle("u1", "started"))).toBe("u1");
    expect(takenUp(lifecycle("u1", "queued"))).toBeNull();
    expect(takenUp(lifecycle("u1", "completed"))).toBeNull();
    expect(takenUp(replay("u2"))).toBe("u2");
    expect(takenUp(spoke)).toBeNull();
  });

  // The reason a result failed is its own errors; the answer an earlier turn left in the same process is not one.
  it("words a failed result from its own errors", () => {
    expect(resultError("error_during_execution", [])).toEqual({ kind: "ended", subtype: "error_during_execution", text: "" });
    expect(resultError("error_max_turns", ["hit the limit", "twice"])).toEqual({
      kind: "ended",
      subtype: "error_max_turns",
      text: "hit the limit\ntwice",
    });
  });

  it("sends nothing when it is closed before the handshake, since that is a turn stopped before it began", async () => {
    const held = new HeldPrompt("hello");
    const stream = held.stream();
    held.close();
    expect((await stream.next()).done).toBe(true);
  });

  describe("results from one process that answers several turns", () => {
    const tokens = (input: number, output: number) => ({
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 1,
    });

    it("lets the latest answer stand, an empty one included, and adds the tokens up", () => {
      const outcome = { text: "" };
      expect(
        foldResult(outcome, {
          subtype: "success",
          is_error: false,
          result: "first",
          usage: tokens(1000, 200),
          total_cost_usd: 0.1,
        }),
      ).toBeNull();
      expect(
        foldResult(outcome, { subtype: "success", is_error: false, result: "", usage: tokens(50, 5), total_cost_usd: 0.12 }),
      ).toBeNull();

      expect(outcome).toEqual({
        text: "",
        usage: { input_tokens: 1050, output_tokens: 205, cache_read_input_tokens: 20, cache_creation_input_tokens: 2 },
        sessionCostUsd: 0.12,
      });
    });

    // A plan limit or an API error arrives as a success that is an error, with the reason as its text.
    it("takes Claude Code's own reason when the result is a success that is an error", () => {
      const outcome = { text: "earlier answer" };
      const limit = { subtype: "success", is_error: true, result: "You've hit your session limit" };
      expect(foldResult(outcome, limit)).toEqual({ kind: "reported", text: "You've hit your session limit" });
      expect(outcome.text).toBe("earlier answer");
    });

    it("words a failure subtype from the errors it carries", () => {
      const failed = { subtype: "error_max_turns", is_error: true, errors: ["hit the limit"] };
      expect(foldResult({ text: "" }, failed)).toEqual({ kind: "ended", subtype: "error_max_turns", text: "hit the limit" });
    });
  });

  it("does not hold the input open for good when a handed-over message is never taken up", async () => {
    const held = new HeldPrompt("hello", 5, 10);
    const stream = held.stream();
    held.ready();
    await stream.next();
    held.observe(spoke);
    held.handOver("also this");
    await stream.next();
    held.observe(result);
    expect((await stream.next()).done).toBe(true);
  });

  // A background command keeps the input open past the answer, and no further result comes to start the clock on a message handed over then.
  it("does not hold the input open for a message handed over after the answer and never taken up", async () => {
    const held = new HeldPrompt("hello", 5, 10);
    const stream = held.stream();
    held.ready();
    await stream.next();
    held.observe(spoke);
    held.observe(tasks(1));
    held.observe(result);
    expect(held.handOver("one more thing")).not.toBeNull();
    await stream.next();
    held.observe(tasks(0));
    expect(await Promise.race([stream.next().then((step) => step.done), wait(200).then(() => "still open")])).toBe(true);
  });

  it("holds the prompt until the handshake is done, then yields it once", async () => {
    const held = new HeldPrompt("hello", 5);
    const stream = held.stream();
    const first = stream.next();
    held.observe(init);
    expect(await Promise.race([first.then(() => true), wait(15).then(() => false)])).toBe(false);
    held.ready();
    expect((await first).value).toMatchObject({ type: "user", message: { role: "user", content: "hello" } });
    held.observe(result);
    expect((await stream.next()).done).toBe(true);
  });

  it("stays open while a background command is still running", async () => {
    const held = new HeldPrompt("hello", 5);
    held.observe(tasks(1));
    held.observe(result);
    expect(await settled(held)).toBe(false);
  });

  it("lets go a moment after the last command finishes with no follow-up", async () => {
    const held = new HeldPrompt("hello", 5);
    held.observe(tasks(1));
    held.observe(result);
    held.observe(tasks(0));
    expect(await settled(held, 40)).toBe(true);
  });

  // The follow-up turn a finished task triggers is the whole reason the input was held.
  it("keeps holding when a follow-up turn starts, until that turn answers", async () => {
    const held = new HeldPrompt("hello", 5);
    held.observe(tasks(1));
    held.observe(result);
    held.observe(tasks(0));
    held.observe(init);
    expect(await settled(held, 40)).toBe(false);
    held.observe(result);
    expect(await settled(held)).toBe(true);
  });

  it("does not count a watcher as work", async () => {
    const held = new HeldPrompt("hello", 5);
    held.observe(tasks(0, 2));
    held.observe(result);
    expect(await settled(held)).toBe(true);
  });

  it("lets go at once when closed, whatever is running", async () => {
    const held = new HeldPrompt("hello", 5);
    held.observe(tasks(3));
    held.close();
    expect(await settled(held)).toBe(true);
  });

  // A process that opens by reporting an orphaned task cancels every tool call, so the prompt must never reach it.
  it("asks for a restart the moment the CLI opens with an orphaned task, and sends nothing", async () => {
    const held = new HeldPrompt("hello", 5);
    const stream = held.stream();
    const first = stream.next();
    held.observe(orphan);
    expect(held.needsRestart).toBe(true);
    expect((await first).done).toBe(true);
    held.ready();
    expect((await stream.next()).done).toBe(true);
  });

  // The report can land a moment after the handshake let the prompt go; only a model reply makes it too late.
  it("still restarts when the report lands after the prompt but before the model has spoken", async () => {
    const held = new HeldPrompt("hello", 5);
    const stream = held.stream();
    held.ready();
    await stream.next();
    held.observe(orphan);
    expect(held.needsRestart).toBe(true);
  });

  it("treats an orphan reported once the model has spoken as an ordinary notification", async () => {
    const held = new HeldPrompt("hello", 5);
    const stream = held.stream();
    held.ready();
    await stream.next();
    held.observe(spoke);
    held.observe(orphan);
    held.observe(result);
    expect(held.needsRestart).toBe(false);
    expect((await stream.next()).done).toBe(true);
  });
});

describe("ActiveTurns", () => {
  const anchor = { channelId: "chan-1", messageId: "msg-1" };

  async function freshFile(): Promise<string> {
    return path.join(await fs.mkdtemp(path.join(os.tmpdir(), "turns-")), "turns.json");
  }

  it("remembers a running turn on disk and forgets it when the turn ends", async () => {
    const file = await freshFile();
    const turns = new ActiveTurns(file);
    await turns.record("s1", anchor);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ s1: anchor });
    await turns.clear("s1");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({});
  });

  // A bridge that died mid-turn is a new process; what it finds on disk is the previous one's unfinished work.
  it("hands the previous process's unfinished turns to the next one, exactly once", async () => {
    const file = await freshFile();
    await new ActiveTurns(file).record("s1", anchor);

    const next = new ActiveTurns(file);
    await next.load();
    expect(await next.takeLeftovers()).toEqual([anchor]);
    expect(await next.takeLeftovers()).toEqual([]);

    const later = new ActiveTurns(file);
    await later.load();
    expect(await later.takeLeftovers()).toEqual([]);
  });

  it("starts empty when there is no file yet", async () => {
    const turns = new ActiveTurns(await freshFile());
    await turns.load();
    expect(await turns.takeLeftovers()).toEqual([]);
  });

  // Every session shares the one file, and two turns starting together must not trip over the same temp file.
  it("survives many sessions recording and clearing at once, and ends with the truth on disk", async () => {
    const file = await freshFile();
    const turns = new ActiveTurns(file);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => turns.record(`s${index}`, { channelId: "c", messageId: `m${index}` })),
    );
    await Promise.all(Array.from({ length: 10 }, (_, index) => turns.clear(`s${index}`)));
    const onDisk = JSON.parse(await fs.readFile(file, "utf8"));
    expect(Object.keys(onDisk).sort()).toEqual(Array.from({ length: 10 }, (_, index) => `s${index + 10}`).sort());
  });
});

describe("stopping one turn or all of them", () => {
  it("tells a stop button from a stop-all button", () => {
    expect(parseCustomId(stopActionId("s1"))).toEqual({ kind: "turn-stop", sessionId: "s1" });
    expect(parseCustomId(stopAllActionId("s1"))).toEqual({ kind: "turn-stop-all", sessionId: "s1" });
  });

  it("says what runs next when only the turn in flight was stopped", () => {
    expect(describeStopTurn(say, { stopped: true, queued: 0 })).toContain("Nothing was queued");
    expect(describeStopTurn(say, { stopped: true, queued: 1 })).toContain("1 message queued behind it runs next");
    expect(describeStopTurn(say, { stopped: true, queued: 3 })).toContain("3 messages queued behind it run next");
    expect(describeStopTurn(say, { stopped: false, queued: 0 })).toBe("Nothing is running here.");
  });

  // The fixed set: standard Unicode, one per state, and nothing else in the bridge uses emoji.
  it("has one standard emoji per turn state", () => {
    expect(Object.keys(STATE_EMOJI).sort()).toEqual(["done", "failed", "queued", "running", "stopped", "waiting"]);
    expect(new Set(Object.values(STATE_EMOJI)).size).toBe(6);
  });
});

describe("a preview of a file with one very long line", () => {
  it("cuts the line, so a minified file does not run to a hundred messages", () => {
    const shown = describeToolUse(say, "Write", { file_path: "/tmp/bundle.min.js", content: "x".repeat(200_000) });
    expect(shown!.length).toBeLessThan(400);
    const edited = describeToolUse(say, "Edit", {
      file_path: "/tmp/bundle.min.js",
      old_string: "a",
      new_string: "y".repeat(5000),
    });
    expect(edited!.length).toBeLessThan(400);
  });
});

describe("describeToolUse", () => {
  it("shows an edit as a diff block with the removed and added lines under the file's path", () => {
    const shown = describeToolUse(say, "Edit", {
      file_path: "/srv/app/src/thing.ts",
      old_string: "const alpha = 1;\nconst beta = 2;",
      new_string: "const alpha = 10;",
    });
    expect(shown).toBe("`/srv/app/src/thing.ts`\n```diff\n- const alpha = 1;\n- const beta = 2;\n+ const alpha = 10;\n```");
  });

  // Discord reads the underscores in a plain path as italics, which run into the fence and break it.
  it("keeps a path with underscores out of Markdown, whichever tool drew it", () => {
    const input = { file_path: "/srv/app/memory/project_backup_notes.md", old_string: "a", new_string: "b", content: "c" };
    expect(describeToolUse(say, "Edit", input)?.split("\n")[0]).toBe("`/srv/app/memory/project_backup_notes.md`");
    expect(describeToolUse(say, "MultiEdit", { ...input, edits: [{ old_string: "a", new_string: "b" }] })?.split("\n")[0]).toBe(
      "`/srv/app/memory/project_backup_notes.md`",
    );
    expect(describeToolUse(say, "Write", input)?.split("\n")[0]).toBe("`/srv/app/memory/project_backup_notes.md` (1 line)");
  });

  it("counts the lines a written file has, not the line break that ends it", () => {
    const written = (content: string) =>
      describeToolUse(say, "Write", { file_path: "/srv/app/notes.md", content })?.split("\n")[0];
    expect(written("one\ntwo\n")).toContain("(2 lines)");
    expect(written("one\ntwo")).toContain("(2 lines)");
    expect(written("one\r\n")).toContain("(1 line)");
    expect(written("")).toContain("(0 lines)");
  });

  it("shows a written file in a block tagged with its language, capped, saying how much is left", () => {
    const shown = describeToolUse(say, "Write", { file_path: "/srv/app/big.py", content: Array(40).fill("x = 1").join("\n") });
    expect(shown).toContain("(40 lines)");
    expect(shown).toContain("```python\n");
    expect(shown?.split("\n").filter((line) => line === "x = 1")).toHaveLength(24);
    expect(shown).toContain("... 16 more lines");
    expect(describeToolUse(say, "Write", { file_path: "/srv/app/notes.unknownext", content: "a" })).toContain("```\na\n```");
  });

  it("shows a command as a prompt line in a shell block and keeps the rest of the tools counted only", () => {
    expect(describeToolUse(say, "Bash", { command: "npm   test\n  --run" })).toBe("```bash\n$ npm test --run\n```");
    expect(describeToolUse(say, "PowerShell", { command: "Get-Date" })).toBe("```powershell\n$ Get-Date\n```");
    expect(describeToolUse(say, "Read", { file_path: "/srv/app/x.ts" })).toBeNull();
    expect(describeToolUse(say, "Grep", { pattern: "x" })).toBeNull();
  });

  it("never lets a fence inside the content close the block early", () => {
    const shown = describeToolUse(say, "Edit", { file_path: "/srv/app/README.md", old_string: "```js", new_string: "```ts" });
    expect(shown?.match(/```/g)).toHaveLength(2);
  });
});

// Discord closes an open marker wherever the next one sits, fences included, so nothing may be left open.
describe("stray markup never reaches past its own text", () => {
  const fence = "```";
  const block = `${fence}bash\n$ ls\n${fence}`;

  it("makes a backtick left open by an escaped one literal, so the block after it survives", () => {
    const remark = "The chip `[Guide \\`intro\\`](#top)` loses its underline.";
    expect(defuseStrayMarkup(`${remark}\n\n${block}`)).toBe(
      `The chip \`[Guide \\\`intro\\\`](#top)\\\` loses its underline.\n\n${block}`,
    );
  });

  it("makes an underscore literal when its italics would close inside the block below", () => {
    const text = `Renamed old_name in the notes\n\n${fence}diff\n- keep_it\n${fence}`;
    expect(defuseStrayMarkup(text)).toBe(`Renamed old\\_name in the notes\n\n${fence}diff\n- keep_it\n${fence}`);
  });

  it("does the same for every marker that has to close: bold, underline, strikethrough, spoiler, link", () => {
    for (const marker of ["**", "__", "~~", "||"]) {
      const out = defuseStrayMarkup(`left ${marker}open\n\n${block}`);
      expect(out.endsWith(block)).toBe(true);
      expect(out).not.toContain(`left ${marker}open`);
    }
    expect(defuseStrayMarkup(`see [the notes\n\n${block}`)).toBe(`see \\[the notes\n\n${block}`);
  });

  it("leaves markup that closes where it opens, and tokens Discord takes whole, exactly as written", () => {
    const untouched = [
      "**bold**, *soft*, _soft_, __under__, ~~gone~~, ||hidden||, `code`, ``a ` b``",
      "- item\n* item\n  * nested",
      "[a guide](<https://example.org/a_b>) and https://example.org/x_y and <t:1700000000:t> and <@123>",
      "already \\*escaped\\* and \\_this\\_ too",
      `${fence}js\nconst left_open = \`x;\n${fence}`,
    ];
    for (const text of untouched) expect(defuseStrayMarkup(text)).toBe(text);
  });

  it("is idempotent, so guarding at the sink after guarding a remark changes nothing", () => {
    const samples = [
      "a `b and c_d and **e\n\n```\nx_y\n```\n\nthen f_g `h`",
      "snake_case_name and [x] done and 2 * 3",
      "The chip `[Guide \\`intro\\`](#top)` loses its underline.",
    ];
    for (const sample of samples) {
      const once = defuseStrayMarkup(sample);
      expect(defuseStrayMarkup(once)).toBe(once);
    }
  });

  it("seals each remark in the trail on its own, and still recognises the echoed answer", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("The chip `[Guide \\`intro\\`](#top)` loses its underline.");
    status.note(block);
    await status.settle();
    expect(sink.messages[0]).toContain(`\\\` loses its underline.\n\n${block}`);

    const echo = new StatusMessage(say, recordingSink(), () => 0);
    echo.note("Renamed old_name only.");
    echo.dropEcho("Renamed old_name only.");
    expect(echo.hasNotes()).toBe(false);
  });

  it("seals each exchange /sync posts, since they share a message", () => {
    const at = new Date("2026-09-13T14:32:00Z");
    const out = formatExchanges(say, [
      { at, role: "user", text: "why is `this open" },
      { at, role: "assistant", text: block },
    ]);
    expect(out).toContain("why is \\`this open");
    expect(out.endsWith(block)).toBe(true);
  });
});

// The shapes below are the ones real turns produced: two agents beside a background command, and one agent sent back to work.
describe("agents in a turn", () => {
  const started = (taskId: string, toolUseId: string, description: string, agentType = "general-purpose"): ClaudeEvent =>
    ({
      type: "system",
      subtype: "task_started",
      task_id: taskId,
      tool_use_id: toolUseId,
      description,
      subagent_type: agentType,
      task_type: "local_agent",
    }) as ClaudeEvent;
  const progressed = (taskId: string, description: string, toolUses: number, totalTokens = 33_100): ClaudeEvent =>
    ({
      type: "system",
      subtype: "task_progress",
      task_id: taskId,
      description,
      usage: { total_tokens: totalTokens, tool_uses: toolUses, duration_ms: 1800 },
    }) as ClaudeEvent;
  const notified = (taskId: string, status: string, toolUses = 2): ClaudeEvent =>
    ({
      type: "system",
      subtype: "task_notification",
      task_id: taskId,
      status,
      summary: "Nothing wrong.",
      usage: { total_tokens: 38_100, tool_uses: toolUses, duration_ms: 4200 },
    }) as ClaudeEvent;

  it("reads an agent's start, progress and end off the stream, and leaves a background command out", () => {
    expect(agentEvent(started("t1", "use1", "Audit the access checks", "Explore"))).toEqual({
      kind: "started",
      taskId: "t1",
      toolUseId: "use1",
      description: "Audit the access checks",
      agentType: "Explore",
      remote: false,
    });
    const cloud = {
      type: "system",
      subtype: "task_started",
      task_id: "t8",
      description: "ultrareview: feat/ledger",
      task_type: "remote_agent",
    } as ClaudeEvent;
    expect(agentEvent(cloud)).toEqual({
      kind: "started",
      taskId: "t8",
      toolUseId: null,
      description: "ultrareview: feat/ledger",
      agentType: "cloud",
      remote: true,
    });
    expect(agentEvent(progressed("t1", "Reading access.ts", 3))).toEqual({
      kind: "progress",
      taskId: "t1",
      activity: "Reading access.ts",
      toolUses: 3,
      tokens: 33_100,
    });
    expect(agentEvent(notified("t1", "completed"))).toEqual({
      kind: "ended",
      taskId: "t1",
      outcome: "completed",
      toolUses: 2,
      tokens: 38_100,
      durationMs: 4200,
    });
    const shell = {
      type: "system",
      subtype: "task_started",
      task_id: "t9",
      description: "sleep",
      task_type: "local_bash",
    } as ClaudeEvent;
    expect(agentEvent(shell)).toBeNull();
    expect(parentToolUseId({ type: "assistant", message: { content: [] }, parent_tool_use_id: "use1" })).toBe("use1");
    expect(parentToolUseId({ type: "assistant", message: { content: [] } })).toBeNull();
  });

  const board = (sink: MessageSink, clock = { at: 0 }) => new AgentBoard(say, sink, "Agents: tidy the ledger", () => clock.at, 0);
  const feed = (target: AgentBoard, ...events: ClaudeEvent[]) => {
    for (const event of events) target.observe(agentEvent(event)!);
  };

  it("tallies the agents in the trail where there is no side room: the running by name, the finished as a count", async () => {
    const clock = { at: 0 };
    const agents = board(quietSink(), clock);
    expect(agents.block()).toBe("");

    feed(agents, started("t1", "use1", "Audit the access checks", "Explore"), started("t2", "use2", "Write the fixtures"));
    clock.at = 48_000;
    feed(agents, progressed("t1", "Reading access.ts", 9), progressed("t2", "Write the fixtures", 1, 900));
    await agents.flush();
    expect(agents.block()).toBe(
      "**Agents** · 2 running\n" +
        "- Explore · Audit the access checks · Reading access.ts · 9 tools · 33.1k tokens · 48s\n" +
        "- general-purpose · Write the fixtures · 1 tool · 900 tokens · 48s",
    );

    feed(agents, notified("t1", "completed"), notified("t2", "failed"));
    expect(agents.block()).toBe("**Agents** · 1 done · 1 failed");
  });

  it("names only the first few of a large fan-out and counts the rest", () => {
    const agents = board(quietSink());
    feed(agents, ...Array.from({ length: 7 }, (_, index) => started(`t${index}`, `use${index}`, `Part ${index}`)));
    const lines = agents.block().split("\n");
    expect(lines[0]).toBe("**Agents** · 7 running");
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe("- and 3 more");
    expect(lines[1]).toBe("- general-purpose · Part 0 · 0 tools · 0s");
  });

  // As in the terminal: that an agent is working, on what, and what it has spent. Never its own edits or report.
  it("keeps one roster message in the side room, every agent in it, rewritten as they change", async () => {
    const sink = recordingSink();
    const agents = board(sink);
    feed(agents, started("t1", "use1", "Audit the access checks", "Explore"), started("t2", "use2", "Write the fixtures"));
    // With a side room the trail says nothing about agents, not even in the moment before the room has opened.
    expect(agents.block()).toBe("");
    await agents.flush();
    expect(agents.block()).toBe("");
    expect(sink.detailTitles).toEqual(["Agents: tidy the ledger"]);
    expect(sink.details).toEqual([
      "**1 · Explore** · Audit the access checks\nrunning · 0 tools\n\n" +
        "**2 · general-purpose** · Write the fixtures\nrunning · 0 tools",
    ]);

    feed(agents, progressed("t1", "Reading access.ts", 3), notified("t2", "completed"));
    await agents.flush();
    expect(sink.details).toEqual([
      "**1 · Explore** · Audit the access checks\nReading access.ts · 3 tools · 33.1k tokens\n\n" +
        "**2 · general-purpose** · Write the fixtures\ndone in 4s · 2 tools · 38.1k tokens",
    ]);
    expect(agents.follows("use1")).toBe(true);
    expect(agents.follows("other")).toBe(false);
    expect(agents.follows(null)).toBe(false);
  });

  // Each agent can be on something different, so one agent's task would misname the rest.
  it("names the side room after what was asked of the turn, within what a thread name may hold", () => {
    expect(agentsTitle(say, "Rework the   ledger\nand its tests")).toBe("Agents: Rework the ledger and its tests");
    expect(agentsTitle(say, "/code-review high")).toBe("Agents: /code-review high");
    expect(agentsTitle(say, "   ")).toBe("Agents");
    expect(agentsTitle(say, "y".repeat(300)).length).toBeLessThanOrEqual(100);
  });

  it("starts a second roster message past ten agents, so none outgrows a message", async () => {
    const sink = recordingSink();
    const agents = board(sink);
    feed(agents, ...Array.from({ length: 12 }, (_, index) => started(`t${index}`, `use${index}`, `Part ${index}`)));
    await agents.flush();
    expect(sink.details).toHaveLength(2);
    expect(sink.details[0]!.split("\n\n")).toHaveLength(10);
    expect(sink.details[1]).toContain("**12 · general-purpose** · Part 11");
  });

  // An agent reported done and then sent back to work is running again, under the entry it already has.
  it("puts an agent that is sent back to work under the entry it already has, adding to what it had done", async () => {
    const sink = recordingSink();
    const agents = board(sink);
    feed(
      agents,
      started("t1", "use1", "Create, wait, delete"),
      progressed("t1", "Writing two.txt", 3),
      notified("t1", "completed", 3),
    );
    await agents.flush();
    expect(sink.details[0]).toContain("done in 4s · 3 tools");

    feed(agents, started("t1", "use2", "Create, wait, delete"));
    await agents.flush();
    expect(sink.details[0]).toContain("running · 3 tools");
    expect(agents.follows("use1")).toBe(true);
    expect(agents.follows("use2")).toBe(true);

    feed(agents, progressed("t1", "Running rm two.txt", 2), notified("t1", "completed", 2));
    await agents.flush();
    expect(sink.details).toEqual(["**1 · general-purpose** · Create, wait, delete\ndone in 8s · 5 tools · 38.1k tokens"]);
  });

  // Stopping the turn kills this process, which a task running in the cloud would never notice.
  it("knows what a stop would reach, and which of it runs in the cloud", () => {
    const agents = board(quietSink());
    expect(agents.stopLabel()).toBeNull();
    const cloud = {
      type: "system",
      subtype: "task_started",
      task_id: "t8",
      description: "ultrareview: feat/ledger",
      task_type: "remote_agent",
    } as ClaudeEvent;
    feed(agents, cloud);
    expect(agents.stopLabel()).toBe("Stop cloud task");
    feed(agents, started("t1", "use1", "Audit"), started("t2", "use2", "Write"));
    expect(agents.stopLabel()).toBe("Stop agents");
    expect(agents.running()).toEqual(["t8", "t1", "t2"]);
    expect(agents.runningRemote()).toEqual(["t8"]);
    feed(agents, notified("t1", "completed"), notified("t8", "stopped"));
    expect(agents.running()).toEqual(["t2"]);
    expect(agents.runningRemote()).toEqual([]);
    expect(parseCustomId(stopAgentsActionId("s1"))).toEqual({ kind: "turn-stop-agents", sessionId: "s1" });
    expect(parseCustomId(sendNowActionId("s1"))).toEqual({ kind: "turn-send-now", sessionId: "s1" });
    expect(describeSendNow(say, "nothing-waiting")).toContain("already taken");
    expect(describeSendNow(say, "sent")).toContain("cut short so it could read your message");
    expect(describeStopAgents(say, 0)).toContain("nothing to stop");
    expect(describeStopAgents(say, 2)).toContain("Asked 2 tasks to stop");
  });

  // An agent reported done with a command of its own still running is not done: it stays stoppable, and the roster says it is waiting.
  it("treats an agent that left a command running as waiting, and reaches that command when stopping", async () => {
    const sink = recordingSink();
    const stopped: string[] = [];
    const agents = new AgentBoard(
      say,
      sink,
      "Agents: tidy the ledger",
      () => 0,
      0,
      (taskId) => void stopped.push(taskId),
    );
    const shell = {
      type: "system",
      subtype: "task_started",
      task_id: "b1",
      tool_use_id: "call1",
      description: "sleep",
      task_type: "local_bash",
      owned_by_subagent: true,
    } as ClaudeEvent;
    expect(agentEvent(shell)).toEqual({ kind: "background", taskId: "b1", toolUseId: "call1" });

    feed(agents, started("t1", "use1", "Build and wait"));
    agents.noteCall("use1", "call1");
    feed(agents, shell, notified("t1", "completed", 3));
    await agents.flush();
    expect(sink.details[0]).toBe(
      "**1 · general-purpose** · Build and wait\nwaiting on a background command · 3 tools · 38.1k tokens",
    );
    expect(agents.stopLabel()).toBe("Stop agents");
    expect(agents.running()).toEqual(["b1"]);

    expect(agents.claim()).toEqual(["b1"]);
    feed(agents, notified("b1", "stopped"));
    await agents.flush();
    expect(sink.details[0]).toContain("stopped after");
    expect(agents.stopLabel()).toBeNull();

    // The session may send a stopped agent back to work; it is stopped again, not left to run.
    feed(agents, started("t1", "use9", "Build and wait"));
    expect(stopped).toEqual(["t1"]);
  });

  it("opens no side room for a turn without agents, and still tallies where there is none to open", async () => {
    const idle = recordingSink();
    await board(idle).flush();
    expect(idle.detailTitles).toEqual([]);

    const agents = board(quietSink());
    feed(agents, started("t1", "use1", "Audit"));
    await agents.flush();
    expect(agents.block()).toBe("**Agents** · 1 running\n- general-purpose · Audit · 0 tools · 0s");
  });

  it("counts an agent still running when the turn ends as stopped, once", async () => {
    const sink = recordingSink();
    const agents = board(sink);
    feed(agents, started("t1", "use1", "Audit"));
    agents.end();
    agents.end();
    await agents.flush();
    expect(sink.details).toEqual(["**1 · general-purpose** · Audit\nstopped after 0s · 0 tools"]);
  });

  it("carries the tally under the trail's heading while it runs and when it is done", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(
      say,
      sink,
      () => 0,
      () => [],
      undefined,
      undefined,
      () => "**Agents** · 1 done",
    );
    await status.start();
    expect(sink.messages[0]).toBe("⏳ **Working** 0s\n\n**Agents** · 1 done");
    status.note("Looking at it.");
    await status.settle();
    expect(sink.messages[0]).toBe("✅ **Worked** 0s\n\n**Agents** · 1 done\n\nLooking at it.");
  });
});

describe("/run finds a conversation's commands", () => {
  const command = (name: string, description = "", extra: Partial<SessionCommand> = {}): SessionCommand => ({
    name,
    description,
    argumentHint: "",
    aliases: [],
    builtin: false,
    ...extra,
  });
  const known = [
    command("compact", "Free up context", { builtin: true, argumentHint: "<instructions>" }),
    command("code-review", "Review the current diff", { builtin: true, aliases: ["review"] }),
    command("ledger:code-review", "Review a pull request against the ledger rules", { argumentHint: "[pr]" }),
    command("ledger:audit", "Audit the books"),
    command("doctor", "Check the install", { builtin: true }),
    command("model", "Switch model", { builtin: true }),
  ];
  const runnable = (name: string) => classifyPrompt(`/${name}`, ["doctor"], []).kind === "passthrough";

  it("reads the list the session sends, tidying what a label cannot hold", () => {
    const event = {
      type: "system",
      subtype: "commands_changed",
      commands: [
        { name: "ledger:audit", description: "Audit\n  the books", argumentHint: " [year] ", aliases: ["books"] },
        { name: "compact", description: "Free up context", argumentHint: "", builtin: true },
        { description: "no name" },
      ],
    } as unknown as ClaudeEvent;
    expect(commandsChanged(event)).toEqual([
      { name: "ledger:audit", description: "Audit the books", argumentHint: "[year]", aliases: ["books"], builtin: false },
      { name: "compact", description: "Free up context", argumentHint: "", aliases: [], builtin: true },
    ]);
    expect(commandsChanged({ type: "system", subtype: "status", status: null })).toBeNull();
    const long = {
      type: "system",
      subtype: "commands_changed",
      commands: [{ name: "wordy", description: "y".repeat(400) }],
    } as unknown as ClaudeEvent;
    expect(commandsChanged(long)![0]!.description).toBe(`${"y".repeat(277)}...`);
  });

  it("offers what plugins and skills add before the built-ins, and never what the bridge would refuse", () => {
    expect(commandChoices(known, "", runnable)).toEqual([
      { name: "ledger:audit · Audit the books", value: "ledger:audit" },
      { name: "ledger:code-review [pr] · Review a pull request against the ledger rules", value: "ledger:code-review" },
      { name: "code-review · Review the current diff", value: "code-review" },
      { name: "compact <instructions> · Free up context", value: "compact" },
    ]);
  });

  it("ranks a name that starts with what was typed over one that contains it, over a description that mentions it", () => {
    const values = (typed: string) => commandChoices(known, typed, runnable).map((choice) => choice.value);
    expect(values("code")).toEqual(["code-review", "ledger:code-review"]);
    expect(values("/audit")).toEqual(["ledger:audit"]);
    expect(values("review")).toEqual(["ledger:code-review", "code-review"]);
    expect(values("context")).toEqual(["compact"]);
    expect(values("zzz")).toEqual([]);
  });

  it("keeps to Discord's limits however many commands there are", () => {
    const many = Array.from({ length: 60 }, (_, index) => command(`pack:command-${index}`, "y".repeat(300)));
    const choices = commandChoices(many, "", runnable);
    expect(choices).toHaveLength(25);
    for (const choice of choices) expect(choice.name.length).toBeLessThanOrEqual(100);
  });

  it("refuses what could not run, saying why, and lets the rest through", () => {
    expect(refusal(say, "ledger:audit", "/ledger:audit 2026", known, ["doctor"])).toBeNull();
    expect(refusal(say, "review", "/review", known, ["doctor"])).toBeNull();
    expect(refusal(say, "nope", "/nope", known, ["doctor"])).toContain("not a command this conversation has");
    expect(refusal(say, "nope", "/nope", [], ["doctor"])).toBeNull();
    expect(refusal(say, "doctor", "/doctor", known, ["doctor"])).toContain("interactive terminal");
    expect(refusal(say, "model", "/model opus", known, ["doctor"])).toContain("bot's own");
    expect(refusal(say, "rm -rf", "/rm -rf", known, ["doctor"])).toContain("not a command name");
    expect(refusal(say, "-", "/-", known, ["doctor"])).toContain("not known yet");
  });

  // Someone used to the terminal types the command; there it asks before starting, here it would not.
  it("turns away a typed command that asks first in a terminal, and says how to run it here", () => {
    for (const typed of ["/code-review ultra", "/review ultra --fix 12", "/ultrareview 12", "/CODE-REVIEW Ultra"]) {
      expect(classifyPrompt(typed, [], []).kind).toBe("asks-first");
    }
    const ultra = classifyPrompt("/code-review ultra --fix", [], []);
    expect(ultra.kind === "asks-first" && describeNotRun(say, ultra)).toContain("`/run command:code-review args:ultra --fix`");
    expect(ultra.kind === "asks-first" && describeNotRun(say, ultra)).toContain("billed");
    expect(ultra.kind === "asks-first" && describeNotRun(say, ultra)).toContain("waits for you to press Run");
    const bare = classifyPrompt("/ultrareview", [], []);
    expect(bare.kind === "asks-first" && describeNotRun(say, bare)).toContain("`/run command:ultrareview`");

    for (const typed of ["/code-review", "/code-review high --fix", "/code-review ultrawide", "/review 12"]) {
      expect(classifyPrompt(typed, [], []).kind).toBe("passthrough");
    }
  });

  it("lets /run take what a typed message may not, since /run is where it gets asked", () => {
    expect(refusal(say, "code-review", "/code-review ultra", known, ["doctor"])).toBeNull();
    expect(refusal(say, "ultrareview", "/ultrareview", [], ["doctor"])).toBeNull();
  });

  it("shows the exact line, what it does and what it takes before anything runs, with the cost where one is known", () => {
    expect(describeRun(say, "/ledger:code-review 12", known[2], null)).toBe(
      "Run this in the conversation?\n```\n/ledger:code-review 12\n```\n" +
        "Review a pull request against the ledger rules\nTakes: `[pr]`\nNothing starts until you press Run.",
    );
    const billed = describeRun(say, "/code-review ultra", known[1], "It starts a cloud review, which is billed.");
    expect(billed).toContain("**It starts a cloud review, which is billed.**");
    expect(describeRun(say, "/unlisted", undefined, null)).toBe(
      "Run this in the conversation?\n```\n/unlisted\n```\nNothing starts until you press Run.",
    );
  });

  it("holds what was asked for until its button is pressed, once, and not forever", () => {
    let now = 0;
    const pending = new Pending<{ prompt: string }>(() => now);
    pending.remember("m1", { prompt: "/compact" });
    expect(pending.take("m1")).toEqual({ prompt: "/compact" });
    expect(pending.take("m1")).toBeNull();
    pending.remember("m2", { prompt: "/compact" });
    now = PENDING_TTL_MS + 1;
    expect(pending.take("m2")).toBeNull();
    expect(parseCustomId(RUN_CONFIRM)).toEqual({ kind: "run-confirm" });
    expect(parseCustomId(RUN_CANCEL)).toEqual({ kind: "run-cancel" });
  });

  it("remembers a folder's commands across a restart, and writes only when they change", async () => {
    const file = path.join(os.tmpdir(), `claudetalk-commands-${process.pid}-${Math.random()}.json`);
    const cache = new CapabilityCache(file);
    await cache.load();
    expect(cache.commands("/srv/app")).toEqual([]);
    await cache.recordCommands("/srv/app", known);
    const written = (await fs.stat(file)).mtimeMs;
    await cache.recordCommands("/srv/app", known);
    expect((await fs.stat(file)).mtimeMs).toBe(written);

    const reloaded = new CapabilityCache(file);
    await reloaded.load();
    expect(reloaded.commands("/srv/app")).toEqual(known);
    expect(reloaded.commands("/srv/other")).toEqual([]);
    await fs.rm(file, { force: true });
  });
});

describe("StatusMessage formatting", () => {
  it("keeps a remark's paragraphs and code blocks instead of flattening them", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("First point.\n\n- one\n- two\n\n```diff\n- old\n+ new\n```");
    await status.settle();
    expect(sink.messages[0]).toContain("First point.\n\n- one\n- two\n\n```diff\n- old\n+ new\n```");
  });

  // A report the model writes mid-turn is shown whole, continued across messages, never cut with an ellipsis.
  it("continues a remark longer than a message across messages without cutting it", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    const paragraphs = Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}: ${"y".repeat(150)}`);
    status.note(paragraphs.join("\n\n"));
    await status.settle();
    const joined = sink.messages.join("\n");
    for (const paragraph of paragraphs) expect(joined).toContain(paragraph);
    expect(joined).not.toContain("...");
    for (const message of sink.messages) expect(message.length).toBeLessThan(2000);
  });

  // An answer with tables has to match its own remark, or it shows twice: raw pipes in the trail, boxes beneath.
  it("drops the echoed answer when it names a home path, is long enough to be cut up, or holds a table", async () => {
    const homePath = path.join(os.homedir(), "notes", "plan.md");
    const table = "| Kind | Tokens |\n|---|---|\n| System | 2.5k |\n| Tools | 8k |\n| Files | 5k |";
    const answer = `Context usage\n\n${table}\n\nMemory file: ${homePath}\n\n${"A long paragraph of remark. ".repeat(120)}`;
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("Looking it up.");
    status.note(answer);
    status.dropEcho(answer);
    await status.settle();
    expect(sink.messages.join("\n")).toContain("Looking it up.");
    expect(sink.messages.join("\n")).not.toContain("Context usage");
  });

  it("draws a table in a remark the way it draws one in an answer", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("| Kind | Tokens | Share |\n|---|---|---|\n| System | 2.5k | 1% |");
    await status.settle();
    expect(sink.messages[0]).toContain("```");
    expect(sink.messages[0]).not.toContain("|---|");
  });

  it("still drops the echoed answer when the remark kept its line breaks", () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    status.note("Two findings.\n\n- one\n- two");
    status.dropEcho("Two findings.\n\n- one\n- two");
    expect(status.hasNotes()).toBe(false);
  });

  it("puts the answer under the heading when the current message has no remarks of its own", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("Earlier remark.");
    sink.othersBelow = true;
    status.note("Later remark.");
    status.dropEcho("Later remark.");
    expect(status.currentIsEmpty()).toBe(true);
    expect(await status.finishWithHeading("Later remark.")).toBe(true);
    expect(sink.messages.at(-1)).toBe("✅ **Worked** 0s\n\nLater remark.");
    expect(await status.finishWithHeading("z".repeat(2000))).toBe(false);
  });
});

describe("chunkForDiscord with a smaller limit", () => {
  it("honours the limit it is given", () => {
    const chunks = chunkForDiscord(Array.from({ length: 10 }, (_, index) => `line ${index} ${"w".repeat(100)}`).join("\n"), 300);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(300);
  });
});

describe("convertTables", () => {
  // Discord has no table markup, so a two-column table reads best as a list with the key in bold.
  it("turns a two-column table into a list, keeping inline formatting", () => {
    const table = [
      "Deployed:",
      "",
      "| Surface | Check |",
      "|---|---|",
      "| api | new wording served |",
      "| wiki | every chunk `application/javascript` |",
    ].join("\n");
    expect(convertTables(table)).toBe(
      ["Deployed:", "", "- **api**: new wording served", "- **wiki**: every chunk `application/javascript`"].join("\n"),
    );
  });

  it("turns a wider table into an aligned code block without inline markup", () => {
    const table = ["| Name | Size | Note |", "|:---|---:|---|", "| `a.ts` | 12 | **big** |", "| b.ts | 3 | small |"].join("\n");
    expect(convertTables(table)).toBe(
      ["```", "Name  Size  Note", "----  ----  -----", "a.ts  12    big", "b.ts  3     small", "```"].join("\n"),
    );
  });

  it("leaves text without a header separator alone", () => {
    const notATable = "a | b\n| just a pipe | in prose |\nend";
    expect(convertTables(notATable)).toBe(notATable);
  });

  // A block planted inside a block would end the outer one early and leave a stray fence behind.
  it("leaves a table quoted inside a code block as the code it is", () => {
    const quoted = ["Write it like this:", "```md", "| a | b | c |", "|---|---|---|", "| 1 | 2 | 3 |", "```", "and then:"].join(
      "\n",
    );
    expect(convertTables(quoted)).toBe(quoted);
    const after = `${quoted}\n| a | b |\n|---|---|\n| 1 | 2 |`;
    expect(convertTables(after)).toBe(`${quoted}\n- **1**: 2`);
  });

  it("keeps a pipe that is written as escaped, or sits inside inline code, in its cell", () => {
    const table = ["| Step | Command |", "|---|---|", "| count | `ls | wc -l` |", "| either | a \\| b |"].join("\n");
    expect(convertTables(table)).toBe(["- **count**: `ls | wc -l`", "- **either**: a | b"].join("\n"));
  });

  it("drops emphasis inside a block but not a star that multiplies", () => {
    const table = ["| Sum | Works out to | Note |", "|---|---|---|", "| 2 * 3 * 4 | 24 | *exact* |"].join("\n");
    expect(convertTables(table)).toContain("2 * 3 * 4  24            exact");
  });

  it("loses nothing a table says: a cell past the second, and a heading with no rows under it", () => {
    const ragged = ["| Key | Value |", "|---|---|", "| port | 8080 | default |"].join("\n");
    expect(convertTables(ragged)).toBe("- **port**: 8080 · default");
    expect(convertTables("| Key | Value |\n|---|---|")).toBe("- **Key**: Value");
  });
});

describe("repo links against a real repository", () => {
  // A blob URL names the committed tree, so a file that is only on disk would link to a 404.
  it("links a committed file and leaves an untracked one plain", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "claudetalk-links-"));
    const run = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
    run("init", "-q");
    run("config", "user.email", "tests@example.invalid");
    run("config", "user.name", "Tests");
    run("remote", "add", "origin", "https://example.com/acme/ledger.git");
    await fs.writeFile(path.join(repo, "committed.md"), "tracked\n");
    await fs.writeFile(path.join(repo, "local-only.md"), "not tracked\n");
    run("add", "committed.md");
    run("commit", "-q", "-m", "initial");

    const links = await resolveReferences(repo, "See `committed.md` and `local-only.md`.");
    expect(links?.file("committed.md")).toContain("/blob/");
    expect(links?.file("local-only.md")).toBeNull();
    await fs.rm(repo, { recursive: true, force: true });
  });

  // A conversation can work in a folder below the repository's root, and a blob link is written from the root.
  it("links a file named from a folder inside the repository by its path from the root", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "links-subfolder-"));
    const run = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
    run("init", "-q");
    run("config", "user.email", "tests@example.invalid");
    run("config", "user.name", "Tests");
    run("remote", "add", "origin", "https://example.com/acme/ledger.git");
    const inside = path.join(repo, "packages", "app");
    await fs.mkdir(path.join(inside, "src"), { recursive: true });
    await fs.writeFile(path.join(inside, "src", "entry.ts"), "export {};\n");
    run("add", ".");
    run("commit", "-q", "-m", "initial");

    const links = await resolveReferences(inside, "See `src/entry.ts`.");
    expect(links?.file("src/entry.ts", "3")).toMatch(/\/blob\/[0-9a-f]{40}\/packages\/app\/src\/entry\.ts#L3$/);
    await fs.rm(repo, { recursive: true, force: true });
  });
});

describe("repo links", () => {
  const verified = {
    head: "abc1234abc1234abc1234abc1234abc1234abc12",
    prefix: "",
    commits: new Set(["e2ea070", "2d560e0"]),
    branches: new Set(["main", "feat/drain-on-stop"]),
    tags: new Set(["v0.14.0"]),
    files: new Set(["src/discord/turnFlow.ts", "README.md", "pkg/__init__.py"]),
  };
  const links = referenceLinks("https://github.com/someone/project", verified);
  const base = "https://github.com/someone/project";

  it("reads the web page out of every spelling of a remote", () => {
    expect(remoteWebUrl("git@github.com:someone/project.git")).toBe(base);
    expect(remoteWebUrl("https://github.com/someone/project.git")).toBe(base);
    expect(remoteWebUrl("https://github.com/someone/project")).toBe(base);
    expect(remoteWebUrl("ssh://git@gitlab.example.com:2222/team/thing.git")).toBe("https://gitlab.example.com/team/thing");
    // The port of an http remote is where the forge's pages are served too; an ssh one's is only ssh's.
    expect(remoteWebUrl("https://forge.example.com:8443/team/thing.git")).toBe("https://forge.example.com:8443/team/thing");
    expect(remoteWebUrl("http://forge.lan:3000/team/thing")).toBe("http://forge.lan:3000/team/thing");
    expect(remoteWebUrl("/srv/git/bare-repo.git")).toBeNull();
  });

  it("links a commit hash only when the repo knows it, keeping the embed suppressed", () => {
    expect(linkReferences("Pushed `e2ea070` and 2d560e0.", links)).toBe(
      `Pushed [e2ea070](<${base}/commit/e2ea070>) and [2d560e0](<${base}/commit/2d560e0>).`,
    );
    expect(linkReferences("Not a commit: `deadbee` nor cafef00d.", links)).toBe("Not a commit: `deadbee` nor cafef00d.");
  });

  // "#3" is as often the third point someone raised as a tracker item, and a link to the wrong item misleads.
  it("links a number only when the words before it name a change request", () => {
    expect(linkReferences("Landed as PR #8.", links)).toBe(`Landed as PR [#8](<${base}/issues/8>).`);
    expect(linkReferences("Pull requests #4, #5 and #6 merged.", links)).toBe(
      `Pull requests [#4](<${base}/issues/4>), [#5](<${base}/issues/5>) and [#6](<${base}/issues/6>) merged.`,
    );
    const plain = [
      "Let me speak concretely to issue #3.",
      "Landed as #8.",
      "That fixes #2 on your list, and step #4 is next.",
      "The PR covers points #1 and #2.",
    ];
    for (const text of plain) expect(linkReferences(text, links)).toBe(text);
  });

  it("sends a named merge request to the host's own page for one", () => {
    const gitlab = referenceLinks("https://gitlab.com/acme/ledger", verified);
    expect(linkReferences("MR #7 is up.", gitlab)).toBe("MR [#7](<https://gitlab.com/acme/ledger/-/merge_requests/7>) is up.");
  });

  it("links branches, tags and files with their lines", () => {
    expect(linkReferences("On `feat/drain-on-stop`, tagged `v0.14.0`.", links)).toBe(
      `On [feat/drain-on-stop](<${base}/tree/feat/drain-on-stop>), tagged [v0.14.0](<${base}/releases/tag/v0.14.0>).`,
    );
    expect(linkReferences("See `src/discord/turnFlow.ts:283` and src/discord/turnFlow.ts:10-12.", links)).toBe(
      `See [src/discord/turnFlow.ts:283](<${base}/blob/${verified.head}/src/discord/turnFlow.ts#L283>) and ` +
        `[src/discord/turnFlow.ts:10-12](<${base}/blob/${verified.head}/src/discord/turnFlow.ts#L10-L12>).`,
    );
  });

  it("leaves fenced code, existing links, wrapped urls and unknown names alone", () => {
    const fenced = "```\ngit show e2ea070\n```";
    expect(linkReferences(fenced, links)).toBe(fenced);
    const already = `[e2ea070](<${base}/commit/e2ea070>) and <${base}/pull/8> and \`src/missing.ts\` and \`nothing\``;
    expect(linkReferences(already, links)).toBe(already);
  });

  // A bare URL keeps working inside angle brackets, and Discord then hangs no embed under the message.
  it("wraps bare urls and links domain names, with the sentence's punctuation left outside", () => {
    expect(linkPlain("See https://example.org/docs/page, then example.com.")).toBe(
      "See <https://example.org/docs/page>, then [example.com](<https://example.com>).",
    );
    expect(linkPlain("package.json and index.ts are files, node.js too")).toBe(
      "package.json and index.ts are files, node.js too",
    );
  });

  // .sh and .app end a file name far more often than a site's, and a link to a stranger's domain misleads.
  it("leaves a script or an app bundle named in prose as text, and still links a site under the same ending", () => {
    const files = "Run deploy.sh and then install.sh, or open Info.app.";
    expect(linkPlain(files)).toBe(files);
    expect(linkReferences(files, links)).toBe(files);
    expect(linkPlain("It is up at ledger.example.app and get.example.sh/install.")).toBe(
      "It is up at [ledger.example.app](<https://ledger.example.app>) and [get.example.sh/install](<https://get.example.sh/install>).",
    );
  });

  it("keeps the markup and brackets around a url out of its target", () => {
    expect(linkPlain("**https://example.com/docs**")).toBe("**<https://example.com/docs>**");
    expect(linkPlain('_https://example.com_ and "https://example.com/a"')).toBe(
      '_<https://example.com>_ and "<https://example.com/a>"',
    );
    expect(linkPlain("[see https://example.com/b]")).toBe("[see <https://example.com/b>]");
    expect(linkPlain("(at https://example.com/c).")).toBe("(at <https://example.com/c>).");
  });

  it("keeps a closing bracket the url itself opened", () => {
    expect(linkPlain("See https://example.org/wiki/Ledger_(book).")).toBe("See <https://example.org/wiki/Ledger_(book)>.");
    expect(linkPlain("See [the book](https://example.org/wiki/Ledger_(book)).")).toBe(
      "See [the book](<https://example.org/wiki/Ledger_(book)>).",
    );
  });

  it("keeps any bracket the url itself opened, and still leaves out one that wraps it", () => {
    expect(linkPlain("GET https://api.example.com/v1/users/{id}")).toBe("GET <https://api.example.com/v1/users/{id}>");
    expect(linkPlain("Listening on http://[::1]")).toBe("Listening on <http://[::1]>");
    expect(linkPlain("See docs.example.com/api/{version}.")).toBe(
      "See [docs.example.com/api/{version}](<https://docs.example.com/api/{version}>).",
    );
    expect(linkPlain("{at https://example.com/d}")).toBe("{at <https://example.com/d>}");
  });

  // A trail's remarks pass the gate when they are noted and are linked afterwards, so an escape is already in the text by then.
  it("does not escape again what the gate escaped already, and keeps the escape out of the address", () => {
    expect(linkPlain(forDiscord("Cloning github.com/acme/my_repo now."))).toBe(
      "Cloning [github.com/acme/my\\_repo](<https://github.com/acme/my_repo>) now.",
    );
  });

  it("writes a folder above the working directory into a file link as a url holds it", () => {
    const inFolder = (prefix: string) => referenceLinks(base, { ...verified, prefix }).file("README.md", "3");
    expect(inFolder("my app/")).toBe(`${base}/blob/${verified.head}/my%20app/README.md#L3`);
    expect(inFolder("C#/what?/")).toBe(`${base}/blob/${verified.head}/C%23/what%3F/README.md#L3`);
    expect(inFolder("packages/app/")).toBe(`${base}/blob/${verified.head}/packages/app/README.md#L3`);
  });

  // Discord draws __init__ inside link text as underline, and the reader sees a file called init.
  it("escapes a marker in a file name it links, so the name reads as it is written", () => {
    expect(linkReferences("Edit `pkg/__init__.py`.", links)).toBe(
      `Edit [pkg/\\_\\_init\\_\\_.py](<${base}/blob/${verified.head}/pkg/__init__.py>).`,
    );
  });

  it("wraps the target of a link written in the answer, and leaves a wrapped or relative one alone", () => {
    const written = "The guide is in [Scripting Patterns](https://example.org/wiki/scripting).";
    const wrapped = "The guide is in [Scripting Patterns](<https://example.org/wiki/scripting>).";
    expect(linkPlain(written)).toBe(wrapped);
    expect(linkReferences(written, links)).toBe(wrapped);
    expect(linkPlain(wrapped)).toBe(wrapped);
    expect(linkPlain("See [the notes](docs/notes.md).")).toBe("See [the notes](docs/notes.md).");
  });

  // The usual way a commit is quoted is hash and subject in one code span; the hash is the reference.
  it("links the hash out of a code span that quotes a commit with its subject", () => {
    expect(linkReferences("On top of `e2ea070 fix(validator): reject a location`.", links)).toBe(
      `On top of [e2ea070](<${base}/commit/e2ea070>) \`fix(validator): reject a location\`.`,
    );
    expect(linkReferences("On top of `deadbee fix: nothing`.", links)).toBe("On top of `deadbee fix: nothing`.");
    expect([...collectReferences("`e2ea070 fix: subject`").hashes]).toEqual(["e2ea070"]);
  });

  // A slash in a code span is not a repository: media types, key paths and ratios all look the same.
  it("leaves an owner/repo-shaped code span alone", () => {
    const text = "Forked from `someone-else/thing`, served as `application/javascript`.";
    expect(linkReferences(text, links)).toBe(text);
  });

  it("uses each host's own path shapes, including GitLab's merge requests", () => {
    const gitlab = referenceLinks("https://gitlab.com/team/thing", verified);
    expect(gitlab.commit("e2ea070")).toBe("https://gitlab.com/team/thing/-/commit/e2ea070");
    expect(gitlab.file("README.md", "3")).toBe(`https://gitlab.com/team/thing/-/blob/${verified.head}/README.md#L3`);
    expect(linkReferences("Merged as !12.", gitlab)).toBe(
      "Merged as [!12](<https://gitlab.com/team/thing/-/merge_requests/12>).",
    );
    expect(linkReferences("Merged as !12.", links)).toBe("Merged as !12.");
    const bitbucket = referenceLinks("https://bitbucket.org/team/thing", verified);
    expect(bitbucket.commit("e2ea070")).toBe("https://bitbucket.org/team/thing/commits/e2ea070");
    expect(bitbucket.ref("main")).toBe("https://bitbucket.org/team/thing/branch/main");
  });

  it("collects only what the text mentions, so nothing else is looked up", () => {
    const found = collectReferences("Fixed in `e2ea070`, see `src/x.ts:4` on `main`; #12 too.");
    expect([...found.hashes]).toEqual(["e2ea070"]);
    expect([...found.files]).toEqual(["src/x.ts"]);
    expect(found.names.has("main")).toBe(true);
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
      turns: 2,
      costUsd: 0.75,
      inputTokens: 200,
      outputTokens: 20,
      cachedTokens: 14,
      lastCostUsd: 0.25,
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
    expect(say("context.critical", { percent: warning!.percent })).toContain("/compact");
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
    expect(classifyPrompt("what does this repo do?", terminalOnly, []).kind).toBe("turn");
  });

  it("passes a Claude Code slash command through", () => {
    expect(classifyPrompt("/compact", terminalOnly, []).kind).toBe("passthrough");
  });

  it("passes a namespaced skill command through", () => {
    expect(classifyPrompt("/superpowers:brainstorming", terminalOnly, []).kind).toBe("passthrough");
  });

  it("rejects a terminal-only command with an explanation", () => {
    const result = classifyPrompt("/doctor", terminalOnly, []);
    expect(result.kind).toBe("terminal-only");
    expect(result.kind === "terminal-only" && describeNotRun(say, result)).toContain("doctor");
  });

  it("refuses to pass through /model, which would silently revert", () => {
    const result = classifyPrompt("/model opus", terminalOnly, []);
    expect(result.kind).toBe("bridge-owned");
    expect(result.kind === "bridge-owned" && describeNotRun(say, result)).toContain("/model");
  });

  it("refuses to pass through /effort for the same reason", () => {
    expect(classifyPrompt("/effort high", terminalOnly, []).kind).toBe("bridge-owned");
  });

  it("does not treat a path at the start of a message as a command", () => {
    expect(classifyPrompt("/home/u/x is the path", terminalOnly, []).kind).toBe("turn");
  });

  describe("a command typed by one of its other names", () => {
    const listed = (name: string, aliases: string[]) => ({ name, aliases, description: "", argumentHint: "", builtin: true });
    const known = [listed("clear", ["reset", "new"]), listed("doctor", ["checkup"]), listed("code-review", ["review"])];

    it("is judged as the command it stands for", () => {
      expect(classifyPrompt("/reset", terminalOnly, known).kind).toBe("ambiguous");
      expect(classifyPrompt("/new", terminalOnly, known).kind).toBe("ambiguous");
      expect(classifyPrompt("/checkup", terminalOnly, known).kind).toBe("terminal-only");
      const review = classifyPrompt("/review ultra --fix", terminalOnly, known);
      expect(review.kind === "asks-first" && describeNotRun(say, review)).toContain(
        "`/run command:code-review args:ultra --fix`",
      );
    });

    // A conversation opened with /resume has no list until its first turn, and /reset there would start a session the channel cannot see.
    it("is still recognised before the folder's command list has been learned", () => {
      expect(classifyPrompt("/reset", terminalOnly, []).kind).toBe("ambiguous");
      expect(classifyPrompt("/new", terminalOnly, []).kind).toBe("ambiguous");
      expect(classifyPrompt("/review ultra", terminalOnly, []).kind).toBe("asks-first");
    });

    it("belongs to the command that has it as its own name before it is anyone's alias", () => {
      const withOwn = [...known, listed("new", [])];
      expect(classifyPrompt("/new", terminalOnly, withOwn)).toEqual({ kind: "passthrough", command: "new" });
    });
  });
});

describe("formatSessionList", () => {
  it("marks a live session", () => {
    const output = formatSessionList(say, [
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

  // A UTC time that does not say so reads as local, and is hours off.
  it("gives the last activity as a Discord timestamp, so it shows in the reader's zone", () => {
    const lastActivity = new Date("2026-09-13T14:32:00Z");
    const output = formatSessionList(say, [record({ sessionId: "a", name: "Deploy Scripts", cwd: "/p/deploy", lastActivity })]);
    expect(output).toContain(`<t:${Math.floor(lastActivity.getTime() / 1000)}:f>`);
    expect(output).not.toContain("2026-09-13 14:32");
  });

  it("says so when there is nothing to list", () => {
    expect(formatSessionList(say, [])).toMatch(/no conversations/i);
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

  it("has nowhere to put an operator with no workspace root configured", () => {
    expect(workingDirFor(bridge(), "operator", "u1")).toBeNull();
    expect(say("create.ownersOnlyHere")).toContain("WORKSPACES_ROOT");
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
});

describe("killTree", () => {
  // On POSIX both signals throw for a process that has exited, and a Stop that lands late must not.
  it("does nothing, and does not throw, for a process that is already gone", async () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    const pid = child.pid!;
    await new Promise((resolve) => child.once("exit", resolve));
    expect(() => killTree(pid)).not.toThrow();
  });
});

describe("acquireInstanceLock", () => {
  let lockPath: string;

  beforeEach(async () => {
    lockPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "lock-")), "bridge.lock");
  });

  // Read and then written, the lock goes to both of two bridges starting in the same instant; taking it has to be one step.
  it("lets only one of two processes starting together take the lock", async () => {
    const lockModule = pathToFileURL(path.join(import.meta.dirname, "..", "src", "instanceLock.ts")).href;
    const contender = `
      import { acquireInstanceLock } from ${JSON.stringify(lockModule)};
      try {
        await acquireInstanceLock(process.argv[1]);
        console.log("ACQUIRED");
        setTimeout(() => undefined, 1500);
      } catch {
        console.log("REFUSED");
      }`;
    const start = (): Promise<string> =>
      new Promise((resolve) => {
        const flags = ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", contender, lockPath];
        execFile(process.execPath, flags, (_error, stdout) => resolve(stdout.trim()));
      });

    const outcomes = await Promise.all([start(), start(), start()]);
    expect(outcomes.filter((outcome) => outcome === "ACQUIRED")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "REFUSED")).toHaveLength(2);
  }, 20_000);

  it("acquires a lock when none exists", async () => {
    const lock = await acquireInstanceLock(lockPath);
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).pid).toBe(process.pid);
    await lock.release();
    expect(await fs.stat(lockPath).catch(() => null)).toBeNull();
  });

  // The stop script reads this to know it is waiting on a turn rather than on a dead bridge.
  it("reports how many turns it is draining, keeping the moment the drain began", async () => {
    const lock = await acquireInstanceLock(lockPath);
    await lock.noteDraining(2);
    const first = JSON.parse(await fs.readFile(lockPath, "utf8")).draining;
    await lock.noteDraining(1);
    const second = JSON.parse(await fs.readFile(lockPath, "utf8")).draining;
    expect(first).toEqual({ since: expect.any(String), turns: 2 });
    expect(second).toEqual({ since: first.since, turns: 1 });
    await lock.release();
  });

  it("refuses when another live process is still beating", async () => {
    const now = new Date().toISOString();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: now, heartbeatAt: now }));
    await expect(acquireInstanceLock(lockPath, () => true)).rejects.toThrow(/already running/i);
  });

  it("takes over a lock whose pid was reused but whose heartbeat stopped", async () => {
    const old = new Date(Date.now() - STALE_AFTER_MS - 1000).toISOString();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: old, heartbeatAt: old }));
    const lock = await acquireInstanceLock(lockPath, () => true);
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).pid).toBe(process.pid);
    await lock.release();
  });

  it("names the lock file so a stale one can be cleared", async () => {
    const now = new Date().toISOString();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: now, heartbeatAt: now }));
    await expect(acquireInstanceLock(lockPath, () => true)).rejects.toThrow(lockPath);
  });

  it("takes over a lock whose process is gone", async () => {
    const now = new Date().toISOString();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: now, heartbeatAt: now }));
    const lock = await acquireInstanceLock(lockPath, () => false);
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).pid).toBe(process.pid);
    await lock.release();
  });

  it("never treats its own pid as a competing holder", () => {
    const now = new Date().toISOString();
    expect(isLockHeld({ pid: process.pid, startedAt: now, heartbeatAt: now }, Date.now(), () => true)).toBe(false);
  });

  it("takes over a corrupt lock file rather than wedging", async () => {
    await fs.writeFile(lockPath, "not json");
    const lock = await acquireInstanceLock(lockPath);
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).pid).toBe(process.pid);
    await lock.release();
  });

  // A bridge suspended past the stale limit wakes to find its lock taken, and two bridges answer every message twice.
  it("stands down when its heartbeat finds the lock is another bridge's, and leaves that lock as it is", async () => {
    const lock = await acquireInstanceLock(lockPath);
    const takenBy: unknown[] = [];
    lock.whenTaken((holder) => takenBy.push(holder.pid));
    await lock.beat();
    expect(takenBy).toEqual([]);

    const successor = JSON.stringify({ pid: 999999, startedAt: "x", heartbeatAt: new Date().toISOString() });
    await fs.writeFile(lockPath, successor);
    await lock.beat();
    await lock.noteDraining(1);
    await lock.beat();
    expect(takenBy).toEqual([999999]);
    expect(await fs.readFile(lockPath, "utf8")).toBe(successor);
    await lock.release();
    expect(await fs.readFile(lockPath, "utf8")).toBe(successor);
  });

  it("releases only its own lock", async () => {
    const lock = await acquireInstanceLock(lockPath);
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: "x" }));
    await lock.release();
    expect(await fs.readFile(lockPath, "utf8")).toContain("999999");
  });
});

describe("pluginSelectOptions", () => {
  const raw = JSON.stringify([
    { id: "superpowers@claude-plugins-official", version: "6.3.0", scope: "user", enabled: true, installPath: "/x" },
    { id: "code-review@claude-plugins-official", version: "1.0.0", scope: "user", enabled: false, installPath: "/y" },
  ]);

  it("shows the enabled state in the description", () => {
    const options = pluginSelectOptions(say, parsePluginList(raw));
    expect(options[0]!.description).toMatch(/enabled/);
    expect(options[1]!.description).toMatch(/disabled/);
  });

  it("keeps labels within the Discord 100 character limit", () => {
    const long = JSON.stringify([{ id: "x".repeat(200), version: "1", scope: "user", enabled: true, installPath: "/z" }]);
    expect(pluginSelectOptions(say, parsePluginList(long))[0]!.label.length).toBeLessThanOrEqual(100);
  });

  it("caps at the Discord 25 option limit", () => {
    const many = JSON.stringify(
      Array.from({ length: 40 }, (_, index) => ({
        id: `p${index}`,
        version: "1",
        scope: "user",
        enabled: true,
        installPath: "/z",
      })),
    );
    expect(pluginSelectOptions(say, parsePluginList(many))).toHaveLength(25);
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

  const stamp = (at: Date) => `<t:${Math.floor(at.getTime() / 1000)}:f>`;

  // A time alone reads as today's, and what is caught up on can be weeks old.
  it("labels the source, and the date and time as a Discord timestamp so it shows in the reader's zone", () => {
    const out = formatExchanges(say, exchanges);
    expect(out).toContain(`**You** · terminal · ${stamp(exchanges[0]!.at)}`);
    expect(out).toContain(`**Claude** · terminal · ${stamp(exchanges[1]!.at)}`);
  });

  it("uses a plain clock with its date where Discord will not render one", () => {
    const out = formatExchanges(say, exchanges, "plain");
    expect(out).toContain("**You** · terminal · 2026-09-13 14:32 UTC");
    expect(out).not.toContain("<t:");
  });

  it("truncates a very long exchange", () => {
    const long = [{ at: new Date("2026-09-13T14:32:00Z"), role: "assistant" as const, text: "x".repeat(5000) }];
    expect(formatExchanges(say, long).length).toBeLessThan(1400);
  });

  // Catching up means where you left off; fifty-five messages inline is a wall, not a glance.
  it("keeps only the latest few messages that fit, newest last", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      at: new Date(Date.UTC(2026, 8, 13, 14, index)),
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `message ${index}`,
    }));
    expect(latestThatFit(say, many, 1880).map((exchange) => exchange.text)).toEqual([
      "message 6",
      "message 7",
      "message 8",
      "message 9",
    ]);

    const long = many.map((exchange) => ({ ...exchange, text: "y".repeat(1200) }));
    const fitted = latestThatFit(say, long, 1880);
    expect(fitted).toEqual([long[9]]);
    expect(latestThatFit(say, long.slice(0, 1), 10)).toEqual([long[0]]);
  });

  it("describes drift with a count, how long ago the last was, and its date", () => {
    const notice = describeDrift(say, { exchanges, reachesBack: true });
    expect(notice).toContain("2 messages");
    expect(notice).toContain(`The last was <t:${Math.floor(exchanges[1]!.at.getTime() / 1000)}:R>, ${stamp(exchanges[1]!.at)}.`);
    expect(notice).toContain("/sync");
    expect(notice).not.toContain("only the most recent");
  });

  it("uses the singular for one message", () => {
    expect(describeDrift(say, { exchanges: exchanges.slice(0, 1), reachesBack: true })).toContain("1 message happened");
  });

  // Only the end of a transcript is read, so a count of what happened since can fall short of what did.
  it("says the count is only the most recent when the transcript was not read back far enough", () => {
    expect(describeDrift(say, { exchanges, reachesBack: false })).toContain(
      "That counts only the most recent: the bridge reads back the last 3 MB of a transcript",
    );
  });
});

describe("a transcript larger than the window read from its end", () => {
  const line = (record: Record<string, unknown>): string => `${JSON.stringify(record)}\n`;
  const said = (minute: number, text: string) =>
    line({ type: "user", timestamp: `2026-09-13T10:${String(minute).padStart(2, "0")}:00.000Z`, message: { content: text } });
  const bulk = (megabytes: number): string =>
    line({
      type: "assistant",
      timestamp: "2026-09-13T10:30:00.000Z",
      message: { content: [{ type: "tool_use", name: "x".repeat(megabytes * 1024 * 1024) }] },
    });
  const written = async (content: string): Promise<string> => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "long-transcript-")), "session.jsonl");
    await fs.writeFile(file, content);
    return file;
  };

  it("widens the window until it holds a whole record, so one huge last line is not an empty transcript", async () => {
    const file = await written(said(1, "first") + line({ type: "user", cwd: "/srv/app", pasted: "y".repeat(400) }));
    expect((await readTail(file, 64))?.text).toContain('"cwd":"/srv/app"');

    const heavy = await written(said(1, "first") + bulk(4));
    expect((await scanTranscript(heavy)).hasContent).toBe(true);
  });

  // Claude Code closes nearly every transcript with a line of its own, a title or a cost, after the last thing anyone said.
  it("widens past a line of bookkeeping to the message before it, however large that message is", async () => {
    const titled = line({ type: "custom-title", customTitle: "Heavy" });
    const pasted = line({
      type: "user",
      cwd: "/srv/app",
      timestamp: "2026-09-13T10:31:00.000Z",
      message: { content: "y".repeat(4 * 1024 * 1024) },
    });
    const file = await written(said(1, "first") + pasted + titled);

    const info = await scanTranscript(file);
    expect(info).toMatchObject({ name: "Heavy", cwd: "/srv/app", hasContent: true });
    expect((await readExchangesSince(file)).exchanges.length).toBeGreaterThan(0);
  });

  it("says whether what it read reaches back to the moment asked about", async () => {
    const file = await written(said(1, "before the gap") + bulk(2) + bulk(2) + said(40, "after the gap"));
    const sinceStart = await readExchangesSince(file, new Date("2026-09-13T10:00:00Z"));
    expect(sinceStart.exchanges.map((exchange) => exchange.text)).toEqual(["after the gap"]);
    expect(sinceStart.reachesBack).toBe(false);

    const sinceLate = await readExchangesSince(file, new Date("2026-09-13T10:35:00Z"));
    expect(sinceLate.exchanges.map((exchange) => exchange.text)).toEqual(["after the gap"]);
    expect(sinceLate.reachesBack).toBe(true);

    const small = await written(said(1, "one") + said(2, "two"));
    expect((await readExchangesSince(small)).reachesBack).toBe(true);
  });
});

describe("the session index", () => {
  const indexed = async (copies: Array<{ folder: string; minute: number }>) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "projects-"));
    for (const copy of copies) {
      await fs.mkdir(path.join(root, copy.folder), { recursive: true });
      const stamped = {
        type: "user",
        cwd: "/srv/app",
        timestamp: `2026-09-13T10:${String(copy.minute).padStart(2, "0")}:00.000Z`,
      };
      await fs.writeFile(path.join(root, copy.folder, "s1.jsonl"), `${JSON.stringify(stamped)}\n`);
    }
    return root;
  };
  const live = { pid: 4321, cwd: "/srv/app", kind: "interactive" as const, sessionId: "s1" };

  const SECOND = 1000;
  const clocked = async (listings: Array<(typeof live)[] | null>) => {
    const clock = { now: 0, asked: 0 };
    const listLive = async () => {
      clock.asked += 1;
      return listings.shift() ?? null;
    };
    const index = new SessionIndex(listLive, await indexed([{ folder: "-srv-app", minute: 1 }]), () => clock.now);
    return { index, clock };
  };

  // A listing that timed out is not word that nothing is live, and a turn let through on it would collide with an open terminal.
  it("does not take a listing that failed for nothing being live", async () => {
    const { index, clock } = await clocked([[live], null]);

    expect((await index.find("s1"))?.live).toEqual(live);
    clock.now = 6 * SECOND;
    expect((await index.find("s1"))?.live).toEqual(live);
  });

  // Every look at a conversation asks what is live, and a listing that fails costs a spawned process each time it is asked for.
  it("asks again only after a while when the listing fails, as it does when it works", async () => {
    const { index, clock } = await clocked([null, null, [live]]);

    for (const _look of [1, 2, 3]) expect((await index.find("s1"))?.live).toBeNull();
    expect(clock.asked).toBe(1);
    clock.now = 6 * SECOND;
    await index.find("s1");
    await index.find("s1");
    expect(clock.asked).toBe(2);
    clock.now = 12 * SECOND;
    expect((await index.find("s1"))?.live).toEqual(live);
  });

  // The terminal it names may have been closed long since, and a conversation must not be refused over it for as long as listings fail.
  it("stops believing the last listing that worked once it is a minute old", async () => {
    const { index, clock } = await clocked([[live]]);

    expect((await index.find("s1"))?.live).toEqual(live);
    clock.now = 50 * SECOND;
    expect((await index.find("s1"))?.live).toEqual(live);
    clock.now = 70 * SECOND;
    expect((await index.find("s1"))?.live).toBeNull();
  });

  it("does not keep a listing that was out while it was told to forget", async () => {
    const asked: Array<(sessions: (typeof live)[]) => void> = [];
    const listLive = () => new Promise<(typeof live)[]>((resolve) => asked.push(resolve));
    const index = new SessionIndex(listLive, await indexed([{ folder: "-srv-app", minute: 1 }]));

    const before = index.find("s1");
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    index.forgetLive();
    asked[0]!([live]);
    await before;

    const after = index.find("s1");
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    asked[1]!([]);
    expect((await after)?.live).toBeNull();
  });

  it("asks again at once after being told to forget what was live", async () => {
    const listings: Array<(typeof live)[] | null> = [[live], []];
    const index = new SessionIndex(async () => listings.shift() ?? null, await indexed([{ folder: "-srv-app", minute: 1 }]));

    expect((await index.find("s1"))?.live).toEqual(live);
    expect((await index.find("s1"))?.live).toEqual(live);
    index.forgetLive();
    expect((await index.find("s1"))?.live).toBeNull();
  });

  it("takes the copy written to last when one session has a transcript under two folders", async () => {
    const root = await indexed([
      { folder: "-srv-app", minute: 50 },
      { folder: "-srv-other", minute: 5 },
    ]);
    const found = await new SessionIndex(async () => [], root).find("s1");
    expect(found?.transcriptPath).toBe(path.join(root, "-srv-app", "s1.jsonl"));
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
    expect(context.text).toContain("First (<@u1>) at 2026-09-13 14:30 UTC: the nas is full");
    expect(context.text).toContain("Second (<@u2>) at 2026-09-13 14:31 UTC: since when?");
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

  it("counts the messages it carries, leaving out one with nothing written in it", () => {
    const withAnEmbedOnly = [...messages, { ...messages[0]!, content: "  " }];
    expect(buildContext(withAnEmbedOnly).carried).toBe(messages.length);
    expect(attributionOnly(messages[0]!).carried).toBe(0);
    expect(noContext().carried).toBe(0);
  });

  it("skips empty messages such as bare attachments", () => {
    const context = buildContext([{ ...messages[0]!, content: "   " }]);
    expect(context.text).toBe("");
    expect(context.mentionableUserIds).toEqual([]);
  });

  it("truncates a very long message", () => {
    const context = buildContext([{ ...messages[0]!, content: "x".repeat(5000) }]);
    expect(context.text).toContain(`${"x".repeat(597)}...`);
    expect(context.text).not.toContain("x".repeat(598));
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
      "ask",
      "sync",
      "whoami",
      "members",
      "skills",
      "stop",
      "create",
      "resume",
      "invite",
      "operator",
      "unbind",
      "purge",
      "clear",
      "takeover",
      "run",
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
  it("never contains an 8.3 short name, so it is spelled the way indexed folders are", () => {
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
    expect(humanAge(say, new Date("2026-09-14T11:45:00Z"), now)).toBe("15m ago");
    expect(humanAge(say, new Date("2026-09-14T09:00:00Z"), now)).toBe("3h ago");
    expect(humanAge(say, new Date("2026-09-11T12:00:00Z"), now)).toBe("3d ago");
    expect(humanAge(say, null, now)).toBe("unknown");
  });

  it("submits the session id so duplicate names stay distinguishable", () => {
    const large = record({ sessionId: "id-a", name: "project-notes", sizeBytes: 48 * 1024 ** 2 });
    const small = record({ sessionId: "id-b", name: "project-notes", sizeBytes: 1024 });
    expect(sessionChoice(say, large).value).toBe("id-a");
    expect(sessionChoice(say, small).value).toBe("id-b");
    expect(sessionChoice(say, large).name).not.toBe(sessionChoice(say, small).name);
  });

  // Every untitled conversation in a folder takes that folder's name, so size and age alone
  // cannot tell two of them apart.
  it("tags an untitled conversation with its id", () => {
    const one = record({ sessionId: "4e5b4e8e-ec44-4942", name: null, cwd: "/p/claudetalk", sizeBytes: 1024 });
    const two = record({ sessionId: "89e4c5e6-ccfd-4880", name: null, cwd: "/p/claudetalk", sizeBytes: 1024 });
    expect(sessionChoice(say, one).name).toContain("4e5b4e8e");
    expect(sessionChoice(say, two).name).toContain("89e4c5e6");
    expect(sessionChoice(say, one).name).not.toBe(sessionChoice(say, two).name);
  });

  it("leaves a titled conversation's label alone", () => {
    const named = record({ sessionId: "4e5b4e8e-ec44-4942", name: "Deploy Scripts", sizeBytes: 1024 });
    expect(sessionChoice(say, named).name).not.toContain("4e5b4e8e");
    expect(sessionChoice(say, named).name).toBe("Deploy Scripts · 1 KB · unknown");
  });

  it("tags untitled conversations in the listing too", () => {
    const output = formatSessionList(say, [
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
    expect(sessionChoice(say, one, 6).name).toContain("+6 older");
    expect(sessionChoice(say, one, 0).name).not.toContain("older");
  });

  it("shows the size so the primary conversation is obvious", () => {
    const big = record({ sessionId: "s", name: "project-notes", sizeBytes: 48 * 1024 ** 2 });
    expect(sessionChoice(say, big).name).toContain("48 MB");
  });

  it("keeps a label within the Discord 100 character limit", () => {
    const long = record({ sessionId: "s", name: "x".repeat(300), sizeBytes: 1024 ** 3 });
    expect(sessionChoice(say, long).name.length).toBeLessThanOrEqual(100);
  });

  it("lists sizes so an oversized transcript is visible", () => {
    const output = formatSessionList(say, [record({ sessionId: "s", name: "Big", sizeBytes: 923_000_000 })]);
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

  // Only automatic compactions are ever reported to it, and a session moved to a model with a smaller window compacts sooner from then on.
  it("follows the latest automatic compaction, down as well as up", () => {
    const tracker = new ContextTracker();
    tracker.learnCeiling(951_650);
    tracker.learnCeiling(158_784);
    expect(tracker.knownCeiling()).toBe(158_784);
    tracker.learnCeiling(0);
    expect(tracker.knownCeiling()).toBe(158_784);
  });

  it("does not call 558k tokens 279 percent full on a one-million window", () => {
    const tracker = new ContextTracker(951_650);
    expect(tracker.observe(usage(558_784))).toBeNull();
  });

  it("warns against the real ceiling rather than a guessed one", () => {
    const tracker = new ContextTracker(951_650);
    const warning = tracker.observe(usage(800_000));
    expect(warning?.level).toBe("approaching");
    expect(warning?.percent).toBe(84);
  });

  it("never reports more than 99 percent", () => {
    const tracker = new ContextTracker(200_000);
    expect(tracker.observe(usage(10_000_000))?.percent).toBe(99);
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
    expect(describePurge(say, { bulkDeleted: 42, slowDeleted: 0, failed: 0 }, true)).toContain("Deleted 42 messages");
  });

  it("says how many needed the slow path", () => {
    const text = describePurge(say, { bulkDeleted: 10, slowDeleted: 3, failed: 0 }, true);
    expect(text).toContain("Deleted 13 messages");
    expect(text).toContain("older than 14 days");
  });

  it("reports failures rather than hiding them", () => {
    expect(describePurge(say, { bulkDeleted: 5, slowDeleted: 0, failed: 2 }, true)).toContain("2 could not be deleted");
  });

  it("says the conversation survives when the channel is one", () => {
    expect(describePurge(say, { bulkDeleted: 1, slowDeleted: 0, failed: 0 }, true)).toContain("conversation itself is untouched");
  });

  it("says nothing about /sync in a channel that is not a conversation", () => {
    const text = describePurge(say, { bulkDeleted: 1, slowDeleted: 0, failed: 0 }, false);
    expect(text).not.toContain("/sync");
    expect(text).not.toContain("conversation");
    expect(text).toContain("Deleted 1 message");
  });

  it("handles an already empty channel", () => {
    expect(describePurge(say, { bulkDeleted: 0, slowDeleted: 0, failed: 0 }, true)).toMatch(/already empty/);
  });

  it("round-trips the confirm and cancel buttons", () => {
    expect(parseCustomId(PURGE_CONFIRM).kind).toBe("purge-confirm");
    expect(parseCustomId(PURGE_CANCEL).kind).toBe("purge-cancel");
  });
});

describe("/clear is not passed through", () => {
  it("points at the bridge's own command instead of starting a session the channel cannot see", () => {
    const result = classifyPrompt("/clear", ["doctor"], []);
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && describeNotRun(say, result)).toContain("own `/clear` command");
    expect(result.kind === "ambiguous" && describeNotRun(say, result)).toContain("/purge");
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

describe("truncate", () => {
  // The limit handed to it is nearly always one Discord enforces, and a result three characters over it is refused.
  it("is never longer than the limit it is given, its ellipsis included", () => {
    for (const length of [99, 100, 101, 150, 5000]) expect(truncate("x".repeat(length), 100).length).toBeLessThanOrEqual(100);
    expect(truncate("x".repeat(101), 100)).toBe(`${"x".repeat(97)}...`);
    expect(truncate("short", 100)).toBe("short");
  });

  it("lets a menu be drawn whose option and placeholder are longer than Discord allows", async () => {
    const sink = channelSink(fakeDiscordChannel("menu-limits").channel);
    const menu = {
      id: "question:0",
      placeholder: "p".repeat(200),
      multiple: false,
      options: [{ value: "0", label: "l".repeat(150), description: "d".repeat(150) }],
    };
    const handle = await sink.askWithMenus!("Pick one", [menu], []);
    await handle.close("Picked.");
  });
});

describe("turn queue", () => {
  it("runs the first message immediately", () => {
    expect(new TurnQueue().admit("s1").kind).toBe("run-now");
  });

  // A dropped message stays in the lane until the turn ahead of it has ended, which can take a while after a stop.
  it("does not count messages it has already dropped", async () => {
    const queue = new TurnQueue();
    const running = Promise.withResolvers<void>();
    const turns = [queue.enqueue("s1", () => running.promise)];
    for (let queued = 0; queued < MAX_QUEUE_DEPTH - 1; queued += 1) turns.push(queue.enqueue("s1", async () => undefined));
    await wait(1);
    expect(queue.admit("s1")).toEqual({ kind: "full" });

    expect(queue.drain("s1")).toBe(MAX_QUEUE_DEPTH - 1);
    expect(queue.depth("s1")).toBe(1);
    expect(queue.total()).toBe(1);
    expect(queue.admit("s1")).toEqual({ kind: "queued", ahead: 1 });

    running.resolve();
    expect(await Promise.all(turns)).toEqual([true, false, false, false, false]);
    expect(queue.depth("s1")).toBe(0);
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
    expect(outcome.kind === "full" && describeFull(say)).toContain("/stop");
    // The lane counts the running turn, so the refusal must not call all five of them queued.
    expect(outcome.kind === "full" && describeFull(say)).toContain("one running");
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
    expect(describeQueued(say, 1)).toContain("still running");
    expect(describeQueued(say, 3)).toContain("3 messages");
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

  // A file that only has to wait is not one that is too large, and saying so would be untrue.
  it("caps how many go in one message, and leaves the rest for the next without calling them too large", async () => {
    for (let i = 0; i < MAX_FILES_PER_MESSAGE + 3; i++) await writeOutbox(`f${i}.txt`, "x");
    const first = await collectOutbox(cwd, "s1");
    expect(first.files).toHaveLength(MAX_FILES_PER_MESSAGE);
    expect(first.skipped).toEqual([]);
    expect(first.deferred).toBe(3);

    await first.discard();
    const second = await collectOutbox(cwd, "s1");
    expect(second.files).toHaveLength(3);
    expect(second.deferred).toBe(0);
  });

  it("caps what one message weighs in all, keeping the files in the order they are named in", async () => {
    const each = MAX_FILE_BYTES - 1;
    const fit = Math.floor(MAX_MESSAGE_BYTES / each);
    for (let i = 0; i <= fit; i++) await writeOutbox(`part${i}.bin`, Buffer.alloc(each));
    await writeOutbox("z-small.txt", "x");

    const result = await collectOutbox(cwd, "s1");
    expect(result.files.map((file) => file.name)).toEqual(Array.from({ length: fit }, (_, index) => `part${index}.bin`));
    expect(result.deferred).toBe(2);
    expect(result.skipped).toEqual([]);
  });

  it("says where a skipped file still is", () => {
    expect(describeSkipped(say, ["huge.bin"], "s1")).toContain(".discord-outbox");
    expect(describeSkipped(say, [], "s1")).toBe("");
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
    expect(addressesSomeoneElse(addressing({ mentionsBot: true, repliedAuthorId: "someone-else" }))).toBe(false);
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
    const hidden = defs
      .filter((definition) => definition.default_member_permissions != null)
      .map((definition) => definition.name);
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
    expect(describeStop(say, { stopped: true, dropped: 0 })).toMatch(/^Stopped\./);
    expect(describeStop(say, { stopped: true, dropped: 0 })).not.toContain("dropped");
    expect(describeStop(say, { stopped: true, dropped: 1 })).toContain("The message queued behind it was dropped");
    expect(describeStop(say, { stopped: true, dropped: 3 })).toContain("3 messages queued behind it were dropped");
    expect(describeStop(say, { stopped: false, dropped: 0 })).toBe("Nothing is running here.");
  });

  // Plain /stop ends only the turn in flight; dropping the queue takes /stop all:true, and the refusal says which is which.
  it("points the full-queue refusal at what each stop really does", async () => {
    const queue = new TurnQueue();
    const running = Array.from({ length: MAX_QUEUE_DEPTH }, () => queue.enqueue("s1", () => wait(5)));
    const outcome = queue.admit("s1");
    expect(outcome.kind === "full" && describeFull(say)).toContain("`/stop all:true` to drop the queue");
    expect(outcome.kind === "full" && describeFull(say)).toContain("`/stop` to end the one in flight");
    await Promise.all(running);
  });

  it("describes the lane for /queue", () => {
    expect(describeDepth(say, 0)).toBe("Nothing is running here.");
    expect(describeDepth(say, 1)).toContain("nothing queued");
    expect(describeDepth(say, 2)).toContain("1 message queued");
    expect(describeDepth(say, 4)).toContain("3 messages queued");
  });
});

describe("a repeated status reads as one line", () => {
  it("does not grow the trail when the same status arrives again", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.noteOnce("Compacting the conversation, which can take a while.");
    status.noteOnce("Compacting the conversation, which can take a while.");
    status.noteOnce("Compacting the conversation, which can take a while.");
    await status.settle();
    expect(sink.written.at(-1)!.split("Compacting").length - 1).toBe(1);
  });

  it("still records the status again once something else has been said", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
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
    expect(describeHidden(say, 0)).toBe("");
    expect(describeHidden(say, 1)).toContain("1 conversation in the temp folder is left out");
    expect(describeHidden(say, 3)).toContain("3 conversations in the temp folder are left out");
    expect(describeHidden(say, 3)).toContain("filter");
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
    const text = describePlanUsage(say, usage.latest(), new Date("2026-09-22T18:05:00Z"));
    expect(text).toContain("5-hour window 17% used, resets <t:1790109600:R>");
    expect(text).toContain("week, all models 4% used");
    expect(text).toContain("as of <t:");
  });

  // The figure last seen for a window belongs to the one before, once its reset has passed.
  it("shows a window past its reset as reset, not as the share last seen for it", () => {
    const usage = new PlanUsage();
    usage.record(event, new Date("2026-09-22T18:00:00Z"));
    const text = describePlanUsage(say, usage.latest(), new Date(1790109600 * 1000 + 60_000));
    expect(text).toContain("5-hour window reset <t:1790109600:R>, with no figure reported since");
    expect(text).not.toContain("17%");
    expect(text).toContain("week, all models 4% used");
  });

  it("says so before any turn has reported", () => {
    expect(describePlanUsage(say, new PlanUsage().latest(), new Date())).toContain("not reported yet");
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

  // Claude Code lays a folder's settings over the account's, so the account's file alone can name a model no turn there runs with.
  it("lays the folder's own settings over the account's, the local file last", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "host-defaults-"));
    const account = path.join(folder, "account.json");
    await fs.writeFile(account, JSON.stringify({ model: "opus", effortLevel: "high" }));
    expect(await readHostDefaults(folder, account)).toEqual({ model: "opus", effort: "high" });

    await fs.mkdir(path.join(folder, ".claude"));
    await fs.writeFile(path.join(folder, ".claude", "settings.json"), JSON.stringify({ model: "sonnet" }));
    expect(await readHostDefaults(folder, account)).toEqual({ model: "sonnet", effort: "high" });

    await fs.writeFile(
      path.join(folder, ".claude", "settings.local.json"),
      JSON.stringify({ model: "haiku", effortLevel: "low" }),
    );
    expect(await readHostDefaults(folder, account)).toEqual({ model: "haiku", effort: "low" });
  });

  it("treats a missing key as no host default, not as an error", () => {
    expect(parseHostDefaults("{}")).toEqual({ model: null, effort: null });
    expect(parseHostDefaults("not json")).toEqual({ model: null, effort: null });
  });

  it("says where a value comes from, so 'session default' never has to be asked about", () => {
    expect(describeDefault(say, "low", "high")).toBe("`low`");
    expect(describeDefault(say, undefined, "high")).toBe("`high` (host default)");
    expect(describeDefault(say, undefined, null)).toBe("Claude Code's default");
  });
});

describe("skills across several menus", () => {
  const names = (count: number) => Array.from({ length: count }, (_, index) => `skill-${String(index).padStart(3, "0")}`);

  it("splits sixty-three skills across three sorted menus and leaves none out", () => {
    const menus = skillSelectMenus(say, ["zeta", ...names(62)]);
    expect(menus.pages.map((page) => page.length)).toEqual([25, 25, 13]);
    expect(menus.pages[0]![0]!.label).toBe("skill-000");
    expect(menus.pages[2]!.at(-1)!.label).toBe("zeta");
    expect(menus.omitted).toBe(0);
  });

  it("stops at the five menus a message can hold and counts the rest", () => {
    const menus = skillSelectMenus(say, names(130));
    expect(menus.pages).toHaveLength(DISCORD_MENUS_PER_MESSAGE);
    expect(menus.omitted).toBe(5);
  });

  it("labels each menu by the range it covers", () => {
    const menus = skillSelectMenus(say, names(30));
    expect(menuPlaceholder(say, menus.pages[0]!)).toBe("skill-000 to skill-024");
    expect(menuPlaceholder(say, menus.pages[1]!)).toBe("skill-025 to skill-029");
    expect(menuPlaceholder(say, [{ label: "only", value: "only", description: "" }])).toBe("only");
  });

  it("tells the reader how many there are, and how to reach the ones that did not fit", () => {
    expect(describeSkillMenus(say, 63, skillSelectMenus(say, names(63)))).toBe(
      "63 skills available in this conversation, A to Z across 3 menus.",
    );
    expect(describeSkillMenus(say, 130, skillSelectMenus(say, names(130)))).toContain("The last 5 did not fit; send `/name`");
    expect(describeSkillMenus(say, 1, skillSelectMenus(say, ["one"]))).toBe("1 skill available in this conversation.");
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
    const file = await transcriptWith([{ type: "system", compactMetadata: { trigger: "manual", preTokens: 42_012 } }]);
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
    const text = describeRequest(say, "Write", { file_path: path.join(os.homedir(), "Documents", "notes.txt") });
    expect(text).toContain("~/Documents/notes.txt");
    expect(text).not.toContain("\\");
  });

  it("still hides the home folder inside a command", () => {
    const text = describeRequest(say, "Bash", { command: `cat ${path.join(os.homedir(), "x.txt")}` });
    expect(text).not.toContain(path.basename(os.homedir()));
  });
});

describe("an approval belongs to the turn that asked", () => {
  const OWNER = "owner-1";

  it("ending one conversation's turn leaves another conversation's prompt waiting", async () => {
    const prompts = new ApprovalPrompts();
    let otherId = "";
    const remember = askingSink((actions) => {
      otherId = actionId(actions, "approve");
    });
    const other = prompts.ask(say, "turn-b", remember, [OWNER], "Bash", { command: "ls" });
    await new Promise((resolve) => setTimeout(resolve, 5));

    prompts.finish("turn-a");
    expect(prompts.decide(say, otherId, OWNER, "approve")).toBe("Approved once.");
    expect(await other).toEqual({ allow: true });
  });

  it("still denies its own turn's pending prompt when that turn ends", async () => {
    const prompts = new ApprovalPrompts();
    const own = prompts.ask(
      say,
      "turn-a",
      askingSink(() => undefined),
      [OWNER],
      "Bash",
      { command: "ls" },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    prompts.finish("turn-a");
    expect((await own).allow).toBe(false);
  });
});

describe("redactHome matches the home folder, not words that happen to share its letters", () => {
  it("hides a path under the home folder", () => {
    expect(redactHome(`see ${path.join(os.homedir(), "code", "thing")}`)).toMatch(/see ~[\\/]code[\\/]thing/);
  });

  // A longer name is some other account at most, so it may lose its name but never becomes this home.
  it("never mistakes a longer name that merely starts with the home path for the home itself", () => {
    const longer = `${os.homedir()}ger`;
    expect(redactHome(longer)).not.toContain("~");
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

  it("finds a titled conversation by the slug of its title", () => {
    const titled = record({ sessionId: "t", name: "Deploy Scripts" });
    expect(resolveByChannelName([titled], "deploy-scripts").match?.sessionId).toBe("t");
  });

  // Binding hands the channel that conversation's folder and history, and every later message there becomes a turn in it.
  it("does not bind a channel whose name is only the start of a conversation's name", () => {
    const ledger = { ...record({ sessionId: "l", name: "x", cwd: "/srv/general-ledger" }), name: null };
    for (const channel of ["general", "gen", "general-"])
      expect(resolveByChannelName([ledger], channel).match, channel).toBeNull();
    expect(resolveByChannelName([ledger], "general-ledger").match?.sessionId).toBe("l");
  });
});

describe("what a turn was handed is kept for it", () => {
  const folder = async (turnId: string, ageMinutes: number): Promise<string> => {
    const dir = path.join(attachmentsRoot(), turnId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "att_0.pdf"), "x");
    const then = new Date(Date.now() - ageMinutes * 60_000);
    await fs.utimes(dir, then, then);
    return dir;
  };
  const exists = (dir: string) =>
    fs.stat(dir).then(
      () => true,
      () => false,
    );

  // A turn can wait in a queue and then run for longer than the hour its files are kept.
  it("leaves alone the files of a turn still waiting or running, however old, and counts the hour from its end", async () => {
    const waiting = await folder(randomUUID(), 90);
    const finished = await folder(randomUUID(), 90);
    const justEnded = await folder(randomUUID(), 90);
    await keepAttachmentsAwhile(path.basename(justEnded));

    await sweepAttachments(Date.now(), new Set([path.basename(waiting)]));
    expect(await Promise.all([waiting, finished, justEnded].map(exists))).toEqual([true, false, true]);
  });

  // Anyone can make an entry under a shared temp folder, and a link there passes for a directory of whoever owns what it points at.
  it.skipIf(process.platform === "win32")(
    "refuses a root that is a link, which a stat that follows links takes for a directory of its own",
    async () => {
      const shared = await fs.mkdtemp(path.join(os.tmpdir(), "shared-tmp-"));
      const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), "elsewhere-"));
      const before = process.env.TMPDIR;
      process.env.TMPDIR = shared;
      try {
        await fs.symlink(elsewhere, attachmentsRoot());
        const remote = [{ url: "http://127.0.0.1:1/nothing", name: "shot.png", contentType: "image/png", size: 10 }];
        await expect(downloadAttachments(remote, randomUUID())).rejects.toThrow("is a link or belongs to another user");
      } finally {
        process.env.TMPDIR = before;
      }
    },
  );
});

describe("the listing of what is live on the host", () => {
  // Whatever answered, it was not the listing, and nothing can be read out of it about what is running.
  it("is not had from output that is no listing, which is not the same as a listing of nothing", () => {
    const one = JSON.stringify([{ pid: 4321, sessionId: "s1", cwd: "/srv/app", kind: "interactive" }]);
    expect(readListing(one)).toHaveLength(1);
    expect(readListing("[]")).toEqual([]);
    for (const output of [
      "",
      "requires an interactive terminal",
      `A newer version is available.\n${one}`,
      `{"sessions":${one}}`,
    ]) {
      expect(readListing(output), output).toBeNull();
    }
  });
});

describe("the gate's own clock", () => {
  // Claude Code stops waiting for a hook after ten minutes unless told otherwise, which is as long as a question waits.
  it("gives a hook longer than the bridge waits for an answer, so the bridge's reason is the one that arrives", () => {
    const hooks = gate({ approve: async () => ({ allow: true }) });
    expect(hooks.PreToolUse![0]!.timeout! * 1000).toBeGreaterThan(QUESTION_TIMEOUT_MS + 60_000);
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
    expect(describeUnfetched(say, failed)).toContain("`shot.png`");
    expect(describeUnfetched(say, [])).toBeNull();
  });
});

describe("outbox delivery", () => {
  it("names a file it cannot attach once, not on every sweep", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-once-"));
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "huge.bin"), Buffer.alloc(MAX_FILE_BYTES + 1));
    const delivery = new OutboxDelivery();
    const sink = recordingSink();

    await delivery.deliver(say, cwd, "s1", sink);
    await delivery.deliver(say, cwd, "s1", sink);
    await delivery.deliver(say, cwd, "s1", sink);
    expect(sink.written.filter((line) => line.includes("huge.bin"))).toHaveLength(1);
  });

  it("names it again if it goes away and comes back", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-again-"));
    const big = path.join(outboxPath(cwd, "s1"), "huge.bin");
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(big, Buffer.alloc(MAX_FILE_BYTES + 1));
    const delivery = new OutboxDelivery();
    const sink = recordingSink();

    await delivery.deliver(say, cwd, "s1", sink);
    await fs.rm(big);
    await delivery.deliver(say, cwd, "s1", sink);
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(big, Buffer.alloc(MAX_FILE_BYTES + 1));
    await delivery.deliver(say, cwd, "s1", sink);
    expect(sink.written.filter((line) => line.includes("huge.bin"))).toHaveLength(2);
  });

  // Files left for a later sweep are lost to the channel if the conversation is cleared or unbound before it comes.
  it("sends what one message cannot hold in the next, in the same delivery", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-many-"));
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    const names = Array.from({ length: MAX_FILES_PER_MESSAGE + 2 }, (_, index) => `chart${String(index).padStart(2, "0")}.png`);
    for (const name of names) await fs.writeFile(path.join(outboxPath(cwd, "s1"), name), "x");
    const sink = recordingSink();

    expect(await new OutboxDelivery().deliver(say, cwd, "s1", sink)).toBe(names.length);
    expect(sink.files).toEqual(names);
    expect(sink.messages).toEqual([`${MAX_FILES_PER_MESSAGE} files`, "2 files"]);
    await expect(fs.stat(path.join(cwd, OUTBOX_DIR))).rejects.toThrow();
  });

  // Something else holding a file open keeps it from being removed once it is sent, on Windows for as long as it is held.
  it("sends a file it cannot remove once, and still sends every file beside it", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-held-"));
    const folder = outboxPath(cwd, "s1");
    await fs.mkdir(folder, { recursive: true });
    const names = Array.from({ length: MAX_FILES_PER_MESSAGE + 5 }, (_, index) => `chart${String(index).padStart(2, "0")}.png`);
    for (const name of names) await fs.writeFile(path.join(folder, name), "x");
    const held = path.join(folder, "chart02.png");
    const remove = fs.rm;
    const refusing = vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (String(target) === held) throw Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
      await remove(target, options);
    });

    try {
      const delivery = new OutboxDelivery();
      const sink = recordingSink();
      expect(await delivery.deliver(say, cwd, "s1", sink)).toBe(names.length);
      expect(sink.files).toEqual(names);
      expect(await fs.readdir(folder)).toEqual(["chart02.png"]);

      expect(await delivery.deliver(say, cwd, "s1", sink)).toBe(0);
      expect(sink.files).toEqual(names);

      await fs.writeFile(held, "written again, and longer");
      expect(await delivery.deliver(say, cwd, "s1", sink)).toBe(1);
      expect(sink.files.at(-1)).toBe("chart02.png");
    } finally {
      refusing.mockRestore();
    }
  });

  it("never sends one file twice when a sweep and the turn's delivery overlap", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-race-"));
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "report.md"), "done");
    const delivery = new OutboxDelivery();
    const sink = recordingSink();

    await Promise.all([delivery.deliver(say, cwd, "s1", sink), delivery.deliver(say, cwd, "s1", sink)]);
    expect(sink.files).toEqual(["report.md"]);
  });

  it("delivers for the caller queued behind one whose send failed, and keeps that file for it", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-failed-"));
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "report.md"), "done");
    const delivery = new OutboxDelivery();
    const refusing = {
      ...recordingSink(),
      sendFiles: async () => {
        throw new Error("the channel refused the upload");
      },
    };
    const sink = recordingSink();

    const failed = delivery.deliver(say, cwd, "s1", refusing);
    const behind = delivery.deliver(say, cwd, "s1", sink);
    await expect(failed).rejects.toThrow("refused the upload");
    expect(await behind).toBe(1);
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
    await delivery.deliver(say, cwd, "public", sink);
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
    expect(bridgeSystemNote("11111111-2222-4333-8444-555555555555")).toContain(
      ".discord-outbox/11111111-2222-4333-8444-555555555555/",
    );
  });
});

describe("unbind offers to delete the channel", () => {
  it("round-trips both answers", () => {
    expect(parseCustomId(UNBIND_DELETE)).toEqual({ kind: "unbind-delete" });
    expect(parseCustomId(UNBIND_KEEP)).toEqual({ kind: "unbind-keep" });
  });
});

describe("clear asks before starting over", () => {
  it("round-trips both answers", () => {
    expect(parseCustomId(clearConfirmId("s1"))).toEqual({ kind: "clear-confirm", sessionId: "s1" });
    expect(parseCustomId(CLEAR_CANCEL)).toEqual({ kind: "clear-cancel" });
  });

  it("names what is kept and what is lost, and how to get the old one back", () => {
    const text = describeClear(say, "/srv/work/ledger");
    expect(text).toContain("none of what was said in this one");
    expect(text).toContain("/resume");
    expect(text).toContain("/purge");
  });
});
