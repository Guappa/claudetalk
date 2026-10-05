import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAsk } from "../src/discord/commands/ask.ts";
import { handleClear } from "../src/discord/commands/clear.ts";
import { handleFork, handleResume } from "../src/discord/commands/conversations.ts";
import { handleRestart, handleTakeover, handleUnbind } from "../src/discord/commands/control.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { announcement, askerFor } from "../src/discord/restart.ts";
import { UpdateNotice, describeUpdate } from "../src/discord/updateNotice.ts";
import { UpdateCheck, type UpdateNews } from "../src/updateCheck.ts";
import { canRunCommand } from "../src/access.ts";
import { isProcessAlive, lockPathBeside } from "../src/instanceLock.ts";
import { takeStopRequest } from "../src/stopSignal.ts";
import { sayIn } from "../src/i18n/index.ts";
import { handlePurgeCommand } from "../src/discord/commands/purge.ts";
import { handleSetting, suggestModels } from "../src/discord/commands/settings.ts";
import { handleTrail } from "../src/discord/commands/trail.ts";
import { TrailChoice } from "../src/discord/trailChoice.ts";
import { handleInvite, handleUninvite } from "../src/discord/commands/membership.ts";
import { handleSync } from "../src/discord/commands/sync.ts";
import { handleButton } from "../src/discord/handlers/components.ts";
import { handleInteraction } from "../src/discord/handlers/interaction.ts";
import { handleMessage } from "../src/discord/handlers/message.ts";
import { onServerJoined, startUp } from "../src/discord/startup.ts";
import { inviteUrl } from "../src/discord/invite.ts";
import { PermissionsBitField } from "discord.js";
import {
  SEND_WAIT,
  UNBIND_DELETE,
  UNBIND_KEEP,
  createResumeId,
  sendAnywayActionId,
  sendNowActionId,
} from "../src/discord/menus.ts";
import type { SessionRecord } from "../src/sessions/index.ts";
import { GUILD, OPERATOR, OWNER, STRANGER, testBridge } from "./helpers/bridge.ts";
import { fakeChannel, fakeCommand, fakeGuild, fakeMessage, fakePress } from "./helpers/discord.ts";
import { record } from "./helpers/records.ts";
import { quietSink } from "./helpers/sinks.ts";

interface Asked {
  sessionId: string;
  prompt: string;
  resume: boolean;
  fork?: boolean;
  name?: string;
  settings: Record<string, string | undefined>;
}

// Every turn a test caused to start, as the runner was asked for it.
const asked = vi.hoisted(() => [] as Asked[]);
// A turn whose prompt starts with "hold" runs until the test lets it go.
const held = vi.hoisted(() => new Map<string, () => void>());

// Every message sweeps the attachments folder of the machine the suite runs on, which another test file fills with folders made to look old, and a running bridge with real ones.
vi.mock("../src/attachments.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/attachments.ts")>()),
  sweepAttachments: async () => 0,
}));

// A real turn spawns Claude Code; these tests are about what a command or a message does around one.
vi.mock("../src/claude/runner.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/claude/runner.ts")>();
  return {
    ...actual,
    runTurn: (request: Asked) => {
      asked.push({ ...request, settings: { ...request.settings } });
      return {
        stop: () => held.get(request.prompt)?.(),
        stopTasks: async () => undefined,
        handOver: () => null,
        interrupt: async () => false,
        done: new Promise((resolve) => {
          const minted = request.fork ? `fork-of-${request.sessionId}` : undefined;
          const finish = (): void => resolve({ ok: true, text: `echo ${request.prompt}`, sessionId: minted });
          if (request.prompt.startsWith("hold")) held.set(request.prompt, finish);
          else setTimeout(finish, 5);
        }),
      };
    },
  };
});

beforeEach(() => {
  asked.length = 0;
  held.clear();
});

const SESSION = "11111111-1111-4111-8111-111111111111";

describe("a message in a channel that holds no conversation", () => {
  it("binds nothing when the tag carried only a file that was refused, so the next tag starts fresh", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("m1");
    const upload = fakeMessage(place, {
      authorId: OWNER,
      content: "",
      mentionsBot: true,
      uploads: [{ name: "setup.exe", size: 10 }],
    });
    await handleMessage(bridge, upload.message);

    expect(upload.replies.join("\n")).toContain("Not saved for this turn");
    expect(asked).toEqual([]);
    expect(bridge.store.byChannel("m1")).toBeUndefined();

    await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "hello", mentionsBot: true }).message);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.resume).toBe(false);
    expect(asked[0]!.sessionId).toBe(bridge.store.byChannel("m1")?.sessionId);
  });

  // The sink decides where the trail may write from the channel's latest post; a prompt is one, or the answer would be edited into a message above it.
  it("counts a prompt as the channel's latest post, so nothing of the turn is written above it", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("m9");
    const first = fakeMessage(place, { authorId: OWNER, content: "start here", mentionsBot: true });
    const posted: string[] = [];
    const remember = bridge.latestPosts.set.bind(bridge.latestPosts);
    bridge.latestPosts.set = (channelId, messageId) => {
      posted.push(messageId);
      return remember(channelId, messageId);
    };
    await handleMessage(bridge, first.message);
    expect(posted[0]).toBe(first.message.id);
    expect(posted.length).toBeGreaterThan(1);
  });

  // The category files new channels and means nothing else, so a channel outside it is found by its name like any other.
  it("binds to the conversation the channel is named after, whatever category the channel sits in", async () => {
    const known = record({ sessionId: SESSION, name: "ledger notes", cwd: os.tmpdir(), lastActivity: new Date() });
    const bridge = await testBridge([known], { categoryId: "400000000000000001" });
    const place = fakeChannel("m3", "ledger-notes");
    await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "where were we?", mentionsBot: true }).message);

    expect(bridge.store.byChannel("m3")?.sessionId).toBe(SESSION);
    expect(asked.map((turn) => [turn.sessionId, turn.resume])).toEqual([[SESSION, true]]);
  });

  // Claude Code holds no session until a first turn gets far enough to create one, and a turn can end before that.
  it("starts the session on a later message when the first turn never created it, and resumes once it exists", async () => {
    const records: SessionRecord[] = [];
    const bridge = await testBridge(records);
    const place = fakeChannel("m4");
    const tag = (content: string) =>
      handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content, mentionsBot: true }).message);

    await tag("first");
    await tag("second");
    const sessionId = bridge.store.byChannel("m4")!.sessionId;
    expect(asked.map((turn) => [turn.sessionId, turn.resume, turn.name])).toEqual([
      [sessionId, false, "general"],
      [sessionId, false, "general"],
    ]);

    records.push(record({ sessionId, name: "general", cwd: bridge.config.projectsRoot, lastActivity: new Date() }));
    await tag("third");
    expect(asked[2]!.resume).toBe(true);
    expect(bridge.store.byChannel("m4")?.unstarted).toBeUndefined();
  });

  it("resumes a conversation that was bound to a session the host already had, transcript in sight or not", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("m5");
    await bridge.store.bindNew({ sessionId: SESSION, cwd: bridge.config.projectsRoot, channelId: "m5", ownerId: OWNER });
    await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "still there?" }).message);

    expect(asked.map((turn) => turn.resume)).toEqual([true]);
  });

  describe("a conversation the bridge started from a tag", () => {
    const tagged = async (channelId: string, name: string) => {
      const records: SessionRecord[] = [];
      const bridge = await testBridge(records, { categoryId: "400000000000000001" });
      const place = fakeChannel(channelId, name);
      await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "hello", mentionsBot: true }).message);
      const sessionId = bridge.store.byChannel(channelId)!.sessionId;
      records.push(record({ sessionId, name, cwd: bridge.config.projectsRoot, lastActivity: new Date() }));
      return { bridge, place, sessionId };
    };

    // The session is titled after the channel, so the channel's name finds it again; the channel is still a shared one.
    it("goes on answering tags only when it is found again by the channel's name after an unbind", async () => {
      const { bridge, place, sessionId } = await tagged("g1", "general");
      await handleUnbind(bridge, fakeCommand(place, OWNER).interaction);
      await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "back again", mentionsBot: true }).message);

      expect(bridge.store.byChannel("g1")).toMatchObject({ sessionId, mentionOnly: true });
      await handleMessage(bridge, fakeMessage(place, { authorId: OPERATOR, content: "lunch at noon?" }).message);
      expect(asked.map((turn) => turn.prompt.includes("lunch"))).toEqual([false, false]);

      const again = fakeCommand(place, OWNER);
      await handleUnbind(bridge, again.interaction);
      expect(again.controls()).toEqual([]);
    });

    it("is not what another channel finds by the start of its name", async () => {
      const { bridge } = await tagged("g2", "dev-ops");
      const other = fakeChannel("g3", "dev");
      await handleMessage(bridge, fakeMessage(other, { authorId: OWNER, content: "hello", mentionsBot: true }).message);

      expect(other.posted.join("\n")).not.toContain("already open");
      expect(bridge.store.byChannel("g3")).toMatchObject({ mentionOnly: true, unstarted: true });
      expect(bridge.store.byChannel("g3")?.sessionId).not.toBe(bridge.store.byChannel("g2")?.sessionId);
    });
  });

  it("stays silent for someone who may not use the bridge", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("m2");
    await handleMessage(bridge, fakeMessage(place, { authorId: STRANGER, content: "hello", mentionsBot: true }).message);

    expect(asked).toEqual([]);
    expect(place.posted).toEqual([]);
    expect(bridge.store.byChannel("m2")).toBeUndefined();
  });
});

