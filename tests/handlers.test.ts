import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAsk } from "../src/discord/commands/ask.ts";
import { handleClear } from "../src/discord/commands/clear.ts";
import { handleFork, handleResume } from "../src/discord/commands/conversations.ts";
import { handleUnbind } from "../src/discord/commands/control.ts";
import { handleSetting } from "../src/discord/commands/settings.ts";
import { handleButton } from "../src/discord/handlers/components.ts";
import { handleMessage } from "../src/discord/handlers/message.ts";
import { UNBIND_DELETE, UNBIND_KEEP, createResumeId } from "../src/discord/menus.ts";
import type { SessionRecord } from "../src/sessions/index.ts";
import { OPERATOR, OWNER, STRANGER, testBridge } from "./helpers/bridge.ts";
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
