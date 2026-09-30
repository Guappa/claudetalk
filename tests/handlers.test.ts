import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAsk } from "../src/discord/commands/ask.ts";
import { handleUnbind } from "../src/discord/commands/control.ts";
import { handleButton } from "../src/discord/handlers/components.ts";
import { handleMessage } from "../src/discord/handlers/message.ts";
import { UNBIND_DELETE, UNBIND_KEEP } from "../src/discord/menus.ts";
import { OPERATOR, OWNER, STRANGER, testBridge } from "./helpers/bridge.ts";
import { fakeChannel, fakeCommand, fakeMessage, fakePress } from "./helpers/discord.ts";
import { quietSink } from "./helpers/sinks.ts";

interface Asked {
  sessionId: string;
  prompt: string;
  resume: boolean;
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
          const finish = (): void => resolve({ ok: true, text: `echo ${request.prompt}` });
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