describe("a command typed as a message", () => {
  const explained = "applies to one process";

  it("is explained when it was typed to the bot", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("t1");
    await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "/model opus", mentionsBot: true }).message);

    expect(place.posted.join("\n")).toContain(explained);
    expect(asked).toEqual([]);
    expect(bridge.store.byChannel("t1")).toBeUndefined();
  });

  it("gets no answer in a channel the bot is not part of", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("t2");
    await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "/model opus" }).message);

    expect(place.posted).toEqual([]);
  });

  it("gets no answer when it was a reply to another person in a conversation's channel", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("t3");
    await bridge.store.bindNew({ sessionId: SESSION, cwd: bridge.config.projectsRoot, channelId: "t3", ownerId: OWNER });
    const theirs = fakeMessage(place, { authorId: STRANGER, content: "which model is this on?" }).message;
    await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "/model opus", repliedTo: theirs }).message);

    expect(place.posted).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("is refused by the name it stands for, so /reset cannot start a session the channel never sees", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("t4");
    await bridge.store.bindNew({ sessionId: SESSION, cwd: bridge.config.projectsRoot, channelId: "t4", ownerId: OWNER });
    await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "/reset" }).message);

    expect(place.posted.join("\n")).toContain("Use this bot's own `/clear` command");
    expect(asked).toEqual([]);
  });
});

describe("/ask", () => {
  const bound = async (channelId: string) => {
    const bridge = await testBridge();
    await bridge.store.bindNew({ sessionId: SESSION, cwd: bridge.config.projectsRoot, channelId, ownerId: OWNER });
    return bridge;
  };

  // With no context in front of it, the prompt is the first thing Claude Code reads.
  it("holds a command in the prompt to what a typed one is held to", async () => {
    const bridge = await bound("a1");
    const command = fakeCommand(fakeChannel("a1"), OWNER, { prompt: "/review ultra" });
    await handleAsk(bridge, command.interaction);

    expect(command.replies.at(-1)).toContain("`/code-review ultra` was not run");
    expect(asked).toEqual([]);
  });

  it("passes on a command that a typed message would pass on", async () => {
    const bridge = await bound("a2");
    await handleAsk(bridge, fakeCommand(fakeChannel("a2"), OWNER, { prompt: "/compact" }).interaction);

    expect(asked.map((turn) => turn.prompt)).toEqual(["/compact"]);
  });

  it("says how many messages it took as context, not how many it looked at", async () => {
    const bridge = await bound("a3");
    const place = fakeChannel("a3");
    const written = fakeMessage(place, { authorId: STRANGER, content: "the build is red again" }).message;
    const uploadOnly = fakeMessage(place, { authorId: STRANGER, content: "" }).message;
    place.earlier.push(uploadOnly, written, uploadOnly);

    const some = fakeCommand(place, OWNER, { prompt: "what is wrong?", context: 3 });
    await handleAsk(bridge, some.interaction);
    expect(some.replies).toEqual(["Asking with the last 1 message as context."]);

    place.earlier.length = 0;
    place.earlier.push(uploadOnly);
    const none = fakeCommand(place, OWNER, { prompt: "and now?", context: 1 });
    await handleAsk(bridge, none.interaction);
    expect(none.replies).toEqual(["Asking with no extra context."]);
  });
});

describe("a message that is for the bot", () => {
  // Reading the index takes a moment, and a second tag can arrive inside it.
  it("ends up in one conversation when two tags overlap in a channel that held none", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("o1");
    const first = fakeMessage(place, { authorId: OWNER, content: "one", mentionsBot: true });
    const second = fakeMessage(place, { authorId: OWNER, content: "two!", mentionsBot: true });
    await Promise.all([handleMessage(bridge, first.message), handleMessage(bridge, second.message)]);

    expect(bridge.store.all()).toHaveLength(1);
    expect(new Set(asked.map((turn) => turn.sessionId))).toEqual(new Set([bridge.store.byChannel("o1")?.sessionId]));
  });

  it("makes the folder a tagged conversation runs in, which nothing else has made", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspaces-"));
    const bridge = await testBridge([], { workspacesRoot: root });
    await handleMessage(
      bridge,
      fakeMessage(fakeChannel("o2"), { authorId: OPERATOR, content: "hello", mentionsBot: true }).message,
    );

    const cwd = bridge.store.byChannel("o2")!.cwd;
    expect(cwd.startsWith(root)).toBe(true);
    expect((await fs.stat(cwd)).isDirectory()).toBe(true);
  });

  it("does not take what Discord wrote in a person's name for something that person asked", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("o3");
    await bridge.store.bindNew({ sessionId: SESSION, cwd: os.tmpdir(), channelId: "o3", ownerId: OWNER });
    await handleMessage(
      bridge,
      fakeMessage(place, { authorId: OWNER, content: "started a thread: ideas", system: true }).message,
    );
    expect(asked).toEqual([]);
  });

  // Claude Code reads a command only as the first thing in a prompt.
  it("passes a command on with nothing in front of it, tagged or not", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("o4");
    await bridge.store.bindNew({ sessionId: SESSION, cwd: os.tmpdir(), channelId: "o4", ownerId: OWNER });
    await handleMessage(
      bridge,
      fakeMessage(place, { authorId: OWNER, content: "/compact keep the plan", mentionsBot: true }).message,
    );
    await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "and now carry on", mentionsBot: true }).message);

    expect(asked[0]!.prompt).toBe("/compact keep the plan");
    expect(asked[1]!.prompt).toContain("is speaking to you in Discord");
  });

  it("binds nothing for a tag that was only a refused file, in a channel named after a conversation too", async () => {
    const bridge = await testBridge([
      record({ sessionId: SESSION, name: "deploy scripts", cwd: os.tmpdir(), lastActivity: new Date() }),
    ]);
    const place = fakeChannel("o5", "deploy-scripts");
    const upload = fakeMessage(place, {
      authorId: OWNER,
      content: "",
      mentionsBot: true,
      uploads: [{ name: "setup.exe", size: 10 }],
    });
    await handleMessage(bridge, upload.message);

    expect(upload.replies.join("\n")).toContain("Not saved for this turn");
    expect(bridge.store.byChannel("o5")).toBeUndefined();
    expect(place.posted.join("\n")).not.toContain("Bound to");
  });
});

describe("the interaction door", () => {
  const press = (userId: string, customId: string) => {
    const said: Array<{ content: string; hidden: boolean }> = [];
    const answer = async (payload: { content: string; flags?: number }) =>
      void said.push({ content: payload.content, hidden: payload.flags === 64 });
    const interaction = {
      guildId: GUILD,
      channelId: "d1",
      customId,
      user: { id: userId, bot: false },
      deferred: false,
      replied: false,
      isRepliable: () => true,
      isAutocomplete: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      isButton: () => customId !== "",
      isChatInputCommand: () => customId === "",
      commandName: "operator",
      reply: answer,
      followUp: answer,
    };
    return { interaction: interaction as never, said };
  };

  it("turns a stranger away before anything is handled, and says so to them alone", async () => {
    const bridge = await testBridge();
    const stranger = press(STRANGER, "turn:stop:whatever");
    await handleInteraction(bridge, stranger.interaction);
    expect(stranger.said).toEqual([{ content: expect.stringContaining("do not have access"), hidden: true }]);
  });

  it("refuses an owner's command to an operator, where only the operator sees it", async () => {
    const bridge = await testBridge();
    const operator = press(OPERATOR, "");
    await handleInteraction(bridge, operator.interaction);
    expect(operator.said).toEqual([{ content: expect.stringContaining("`/operator`"), hidden: true }]);
  });

  // A press is not a command, so nothing reports for it unless the door does.
  it("tells whoever pressed when the handler behind a control fails", async () => {
    const bridge = await testBridge();
    bridge.flow.stopTurn = () => {
      throw new Error("the lane could not be read");
    };
    const owner = press(OWNER, `turn:stop:${SESSION}`);
    Object.assign(owner.interaction, { deferReply: async () => Object.assign(owner.interaction, { deferred: true }) });
    await handleInteraction(bridge, owner.interaction);
    expect(owner.said.at(-1)).toEqual({
      content: expect.stringContaining("That press failed: the lane could not be read"),
      hidden: true,
    });
  });
});

describe("starting up", () => {
  const LINK = "https://discord.example/invite";
  const client = (register: () => Promise<void>, fetch: (id: string) => Promise<unknown>, servers: string[] = [GUILD]) =>
    ({
      application: { commands: { set: register } },
      channels: { fetch },
      guilds: { cache: new Map(servers.map((id) => [id, {}])) },
      generateInvite: () => LINK,
      user: { tag: "bridge#0001" },
    }) as never;

  // Registering commands is the first thing done, and the likeliest to fail: a bot invited without the scope for them.
  it("still marks interrupted turns, forgets deleted channels and watches the outboxes when commands cannot be registered", async () => {
    const bridge = await testBridge();
    await bridge.store.bindNew({ sessionId: SESSION, cwd: os.tmpdir(), channelId: "gone", ownerId: OWNER });
    await bridge.store.bindNew({ sessionId: "still-here", cwd: os.tmpdir(), channelId: "kept", ownerId: OWNER });
    const leftovers = vi.spyOn(bridge.activeTurns, "takeLeftovers");
    const refused = async (): Promise<void> => {
      throw Object.assign(new Error("Missing Access"), { code: 50001 });
    };
    const fetch = async (id: string): Promise<unknown> => {
      if (id === "gone") throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
      if (id === "kept") throw new Error("the gateway timed out");
      return { id };
    };

    const watching = await startUp(bridge, client(refused, fetch));
    clearInterval(watching);

    expect(leftovers).toHaveBeenCalledOnce();
    expect(bridge.store.bySession(SESSION)).toBeUndefined();
    expect(bridge.store.bySession("still-here")).toBeDefined();
  });

  // A first start comes before the invite, and the permissions the bot needs are a list nobody should have to tick by hand.
  it("prints the link that adds the bot while it is in no server, and registers the commands once it joins", async () => {
    const bridge = await testBridge();
    const said = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const register = vi.fn(async (): Promise<void> => undefined);
    const outside = client(register, async (id) => ({ id }), []);

    clearInterval(await startUp(bridge, outside));
    expect(register).not.toHaveBeenCalled();
    expect(said.mock.calls.flat().join("\n")).toContain(`not in server ${GUILD} yet`);
    expect(said.mock.calls.flat().join("\n")).toContain(LINK);

    await onServerJoined(bridge, outside, "some-other-server");
    expect(register).not.toHaveBeenCalled();
    await onServerJoined(bridge, outside, GUILD);
    expect(register).toHaveBeenCalledOnce();
    said.mockRestore();
  });

  // The README tells a reader what each permission is for, so it has to name every one the link asks for.
  it("asks for both scopes, and for no permission the README does not explain", async () => {
    const asked: Array<{ scopes: string[]; permissions: bigint[]; guild: string; disableGuildSelect: boolean }> = [];
    const generateInvite = (options: (typeof asked)[number]): string => {
      asked.push(options);
      return LINK;
    };
    const recording = { generateInvite } as never;
    expect(inviteUrl(recording, GUILD)).toBe(LINK);
    expect(asked[0]).toMatchObject({ scopes: ["bot", "applications.commands"], guild: GUILD, disableGuildSelect: true });

    const spaced = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    const readme = (await fs.readFile(path.join(import.meta.dirname, "..", "README.md"), "utf8"))
      .replace(/\s+/g, " ")
      .toLowerCase();
    const permissions = new PermissionsBitField(asked[0]!.permissions).toArray();
    expect(permissions).toHaveLength(10);
    for (const permission of permissions) expect(readme, permission).toContain(spaced(permission));
  });
});

describe("/invite and /uninvite", () => {
  const friend = { id: STRANGER, username: "second", bot: false };

  it("make the conversation's own channel visible to the person, and take that away again", async () => {
    const bridge = await testBridge([]);
    const place = fakeChannel("i1");
    await bridge.store.bindNew({ sessionId: SESSION, cwd: os.tmpdir(), channelId: "i1", ownerId: OWNER });
    const server = fakeGuild().guild;

    const invite = fakeCommand(place, OWNER, { user: friend }, server);
    await handleInvite(bridge, invite.interaction);
    expect(invite.replies.at(-1)).toContain("second can now see this conversation");
    expect(place.permissions.at(-1)).toContain(STRANGER);
    expect(bridge.store.bySession(SESSION)?.memberIds).toEqual([STRANGER]);

    const uninvite = fakeCommand(place, OWNER, { user: friend }, server);
    await handleUninvite(bridge, uninvite.interaction);
    expect(uninvite.replies.at(-1)).toContain("second removed");
    expect(place.permissions.at(-1)).not.toContain(STRANGER);
    expect(bridge.store.bySession(SESSION)?.memberIds).toEqual([]);
  });

  // The new permissions deny everyone else the channel, which in a channel the server shared hides it from all of them.
  it("change nothing in a channel that was there before the conversation", async () => {
    const bridge = await testBridge([]);
    const tagged = fakeChannel("i2");
    const named = fakeChannel("i3");
    await bridge.store.bindNew({ sessionId: SESSION, cwd: os.tmpdir(), channelId: "i2", ownerId: OWNER, mentionOnly: true });
    await bridge.store.bindNew({
      sessionId: "adopted-by-name",
      cwd: os.tmpdir(),
      channelId: "i3",
      ownerId: OWNER,
      adopted: true,
    });
    const server = fakeGuild().guild;

    for (const place of [tagged, named]) {
      for (const handle of [handleInvite, handleUninvite]) {
        const command = fakeCommand(place, OWNER, { user: friend }, server);
        await handle(bridge, command.interaction);
        expect(command.replies.at(-1)).toContain("Nothing was changed");
      }
      expect(place.permissions).toEqual([]);
    }
    expect(bridge.store.bySession(SESSION)?.memberIds).toEqual([]);
  });
});

describe("/sync", () => {
  const entry = (record: Record<string, unknown>): string => `${JSON.stringify(record)}\n`;
  const said = (minute: number, text: string): string =>
    entry({ type: "user", timestamp: `2026-09-13T10:${String(minute).padStart(2, "0")}:00.000Z`, message: { content: text } });

  const terminal = async (lines: string[]): Promise<{ folder: string; transcriptPath: string }> => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "sync-owed-"));
    const transcriptPath = path.join(folder, "session.jsonl");
    await fs.writeFile(transcriptPath, lines.join(""));
    return { folder, transcriptPath };
  };

  // The turn that announces what was missed marks the conversation seen when it ends, and the notice says to run /sync.
  it("still shows what a turn announced as missed, after that turn has run", async () => {
    const { folder, transcriptPath } = await terminal([said(5, "typed in the terminal"), said(6, "and one more")]);
    const lastActivity = new Date("2026-09-13T10:06:00.000Z");
    const bridge = await testBridge([record({ sessionId: SESSION, cwd: folder, transcriptPath, lastActivity })]);
    await bridge.store.bindNew({ sessionId: SESSION, cwd: folder, channelId: "y2", ownerId: OWNER });
    await bridge.store.markSynced(SESSION, "2026-09-13T10:00:00.000Z");
    const place = fakeChannel("y2");

    await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "back at the desk" }).message);
    expect(asked.map((turn) => turn.prompt.includes("back at the desk"))).toEqual([true]);
    expect(bridge.store.byChannel("y2")?.syncedThrough).toBe("2026-09-13T10:06:00.000Z");

    const command = fakeCommand(place, OWNER);
    await handleSync(bridge, command.interaction);
    expect(command.replies.at(-1)).toContain("typed in the terminal");
    expect(command.replies.at(-1)).toContain("and one more");

    const again = fakeCommand(place, OWNER);
    await handleSync(bridge, again.interaction);
    expect(again.replies.at(-1)).not.toContain("typed in the terminal");
  });

  // A terminal can write to the transcript between the moment it is read and the moment the reply is posted.
  it("marks as seen what it showed, not whatever the transcript holds by the time it has answered", async () => {
    const { folder, transcriptPath } = await terminal([said(5, "typed in the terminal")]);
    const bridge = await testBridge([record({ sessionId: SESSION, cwd: folder, transcriptPath, lastActivity: new Date() })]);
    await bridge.store.bindNew({ sessionId: SESSION, cwd: folder, channelId: "y3", ownerId: OWNER });
    await bridge.store.markSynced(SESSION, "2026-09-13T10:00:00.000Z");
    const find = bridge.sessions.find.bind(bridge.sessions);
    let looked = 0;
    bridge.sessions.find = async (sessionId) => {
      looked += 1;
      if (looked === 2) await fs.appendFile(transcriptPath, said(11, "written meanwhile"));
      return await find(sessionId);
    };
    const command = fakeCommand(fakeChannel("y3"), OWNER);
    await handleSync(bridge, command.interaction);
    await fs.appendFile(transcriptPath, said(12, "and after"));

    expect(command.replies.at(-1)).toContain("typed in the terminal");
    expect(bridge.store.byChannel("y3")?.syncedThrough).toBe("2026-09-13T10:05:00.000Z");
  });

  // The header grows when the count is only partial, and what is shown beneath it has to give way.
  it("fits in one message when it also has to say the count is only the most recent", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "sync-long-"));
    const transcriptPath = path.join(folder, "session.jsonl");
    const bulk = entry({
      type: "assistant",
      timestamp: "2026-09-13T10:05:00.000Z",
      message: { content: [{ type: "tool_use", name: "x".repeat(1_700_000) }] },
    });
    const recent = Array.from({ length: 3 }, (_, index) => said(10 + index, `${index + 1}: ${"word ".repeat(178)}`)).join("");
    await fs.writeFile(transcriptPath, said(1, "long ago") + bulk + bulk + recent);

    const bridge = await testBridge([record({ sessionId: SESSION, cwd: folder, transcriptPath, lastActivity: new Date() })]);
    const bound = await bridge.store.bindNew({ sessionId: SESSION, cwd: folder, channelId: "y1", ownerId: OWNER });
    await bridge.store.markSynced(bound.sessionId, "2026-09-13T10:00:00.000Z");
    const command = fakeCommand(fakeChannel("y1"), OWNER);
    await handleSync(bridge, command.interaction);

    const reply = command.replies.at(-1)!;
    expect(reply).toContain("That counts only the most recent");
    expect(reply.length).toBeLessThanOrEqual(2000);
    expect(bridge.store.byChannel("y1")?.syncedThrough).toBe("2026-09-13T10:12:00.000Z");
  });
});

describe("/model", () => {
  it("applies to a turn that was already queued when it was set, as its reply says", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("s1");
    await bridge.store.bindNew({ sessionId: SESSION, cwd: bridge.config.projectsRoot, channelId: "s1", ownerId: OWNER });
    const first = handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "hold the first" }).message);
    await vi.waitFor(() => expect(held.has("hold the first")).toBe(true));
    const second = handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "the one behind it" }).message);
    await vi.waitFor(() => expect(bridge.flow.queueDepth(SESSION)).toBe(2));

    const command = fakeCommand(place, OWNER, { value: "haiku" });
    await handleSetting(bridge, command.interaction, "model");
    expect(command.replies.at(-1)).toContain("applies from the next turn onward");

    held.get("hold the first")?.();
    await Promise.all([first, second]);
    expect(asked.map((turn) => turn.settings.model)).toEqual([undefined, "haiku"]);
  });

  const suggested = async (bridge: Awaited<ReturnType<typeof testBridge>>, typed: string) => {
    const shown: Array<{ name: string; value: string }> = [];
    const respond = async (choices: typeof shown): Promise<void> => void shown.push(...choices);
    await suggestModels(bridge, { options: { getFocused: () => typed }, respond } as never);
    return shown;
  };

  // The list is Claude Code's own, and a suggestion has no time to wait for it, so the aliases stand in until it has answered.
  it("suggests the way back to the host first, then the aliases until Claude Code has answered, then the models it offers", async () => {
    const bridge = await testBridge();
    expect((await suggested(bridge, "")).map((choice) => choice.value)).toEqual(["default", "fable", "opus", "sonnet", "haiku"]);

    await bridge.models.refresh();
    expect(await suggested(bridge, "")).toEqual([
      { name: "default · clear the override and follow the host", value: "default" },
      { name: "Opus 9 · For complex work", value: "opus" },
      { name: "Sonnet 9 · For routine work", value: "claude-sonnet-9" },
    ]);
    expect((await suggested(bridge, "SONNET")).map((choice) => choice.value)).toEqual(["claude-sonnet-9"]);
  });

  // Setting nothing is how a conversation follows the host, and without this the first choice of a model would be for good.
  it("clears the conversation's own model or effort on default, and says what turns run with instead", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("s3");
    await bridge.store.bindNew({
      sessionId: SESSION,
      cwd: bridge.config.projectsRoot,
      channelId: "s3",
      ownerId: OWNER,
      settings: { model: "opus", effort: "high" },
    });
    for (const key of ["model", "effort"] as const) {
      const command = fakeCommand(place, OWNER, { value: "default" });
      await handleSetting(bridge, command.interaction, key);
      expect(command.replies.at(-1)).toContain("is cleared for this conversation");
      expect(bridge.store.bySession(SESSION)?.settings[key]).toBeUndefined();
    }
  });

  // Whatever is typed past the suggestions arrives as it stands, and a name Claude Code does not know fails every turn after it.
  it("takes a model Claude Code offers or an alias, and refuses any other name without changing the setting", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("s2");
    await bridge.store.bindNew({ sessionId: SESSION, cwd: bridge.config.projectsRoot, channelId: "s2", ownerId: OWNER });
    await bridge.models.refresh();
    const set = async (value: string) => {
      const command = fakeCommand(place, OWNER, { value });
      await handleSetting(bridge, command.interaction, "model");
      return command.replies.at(-1);
    };

    expect(await set("claude-sonnet-9")).toContain("set to `claude-sonnet-9`");
    expect(await set("fable")).toContain("set to `fable`");
    const refused = await set("sonet");
    expect(refused).toContain("`sonet` is not a model Claude Code offers");
    expect(refused).toContain("`opus`, `claude-sonnet-9`");
    expect(bridge.store.bySession(SESSION)?.settings.model).toBe("fable");
  });
});

describe("/trail", () => {
  const asked = async (
    bridge: Awaited<ReturnType<typeof testBridge>>,
    place: ReturnType<typeof fakeChannel>,
    userId: string,
    options: Record<string, string | boolean>,
  ) => {
    const command = fakeCommand(place, userId, options);
    await handleTrail(bridge, command.interaction);
    return command.replies.at(-1) ?? "";
  };
  const hiddenIn = (bridge: Awaited<ReturnType<typeof testBridge>>, sessionId: string) => [
    ...bridge.trail.hiddenIn(bridge.store.bySession(sessionId)?.trailHidden),
  ];

  // The default saves saying it in every channel; a conversation's own choice is for the one where more, or less, is wanted.
  it("follows the bridge's default until a conversation chooses for itself, and goes back to it on a reset", async () => {
    const bridge = await testBridge();
    const [here, there] = [fakeChannel("t1"), fakeChannel("t2")];
    await bridge.store.bindNew({ sessionId: SESSION, cwd: bridge.config.projectsRoot, channelId: "t1", ownerId: OWNER });
    await bridge.store.bindNew({ sessionId: "elsewhere", cwd: bridge.config.projectsRoot, channelId: "t2", ownerId: OWNER });

    expect(await asked(bridge, here, OWNER, {})).toContain("follows the bridge's default");
    expect(await asked(bridge, here, OWNER, { hide: "commands", everywhere: true })).toContain("Hidden: commands");
    expect(hiddenIn(bridge, SESSION)).toEqual(["commands"]);
    expect(hiddenIn(bridge, "elsewhere")).toEqual(["commands"]);

    const own = await asked(bridge, here, OWNER, { hide: "all", show: "agents" });
    expect(own).toContain("its own choice");
    expect(own).toContain("Drawn: agents and skills\n");
    expect(hiddenIn(bridge, SESSION)).toEqual(["edits", "commands", "reads", "web", "todos", "other"]);
    expect(hiddenIn(bridge, "elsewhere")).toEqual(["commands"]);

    expect(await asked(bridge, there, OWNER, { show: "commands", everywhere: true })).toContain("Hidden: nothing");
    expect(hiddenIn(bridge, SESSION)).toHaveLength(6);

    expect(await asked(bridge, here, OWNER, { reset: true })).toContain("follows the bridge's default");
    expect(hiddenIn(bridge, SESSION)).toEqual([]);
  });

  it("keeps the default across a restart, and leaves it to an owner to change", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("t3");
    await bridge.store.bindNew({ sessionId: SESSION, cwd: bridge.config.projectsRoot, channelId: "t3", ownerId: OPERATOR });

    const refused = await asked(bridge, place, OPERATOR, { hide: "edits", everywhere: true });
    expect(refused).toContain("Only an owner can change the default");
    expect(hiddenIn(bridge, SESSION)).toEqual([]);
    expect(await asked(bridge, place, OPERATOR, { everywhere: true })).toContain("Hidden: nothing");
    expect(await asked(bridge, place, OPERATOR, { hide: "edits" })).toContain("Hidden: edits and written files");

    await asked(bridge, place, OWNER, { hide: "web", everywhere: true });
    const restarted = new TrailChoice(path.join(bridge.config.dataDir, "trail.json"));
    await restarted.load();
    expect([...restarted.hiddenIn(undefined)]).toEqual(["web"]);
    expect([...restarted.hiddenIn(["commands", "a kind from another build"])]).toEqual(["commands"]);
  });
});

describe("/clear", () => {
  const cleared = async (channelId: string) => {
    const bridge = await testBridge();
    const place = fakeChannel(channelId);
    const bound = await bridge.store.bindNew({
      sessionId: SESSION,
      cwd: bridge.config.projectsRoot,
      channelId,
      ownerId: OWNER,
      settings: { model: "haiku" },
    });
    await bridge.store.setMembers(SESSION, [OPERATOR]);
    const command = fakeCommand(place, OWNER);
    await handleClear(bridge, command.interaction);
    return { bridge, place, bound, startOver: command.controls()[0]! };
  };

  it("starts the channel over once, with what it had, however often Start over is pressed", async () => {
    const { bridge, place, bound, startOver } = await cleared("k1");
    const first = fakePress(place, OWNER, startOver);
    const second = fakePress(place, OWNER, startOver);
    await Promise.all([handleButton(bridge, first.interaction), handleButton(bridge, second.interaction)]);

    const fresh = bridge.store.byChannel("k1")!;
    expect(fresh.sessionId).not.toBe(SESSION);
    expect(fresh).toMatchObject({ cwd: bound.cwd, ownerId: OWNER, memberIds: [OPERATOR], settings: { model: "haiku" } });
    expect(bridge.store.bySession(SESSION)).toBeUndefined();
    expect(asked.map((turn) => [turn.sessionId, turn.resume])).toEqual([[fresh.sessionId, false]]);
    // The second press is told beside the menu, and the first press's answer stays on it.
    expect(second.whispers.join()).toContain("nothing was started over");
    expect([...first.replies, ...second.replies].at(-1)).toContain("Started over.");
  });

  // A message can have read the channel's conversation and still be waiting on a lookup when the channel is started over.
  it("turns back a message that was on its way to the conversation the channel held before", async () => {
    const { bridge, place, bound } = await cleared("k3");
    const lookup = Promise.withResolvers<null>();
    const find = bridge.sessions.find.bind(bridge.sessions);
    bridge.sessions.find = async () => lookup.promise;
    const onItsWay = handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "one more thing" }).message);
    await new Promise((resolve) => setTimeout(resolve, 5));

    bridge.sessions.find = find;
    await bridge.store.startOver(bound, "22222222-2222-4222-8222-222222222222");
    lookup.resolve(null);
    await onItsWay;

    expect(asked).toEqual([]);
    expect(place.posted.join("\n")).toContain("started over or unbound while your message was on its way");
  });

  it("leaves the conversation alone when a turn started there after the question was put", async () => {
    const { bridge, place, bound, startOver } = await cleared("k2");
    const running = bridge.flow.run(SESSION, bound.cwd, "hold on to it", {}, quietSink(), { resume: true });
    await vi.waitFor(() => expect(held.has("hold on to it")).toBe(true));

    const press = fakePress(place, OWNER, startOver);
    await handleButton(bridge, press.interaction);
    expect(press.replies.at(-1)).toContain("A turn is running here");
    expect(bridge.store.byChannel("k2")).toBe(bound);

    held.get("hold on to it")?.();
    await running;
  });
});

describe("/resume", () => {
  it("leaves one channel when the same conversation is opened from two places at once", async () => {
    const known = record({ sessionId: SESSION, name: "ledger notes", cwd: os.tmpdir(), lastActivity: new Date() });
    const bridge = await testBridge([known]);
    const server = fakeGuild();
    const one = fakeCommand(fakeChannel("r1"), OWNER, { name: SESSION }, server.guild);
    const two = fakeCommand(fakeChannel("r2"), OPERATOR, { name: SESSION }, server.guild);
    await Promise.all([handleResume(bridge, one.interaction), handleResume(bridge, two.interaction)]);

    const standing = server.made.filter((channel) => !channel.wasDeleted()).map((channel) => channel.channel.id);
    expect(server.made).toHaveLength(2);
    expect(standing).toEqual([bridge.store.bySession(SESSION)?.channels.text]);
    const answers = [one, two].map((command) => command.replies.at(-1) ?? "");
    expect(answers.filter((answer) => answer.includes("is already open"))).toHaveLength(1);
    expect(answers.filter((answer) => answer.startsWith("Opened"))).toHaveLength(1);
  });

  // A session resumed from another folder leaves a transcript under each, and the picker hands back only its id.
  it("opens the copy written to last when the conversation picked has a transcript under two folders", async () => {
    const moved = await fs.mkdtemp(path.join(os.tmpdir(), "moved-"));
    const earlier = record({
      sessionId: SESSION,
      name: "ledger notes",
      cwd: os.tmpdir(),
      lastActivity: new Date("2026-09-01T10:00:00Z"),
    });
    const later = record({
      sessionId: SESSION,
      name: "ledger notes",
      cwd: moved,
      lastActivity: new Date("2026-09-20T10:00:00Z"),
    });
    const bridge = await testBridge([earlier, later]);
    const command = fakeCommand(fakeChannel("r4"), OWNER, { name: SESSION }, fakeGuild().guild);
    await handleResume(bridge, command.interaction);

    expect(bridge.store.bySession(SESSION)?.cwd).toBe(moved);
  });

  // Discord's own error for a fifty-first channel reads as a permissions problem.
  it("says the category is full before it tries to make a channel in it", async () => {
    const known = record({ sessionId: SESSION, name: "ledger notes", cwd: os.tmpdir(), lastActivity: new Date() });
    const bridge = await testBridge([known], { categoryId: "cat-1" });
    const server = fakeGuild();
    server.standing.set("cat-1", { id: "cat-1", name: "Projects", parentId: null });
    for (let held = 0; held < 50; held += 1)
      server.standing.set(`c${held}`, { id: `c${held}`, name: `c${held}`, parentId: "cat-1" });
    const command = fakeCommand(fakeChannel("r5"), OWNER, { name: SESSION }, server.guild);
    await handleResume(bridge, command.interaction);

    expect(command.replies.at(-1)).toContain("Projects");
    expect(command.replies.at(-1)).toContain("50");
    expect(server.made).toEqual([]);
  });

  it("names a few of the conversations a short name could mean, once each, and counts the rest", async () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      record({
        sessionId: `s${index}`,
        name: `ledger ${String(index).padStart(2, "0")}`,
        cwd: os.tmpdir(),
        lastActivity: new Date(2026, 0, index + 1),
      }),
    );
    const copy = record({ sessionId: "copy", name: "ledger 13", cwd: os.tmpdir(), lastActivity: new Date(2025, 0, 1) });
    const bridge = await testBridge([...many, copy]);
    const command = fakeCommand(fakeChannel("r6"), OWNER, { name: "ledger" }, fakeGuild().guild);
    await handleResume(bridge, command.interaction);

    const reply = command.replies.at(-1)!;
    expect(reply).toContain("ledger 13, ledger 12");
    expect(reply.split("ledger 13")).toHaveLength(2);
    expect(reply).toContain("and 4 more");
  });

  it("does not act on a Resume button once the question it belongs to has expired", async () => {
    const known = record({ sessionId: SESSION, name: "ledger notes", cwd: os.tmpdir(), lastActivity: new Date() });
    const bridge = await testBridge([known]);
    const server = fakeGuild();
    const press = fakePress(fakeChannel("r3"), OWNER, createResumeId(SESSION), server.guild);
    await handleButton(bridge, press.interaction);

    expect(press.replies.at(-1)).toContain("too old to act on");
    expect(server.made).toEqual([]);
    expect(bridge.store.bySession(SESSION)).toBeUndefined();
  });
});

describe("/fork", () => {
  const sourced = async (channelId: string, whileMaking?: (records: SessionRecord[]) => void) => {
    const records = [record({ sessionId: SESSION, name: "ledger notes", cwd: os.tmpdir(), lastActivity: new Date() })];
    const bridge = await testBridge(records);
    await bridge.store.bindNew({ sessionId: SESSION, cwd: os.tmpdir(), channelId, ownerId: OWNER });
    const server = fakeGuild(() => whileMaking?.(records));
    const command = fakeCommand(fakeChannel(channelId), OWNER, {}, server.guild);
    await handleFork(bridge, command.interaction);
    return { bridge, server, command };
  };

  it("binds the branch Claude Code minted to the channel made for it", async () => {
    const { bridge, server, command } = await sourced("f1");

    expect(asked.map((turn) => [turn.sessionId, turn.fork])).toEqual([[SESSION, true]]);
    expect(bridge.store.byChannel(server.made[0]!.channel.id)?.sessionId).toBe(`fork-of-${SESSION}`);
    expect(bridge.store.byChannel("f1")?.sessionId).toBe(SESSION);
    expect(command.replies.at(-1)).toContain("Branched **ledger notes**");
  });

  // The branch's first turn is asked of the source conversation, and what that one missed is for its own channel to hear of.
  it("leaves what the source conversation missed for the source's own channel", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "fork-drift-"));
    const transcriptPath = path.join(folder, "session.jsonl");
    const typed = { type: "user", timestamp: "2026-09-13T10:05:00.000Z", message: { content: "typed in the terminal" } };
    await fs.writeFile(transcriptPath, `${JSON.stringify(typed)}\n`);
    const bridge = await testBridge([
      record({ sessionId: SESSION, name: "ledger notes", cwd: folder, transcriptPath, lastActivity: new Date() }),
    ]);
    await bridge.store.bindNew({ sessionId: SESSION, cwd: folder, channelId: "f3", ownerId: OWNER });
    await bridge.store.markSynced(SESSION, "2026-09-13T10:00:00.000Z");
    const server = fakeGuild();
    await handleFork(bridge, fakeCommand(fakeChannel("f3"), OWNER, {}, server.guild).interaction);

    expect(server.made[0]!.posted.join("\n")).not.toContain("outside Discord");
    expect(bridge.store.bySession(SESSION)?.syncedThrough).toBe("2026-09-13T10:00:00.000Z");
    expect(bridge.store.bySession(SESSION)?.unseen).toBeUndefined();
  });

  it("says nothing was branched, and removes the channel, when the conversation was taken while the channel was made", async () => {
    const { bridge, server, command } = await sourced("f2", (records) => {
      records[0] = { ...records[0]!, live: { pid: 4321, cwd: os.tmpdir(), kind: "interactive", sessionId: SESSION } };
    });

    expect(asked).toEqual([]);
    expect(server.made[0]!.wasDeleted()).toBe(true);
    expect(bridge.store.byChannel(server.made[0]!.channel.id)).toBeUndefined();
    expect(command.replies.at(-1)).toContain("Nothing was branched");
    expect(command.replies.at(-1)).not.toContain("did not report");
  });
});

describe("/unbind", () => {
  it("says there is nothing to unbind in a channel that holds no conversation, and offers no button", async () => {
    const bridge = await testBridge();
    const command = fakeCommand(fakeChannel("c1"), OPERATOR);
    await handleUnbind(bridge, command.interaction);

    expect(command.replies).toEqual(["This channel isn't bound to a conversation, so there is nothing to unbind."]);
    expect(command.controls()).toEqual([]);
  });

  it("unbinds a conversation's own channel and leaves deleting it to a press", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("c2", "ledger");
    await bridge.store.bindNew({ sessionId: SESSION, cwd: bridge.config.projectsRoot, channelId: "c2", ownerId: OWNER });
    const command = fakeCommand(place, OWNER);
    await handleUnbind(bridge, command.interaction);

    expect(bridge.store.byChannel("c2")).toBeUndefined();
    expect(command.controls()).toEqual([UNBIND_DELETE, UNBIND_KEEP]);
    expect(place.wasDeleted()).toBe(false);

    const press = fakePress(place, OWNER, UNBIND_DELETE);
    await handleButton(bridge, press.interaction);
    expect(place.wasDeleted()).toBe(true);
  });

  it("does not offer to delete a channel that only answered when the bot was tagged", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("c3");
    await bridge.store.bindNew({
      sessionId: SESSION,
      cwd: bridge.config.projectsRoot,
      channelId: "c3",
      ownerId: OWNER,
      mentionOnly: true,
    });
    const command = fakeCommand(place, OWNER);
    await handleUnbind(bridge, command.interaction);

    expect(bridge.store.byChannel("c3")).toBeUndefined();
    expect(command.replies.at(-1)).toContain("stays as it is");
    expect(command.controls()).toEqual([]);
  });

  it("refuses while a turn is running there, since its output would land in a channel called unbound", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("c4");
    const bound = await bridge.store.bindNew({
      sessionId: SESSION,
      cwd: bridge.config.projectsRoot,
      channelId: "c4",
      ownerId: OWNER,
    });
    const running = bridge.flow.run(SESSION, bound.cwd, "hold the lane", {}, quietSink(), { resume: true });
    await vi.waitFor(() => expect(held.has("hold the lane")).toBe(true));

    const command = fakeCommand(place, OWNER);
    await handleUnbind(bridge, command.interaction);
    expect(command.replies).toEqual(["A turn is running here. Let it finish or `/stop` it, then `/unbind`."]);
    expect(bridge.store.byChannel("c4")).toBe(bound);

    // A purge would take the trail, the Stop button and any open prompt with it.
    const purge = fakeCommand(place, OWNER);
    await handlePurgeCommand(bridge, purge.interaction);
    expect(purge.replies).toEqual(["A turn is running here. Let it finish or `/stop` it, then `/purge`."]);
    expect(purge.controls()).toEqual([]);

    held.get("hold the lane")?.();
    await running;
  });

  // The Delete button stays on screen after the moment it was offered in.
  it("does not delete a channel that was bound again before Delete was pressed", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("c5", "ledger");
    await bridge.store.bindNew({ sessionId: SESSION, cwd: bridge.config.projectsRoot, channelId: "c5", ownerId: OWNER });
    await handleUnbind(bridge, fakeCommand(place, OWNER).interaction);
    await bridge.store.bindNew({ sessionId: SESSION, cwd: bridge.config.projectsRoot, channelId: "c5", ownerId: OWNER });

    const press = fakePress(place, OWNER, UNBIND_DELETE);
    await handleButton(bridge, press.interaction);
    expect(place.wasDeleted()).toBe(false);
    expect(press.replies.at(-1)).toContain("bound to a conversation again");
  });
});

describe("Send now", () => {
  const inFlight = { label: "/code-review", startedAt: Date.now() - 185_000 };

  // Interrupting throws away the call in flight, so a skill or an agent minutes in is not cut short by one press.
  it("asks first while a skill or an agent is in flight, and sends only on the second press", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("n1");
    const sent = vi.spyOn(bridge.flow, "sendNow").mockResolvedValue("sent");
    vi.spyOn(bridge.flow, "longCallOf").mockReturnValue(inFlight);

    const first = fakePress(place, OWNER, sendNowActionId(SESSION));
    await handleButton(bridge, first.interaction);
    expect(sent).not.toHaveBeenCalled();
    expect(first.replies.at(-1)).toMatch(/Claude is inside \/code-review, running for 3m \d+s/);
    expect(first.controls()).toEqual([sendAnywayActionId(SESSION), SEND_WAIT]);

    const anyway = fakePress(place, OWNER, sendAnywayActionId(SESSION));
    await handleButton(bridge, anyway.interaction);
    expect(sent).toHaveBeenCalledWith(SESSION);
    expect(anyway.replies.at(-1)).toContain("cut short so it could read your message");
    expect(anyway.controls()).toEqual([]);
  });

  it("leaves the message waiting when asked to wait", async () => {
    const bridge = await testBridge();
    const sent = vi.spyOn(bridge.flow, "sendNow").mockResolvedValue("sent");
    vi.spyOn(bridge.flow, "longCallOf").mockReturnValue(inFlight);
    const wait = fakePress(fakeChannel("n2"), OWNER, SEND_WAIT);
    await handleButton(bridge, wait.interaction);
    expect(sent).not.toHaveBeenCalled();
    expect(wait.replies.at(-1)).toContain("Your message waits");
    expect(wait.controls()).toEqual([]);
  });

  it("sends at once when nothing long is in flight", async () => {
    const bridge = await testBridge();
    const sent = vi.spyOn(bridge.flow, "sendNow").mockResolvedValue("sent");
    vi.spyOn(bridge.flow, "longCallOf").mockReturnValue(undefined);
    const press = fakePress(fakeChannel("n3"), OWNER, sendNowActionId(SESSION));
    await handleButton(bridge, press.interaction);
    expect(sent).toHaveBeenCalledWith(SESSION);
    expect(press.whispers.at(-1)).toContain("cut short so it could read your message");
  });
});

describe("a restart asked for from Discord", () => {
  const say = sayIn("en");

  it("is asked of the bridge once the code is known to start, and remembers who asked and where", async () => {
    const bridge = await testBridge();
    const place = fakeChannel("r1");
    const command = fakeCommand(place, OWNER);
    await handleRestart(bridge, command.interaction);

    expect(command.replies.at(-1)).toBe(say("restart.now"));
    expect(await takeStopRequest(lockPathBeside(bridge.config.bindingsPath))).toEqual({ mode: "restart" });
    expect(await bridge.restartNote.take()).toEqual([{ channelId: "r1", userId: OWNER }]);
    expect(await bridge.restartNote.take()).toEqual([]);
  });

  it("is refused, and nothing is asked of the bridge, when the code would not start", async () => {
    const bridge = await testBridge();
    bridge.checkBoot = async () => ({ ok: false, timedOut: false, output: "SyntaxError: Unexpected token" });
    const broken = fakeCommand(fakeChannel("r2"), OWNER);
    await handleRestart(bridge, broken.interaction);
    expect(broken.replies.at(-1)).toContain("SyntaxError: Unexpected token");
    expect(broken.replies.at(-1)).toContain("keeps running as it is");

    bridge.checkBoot = async () => ({ ok: false, timedOut: true, output: "" });
    const slow = fakeCommand(fakeChannel("r2"), OWNER);
    await handleRestart(bridge, slow.interaction);
    expect(slow.replies.at(-1)).toBe(say("restart.checkTimedOut"));

    expect(await takeStopRequest(lockPathBeside(bridge.config.bindingsPath))).toBeNull();
    expect(await bridge.restartNote.take()).toEqual([]);
  });

  // A bridge started by hand would leave and stay gone.
  it("is refused when nothing would start the bridge again", async () => {
    const bridge = await testBridge();
    bridge.supervised = false;
    const command = fakeCommand(fakeChannel("r3"), OWNER);
    await handleRestart(bridge, command.interaction);
    expect(command.replies.at(-1)).toBe(say("restart.unsupervised"));
    expect(await takeStopRequest(lockPathBeside(bridge.config.bindingsPath))).toBeNull();
  });

  it("is an owner's to ask", () => {
    expect(canRunCommand("owner", "restart")).toBe(true);
    expect(canRunCommand("operator", "restart")).toBe(false);
  });

  it("answers a restart asked from a turn in that turn's channel, as a reply to the message that started it", async () => {
    const bridge = await testBridge();
    const conversation = await bridge.store.bindNew({
      sessionId: "s-restart",
      cwd: os.tmpdir(),
      channelId: "r4",
      ownerId: OWNER,
    });
    expect(askerFor(bridge, conversation.sessionId)).toEqual({ channelId: "r4" });

    await bridge.activeTurns.record(conversation.sessionId, { channelId: "r4", messageId: "trail-1", promptId: "prompt-1" });
    expect(askerFor(bridge, conversation.sessionId)).toEqual({ channelId: "r4", replyTo: "prompt-1" });
    expect(askerFor(bridge, "no-such-session")).toBeNull();
  });

  it("reaches whoever asked: by a reply with the ping on, or by naming them where there is no message to reply to", () => {
    expect(announcement({ channelId: "r5", replyTo: "prompt-1" }, "back")).toEqual({
      content: "back",
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: true },
      reply: { messageReference: "prompt-1", failIfNotExists: false },
    });
    expect(announcement({ channelId: "r5", userId: OWNER }, "back")).toEqual({
      content: `<@${OWNER}> back`,
      allowedMentions: { parse: [], users: [OWNER], roles: [] },
    });
    expect(announcement({ channelId: "r5" }, "back")).toEqual({
      content: "back",
      allowedMentions: { parse: [], users: [], roles: [] },
    });
  });
});

describe("a newer version of the bridge", () => {
  const say = sayIn("en");
  const WEEK = 7 * 24 * 60 * 60 * 1000;

  async function checkThatFound(tags: string[]): Promise<{ updates: UpdateCheck; tags: string[] }> {
    const updates = new UpdateCheck(
      "0.9.0",
      "someone/some-bridge",
      async () => [...tags],
      async () => ["feat: add a thing", "fix: mend a thing"],
    );
    await updates.refresh();
    return { updates, tags };
  }

  async function scratchFile(): Promise<string> {
    return path.join(await fs.mkdtemp(path.join(os.tmpdir(), "update-notice-")), "update.json");
  }

  it("is said to an owner who sends the bridge a message, in that channel, and not said twice", async () => {
    const bridge = await testBridge();
    const { updates } = await checkThatFound(["v0.10.0"]);
    bridge.updateNotice = new UpdateNotice(await scratchFile(), updates);
    const place = fakeChannel("u1");

    await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "hello", mentionsBot: true }).message);
    await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "hello again", mentionsBot: true }).message);

    const said = place.posted.filter((text) => text.includes("of the bridge is out"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("**v0.10.0** of the bridge is out, 1 version past the v0.9.0 running here.");
    expect(said[0]).toContain("- add a thing\n- mend a thing");
    expect(said[0]).toContain("<https://github.com/someone/some-bridge/compare/v0.9.0...v0.10.0>");
  });

  // An operator cannot update the bridge, so there is nothing for one to do about it.
  it("is not said to an operator", async () => {
    const bridge = await testBridge();
    const { updates } = await checkThatFound(["v0.10.0"]);
    bridge.updateNotice = new UpdateNotice(await scratchFile(), updates);
    const place = fakeChannel("u2");
    await bridge.store.bindNew({ sessionId: "s-update", cwd: os.tmpdir(), channelId: "u2", ownerId: OPERATOR });

    await handleMessage(bridge, fakeMessage(place, { authorId: OPERATOR, content: "hello" }).message);

    expect(asked).toHaveLength(1);
    expect(place.posted.join("\n")).not.toContain("of the bridge is out");
  });

  // Versions can come several to a day, and a notice for each would be the noisiest thing the bridge does.
  it("is said at most once a week however many versions come out, and then names the newest", async () => {
    const clock = { now: Date.parse("2026-01-01T00:00:00Z") };
    const { updates, tags } = await checkThatFound(["v0.10.0"]);
    const notice = new UpdateNotice(await scratchFile(), updates, () => clock.now);
    expect(notice.take()?.version).toBe("0.10.0");

    tags.push("v0.11.0", "v0.12.0");
    await updates.refresh();
    clock.now += WEEK - 1000;
    expect(notice.take()).toBeNull();

    clock.now += 1000;
    expect(notice.take()).toMatchObject({ version: "0.12.0", behind: 3 });
    clock.now += 10 * WEEK;
    expect(notice.take()).toBeNull();
  });

  it("stays said across a restart", async () => {
    const file = await scratchFile();
    const { updates } = await checkThatFound(["v0.10.0"]);
    expect(new UpdateNotice(file, updates).take()?.version).toBe("0.10.0");
    await vi.waitFor(async () => expect(JSON.parse(await fs.readFile(file, "utf8")).version).toBe("0.10.0"));

    const afterRestart = new UpdateNotice(file, updates);
    await afterRestart.load();
    expect(afterRestart.take()).toBeNull();
  });

  it("lists a handful of changes and counts the rest", () => {
    const news: UpdateNews = {
      version: "0.12.0",
      current: "0.9.0",
      behind: 3,
      changes: ["one", "two", "three", "four", "five", "six", "seven"],
      url: "https://github.com/someone/some-bridge/compare/v0.9.0...v0.12.0",
    };
    const shown = describeUpdate(say, news).split("\n");
    expect(shown[0]).toBe("**v0.12.0** of the bridge is out, 3 versions past the v0.9.0 running here.");
    expect(shown.slice(1, 7)).toEqual(["- one", "- two", "- three", "- four", "- five", "... and 2 more changes"]);
    expect(shown).toHaveLength(8);

    const bare = describeUpdate(say, { ...news, changes: [] }).split("\n");
    expect(bare).toHaveLength(2);
  });
});

describe("taking a conversation over from a terminal on the host", () => {
  const say = sayIn("en");
  const standIns: ChildProcess[] = [];

  // A real idle process stands in for Claude Code in a terminal, so that closing it is closing something.
  function terminal(): ChildProcess {
    const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], { stdio: "ignore" });
    standIns.push(child);
    return child;
  }

  async function held(channelId: string, status: string | undefined, pid: number) {
    const live = { pid, cwd: os.tmpdir(), kind: "interactive" as const, sessionId: SESSION, status };
    const bridge = await testBridge([{ ...record({ sessionId: SESSION, name: "Deploy Scripts", cwd: os.tmpdir() }), live }]);
    await bridge.store.bindNew({ sessionId: SESSION, cwd: os.tmpdir(), channelId, ownerId: OWNER });
    return bridge;
  }

  const alive = (child: ChildProcess): boolean => child.exitCode === null && child.signalCode === null;

  it("closes Claude Code there when it is idle, and says how to open the conversation there again", async () => {
    const child = terminal();
    const bridge = await held("t1", "idle", child.pid!);
    const command = fakeCommand(fakeChannel("t1"), OWNER);
    await handleTakeover(bridge, command.interaction);

    const closedThere = say("takeover.closedTerminal", { pid: child.pid!, sessionId: SESSION });
    expect(command.replies.at(-1)).toBe(`${closedThere} ${say("takeover.free")}`);
    await vi.waitFor(() => expect(alive(child)).toBe(false));
  }, 15_000);

  // Whoever was refused has already said what they wanted, and should not have to say it twice.
  it("runs the message the terminal kept from running, once the terminal is closed", async () => {
    const child = terminal();
    const bridge = await held("t4", "idle", child.pid!);
    const there = (await bridge.sessions.find(SESSION))!;
    // The listing names the terminal for as long as its process lives, as Claude Code's own does.
    bridge.sessions.find = async () => (isProcessAlive(child.pid!) ? there : { ...there, live: null });
    const place = fakeChannel("t4");

    await handleMessage(bridge, fakeMessage(place, { authorId: OWNER, content: "carry on from the phone" }).message);
    expect(asked).toEqual([]);
    expect(place.posted.join("\n")).toContain("`/takeover`");

    const command = fakeCommand(place, OWNER);
    await handleTakeover(bridge, command.interaction);
    const closedThere = say("takeover.closedTerminal", { pid: child.pid!, sessionId: SESSION });
    expect(command.replies.at(-1)).toBe(`${closedThere} ${say("takeover.heldRuns")}`);
    await vi.waitFor(() => expect(asked.map((turn) => turn.prompt)).toEqual(["carry on from the phone"]));
  }, 15_000);

  it("keeps nothing for a terminal that cannot be taken over", async () => {
    const child = terminal();
    const bridge = await held("t5", "busy", child.pid!);
    await handleMessage(bridge, fakeMessage(fakeChannel("t5"), { authorId: OWNER, content: "are you there?" }).message);

    expect(bridge.heldMessages.take("t5")).toBeNull();
    child.kill();
  });

  it("leaves a terminal alone while a turn is running in it", async () => {
    const child = terminal();
    const bridge = await held("t2", "busy", child.pid!);
    const command = fakeCommand(fakeChannel("t2"), OWNER);
    await handleTakeover(bridge, command.interaction);

    expect(command.replies.at(-1)).toContain("a turn is running there");
    expect(alive(child)).toBe(true);
    child.kill();
  });

  it("leaves a terminal alone when it says nothing of whether it is working", async () => {
    const child = terminal();
    const bridge = await held("t3", undefined, child.pid!);
    const command = fakeCommand(fakeChannel("t3"), OWNER);
    await handleTakeover(bridge, command.interaction);

    expect(command.replies.at(-1)).toContain("Close that terminal");
    expect(alive(child)).toBe(true);
    child.kill();
  });
});
