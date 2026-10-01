import { afterEach, describe, it, expect, vi } from "vitest";
import os from "node:os";
import { CapabilityCache } from "../src/claude/capabilities.ts";
import { ContextTracker } from "../src/claude/contextTracker.ts";
import { UsageLedger } from "../src/claude/usageLedger.ts";
import { PlanUsage } from "../src/claude/planUsage.ts";
import { ApprovalPrompts } from "../src/discord/approvals.ts";
import { QuestionPrompts } from "../src/discord/questions.ts";
import { OutboxDelivery } from "../src/discord/outboxDelivery.ts";
import { ActiveTurns } from "../src/discord/activeTurns.ts";
import type { Config } from "../src/config.ts";
import { TurnFlow } from "../src/discord/turnFlow.ts";
import { menuAskingSink, quietSink, recordingSink } from "./helpers/sinks.ts";
import { sayIn, type Language, type Say } from "../src/i18n/index.ts";
import path from "node:path";
import fs from "node:fs/promises";
import { outboxPath } from "../src/outboxFolder.ts";

const started = vi.hoisted(() => [] as string[]);
// Whether each mocked turn was asked to resume its session, keyed by its prompt.
const resumed = vi.hoisted(() => new Map<string, boolean>());
// Events a mocked turn replays before it finishes, keyed by its prompt.
const scripted = vi.hoisted(() => new Map<string, unknown[]>());
// What a mocked turn was asked to do, in order: tasks stopped inside it, and the turn itself stopped.
const asked = vi.hoisted(() => [] as string[]);
// How a test makes a mocked turn report that it took up a message handed to it.
const taken = vi.hoisted(() => new Map<string, (uuid: string) => void>());
// How a mocked turn ends when it does not simply answer, keyed by its prompt.
const endings = vi.hoisted(() => new Map<string, unknown>());
// Questions a mocked turn puts to the person the moment it starts, keyed by its prompt.
const asks = vi.hoisted(() => new Map<string, unknown[]>());
// Prompts whose mocked turn refuses to be interrupted.
const uninterruptible = vi.hoisted(() => new Set<string>());
// Events a mocked turn sends a moment after it starts, keyed by its prompt.
const later = vi.hoisted(() => new Map<string, unknown>());
// Mocked turns that run until the test lets them end or stops them, keyed by prompt: one that ends on a timer races whatever a test does while it runs.
const keptRunning = vi.hoisted(() => new Map<string, Promise<void>>());

function keepRunning(prompt: string): () => void {
  const end = Promise.withResolvers<void>();
  keptRunning.set(prompt, end.promise);
  return end.resolve;
}

afterEach(() => keptRunning.clear());

// A real turn spawns Claude Code; these tests are about what surrounds one, not the turn itself.
vi.mock("../src/claude/runner.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/claude/runner.ts")>();
  return {
    ...actual,
    runTurn: (
      request: { prompt: string; resume: boolean; askQuestions?: (questions: unknown[]) => Promise<unknown> },
      onEvent: (event: unknown) => void,
    ) => {
      started.push(request.prompt);
      resumed.set(request.prompt, request.resume);
      for (const event of scripted.get(request.prompt) ?? []) onEvent(event);
      if (later.has(request.prompt)) setTimeout(() => onEvent(later.get(request.prompt)), 10);
      const questions = asks.get(request.prompt);
      if (questions) void request.askQuestions?.(questions);
      const over = Promise.withResolvers<void>();
      const kept = keptRunning.get(request.prompt);
      if (kept) void kept.then(over.resolve);
      else setTimeout(over.resolve, 20);
      return {
        stop: () => {
          asked.push(`stop ${request.prompt}`);
          if (kept) over.resolve();
        },
        stopTasks: async (taskIds: string[]) => void asked.push(`stopTasks ${taskIds.join(",")}`),
        handOver: (text: string) => {
          asked.push(`handOver ${text}`);
          taken.set(request.prompt, (uuid) => onEvent({ type: "command_lifecycle", command_uuid: uuid, state: "started" }));
          return `uuid-${text}`;
        },
        interrupt: async () => {
          asked.push(`interrupt ${request.prompt}`);
          return !uninterruptible.has(request.prompt);
        },
        done: over.promise.then(() => endings.get(request.prompt) ?? { ok: true, text: `echo ${request.prompt}` }),
      };
    },
  };
});

function makeFlow(language: () => Say = () => sayIn("en"), approvals = new ApprovalPrompts()): TurnFlow {
  const config = { toolApprovals: false, ownerIds: [] } as unknown as Config;
  return new TurnFlow(
    new CapabilityCache(),
    () => new ContextTracker(),
    new UsageLedger(),
    new PlanUsage(),
    approvals,
    new QuestionPrompts(),
    new OutboxDelivery(),
    new ActiveTurns(path.join(os.tmpdir(), `claudetalk-turns-${process.pid}-${Math.random()}.json`)),
    config,
    language,
    1,
  );
}

describe("TurnFlow", () => {
  const cwd = os.tmpdir();

  it("runs the hooks inside the lane, so a queued message sees the turn before it as finished", async () => {
    const flow = makeFlow();
    const order: string[] = [];
    const hooks = (tag: string) => ({
      resume: true,
      beforeTurn: async () => void order.push(`before ${tag}`),
      afterTurn: async () => void order.push(`after ${tag}`),
    });

    const first = flow.run("s1", cwd, "one", {}, quietSink(), hooks("one"));
    const second = flow.run("s1", cwd, "two", {}, quietSink(), hooks("two"));
    expect(await Promise.all([first, second])).toEqual([true, true]);

    expect(order).toEqual(["before one", "after one", "before two", "after two"]);
  });

  // What fails before a turn is a lookup, a store write or a notice; the person sent a message and has to hear why nothing came of it.
  it("tells the person when the check before a turn fails, and does not leave the message reading as queued", async () => {
    const flow = makeFlow();
    const sink = recordingSink();
    const states: string[] = [];
    const ran = await flow.run("s42", cwd, "never checked", {}, sink, {
      resume: true,
      beforeTurn: async () => {
        throw new Error("the index could not be read");
      },
      onState: async (state) => void states.push(state),
    });

    expect(ran).toBe(false);
    expect(started).not.toContain("never checked");
    expect(sink.written.join("\n")).toContain("the check before the turn failed with the index could not be read");
    expect(states).toEqual(["stopped"]);
  });

  // A notice over Discord's limit is refused whole, and a check that fails with a long error would then fail in silence.
  it("says why the check failed at a length a notice can carry", async () => {
    const flow = makeFlow();
    const sink = recordingSink();
    await flow.run("s45", cwd, "checked at length", {}, sink, {
      resume: true,
      beforeTurn: async () => {
        throw new Error(`ENOENT: ${"very ".repeat(1000)}long`);
      },
    });
    const notice = sink.written.find((text) => text.includes("the check before the turn failed"));
    expect(notice).toBeDefined();
    expect(notice!.length).toBeLessThanOrEqual(2000);
  });

  it("runs the after hook even when the turn throws", async () => {
    const flow = makeFlow();
    const order: string[] = [];
    await flow
      .run("s2", cwd, "boom", {}, quietSink(), {
        resume: true,
        beforeTurn: async () => {
          throw new Error("preflight blew up");
        },
        afterTurn: async () => void order.push("after"),
      })
      .catch(() => undefined);
    expect(order).toEqual(["after"]);
  });

  it("stopping drops what is queued and says so", async () => {
    const flow = makeFlow();
    const order: string[] = [];
    const hooks = (tag: string) => ({ resume: true, beforeTurn: async () => void order.push(`before ${tag}`) });

    keepRunning("one");
    const first = flow.run("s3", cwd, "one", {}, quietSink(), hooks("one"));
    const second = flow.run("s3", cwd, "two", {}, quietSink(), hooks("two"));
    const third = flow.run("s3", cwd, "three", {}, quietSink(), hooks("three"));
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(flow.queueDepth("s3")).toBe(3);
    expect(flow.stop("s3")).toEqual({ stopped: true, dropped: 2 });
    expect(await Promise.all([first, second, third])).toEqual([true, false, false]);
    expect(order).toEqual(["before one"]);
    expect(flow.queueDepth("s3")).toBe(0);
  });

  it("reports nothing to stop when nothing is running", () => {
    expect(makeFlow().stop("s4")).toEqual({ stopped: false, dropped: 0 });
  });

  // A correction queued behind a wrong turn is exactly what should run once that turn is stopped.
  it("stopping only the turn in flight lets what is queued behind it run", async () => {
    const flow = makeFlow();
    const order: string[] = [];
    const hooks = (tag: string) => ({ resume: true, beforeTurn: async () => void order.push(tag) });
    const states: string[] = [];
    keepRunning("wrong");
    const first = flow.run("s8", cwd, "wrong", {}, quietSink(), {
      ...hooks("wrong"),
      onState: async (state) => void states.push(state),
    });
    const second = flow.run("s8", cwd, "correction", {}, quietSink(), hooks("correction"));
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(flow.stopTurn("s8")).toEqual({ stopped: true, queued: 1 });
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(order).toEqual(["wrong", "correction"]);
    expect(states[0]).toBe("running");
    expect(flow.stopTurn("s9")).toEqual({ stopped: false, queued: 0 });
  });

  // A shutdown waits for what was accepted, queued messages included, and admits nothing new meanwhile.
  it("drains: finishes the running and queued turns, refuses new ones, then reports empty", async () => {
    const flow = makeFlow();
    const letEnd = keepRunning("one");
    const first = flow.run("s5", cwd, "one", {}, quietSink(), { resume: true });
    const second = flow.run("s5", cwd, "two", {}, quietSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(flow.activeCount()).toBe(2);

    const seen: number[] = [];
    const drained = flow.drain((turns) => seen.push(turns));
    const refused = recordingSink();
    expect(await flow.run("s6", cwd, "three", {}, refused, { resume: true })).toBe(false);
    expect(refused.written[0]).toContain("shutting down");

    letEnd();
    await drained;
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(seen[0]).toBe(2);
    expect(flow.activeCount()).toBe(0);
  });

  // An agent's edit is not the session's and its report is not a remark, so neither belongs in the trail.
  it("keeps an agent out of the trail altogether, and shows it as an entry in the side room's roster", async () => {
    scripted.set("fan out", [
      {
        type: "system",
        subtype: "task_started",
        task_id: "t1",
        tool_use_id: "use1",
        description: "Write the fixture",
        subagent_type: "general-purpose",
        task_type: "local_agent",
      },
      {
        type: "assistant",
        parent_tool_use_id: "use1",
        message: {
          content: [{ type: "tool_use", name: "Write", input: { file_path: "/srv/app/fixture.txt", content: "alpha" } }],
        },
      },
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Waiting on the agent." }] } },
      { type: "assistant", parent_tool_use_id: "use1", message: { content: [{ type: "text", text: "Wrote the fixture." }] } },
      {
        type: "system",
        subtype: "task_notification",
        task_id: "t1",
        status: "completed",
        summary: "Wrote the fixture.",
        usage: { total_tokens: 1, tool_uses: 1, duration_ms: 2000 },
      },
    ]);
    const flow = makeFlow();
    const sink = recordingSink();
    expect(await flow.run("s10", cwd, "fan out", {}, sink, { resume: true })).toBe(true);

    const trail = sink.messages.join("\n");
    expect(trail).not.toContain("Agents");
    expect(trail).toContain("Waiting on the agent.");
    expect(trail).not.toContain("fixture.txt");
    expect(trail).not.toContain("Wrote the fixture.");
    // The agent's own tool call is its step, counted in the roster, not in the session's heading.
    expect(trail).not.toContain("step");
    expect(sink.details).toEqual(["**1 · general-purpose** · Write the fixture\ndone in 2s · 1 tool · 1 token"]);
    expect(sink.detailTitles).toEqual(["Agents: fan out"]);
  });

  const agentStart = (taskId: string, taskType: string) => ({
    type: "system",
    subtype: "task_started",
    task_id: taskId,
    tool_use_id: `use-${taskId}`,
    description: `Task ${taskId}`,
    task_type: taskType,
  });

  // Asking Claude to stop its agents costs a turn and an interruption; the button reaches them directly.
  it("stops a turn's agents and leaves the turn running", async () => {
    scripted.set("spread out", [agentStart("t1", "local_agent"), agentStart("t2", "local_agent")]);
    const flow = makeFlow();
    const letEnd = keepRunning("spread out");
    const running = flow.run("s11", cwd, "spread out", {}, recordingSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(await flow.stopAgents("s11")).toBe(2);
    expect(asked).toContain("stopTasks t1,t2");
    expect(asked).not.toContain("stop spread out");
    letEnd();
    expect(await running).toBe(true);
    expect(await flow.stopAgents("s11")).toBe(0);
  });

  // Killing the process never reaches a task running in the cloud, which would go on being billed.
  it("tells a cloud task to stop before it kills the turn, and only a cloud one", async () => {
    scripted.set("review it", [agentStart("t3", "local_agent"), agentStart("t4", "remote_agent")]);
    const flow = makeFlow();
    keepRunning("review it");
    const running = flow.run("s12", cwd, "review it", {}, recordingSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(flow.stopTurn("s12").stopped).toBe(true);
    await running;
    await new Promise((resolve) => setTimeout(resolve, 10));
    const order = asked.filter((entry) => entry === "stopTasks t4" || entry === "stop review it");
    expect(order).toEqual(["stopTasks t4", "stop review it"]);
  });

  // The terminal takes a message typed mid-turn at the next step, and so does the bridge.
  it("hands a plain message to the turn already running, and marks it taken up and then done with the turn", async () => {
    const flow = makeFlow();
    const letEnd = keepRunning("long job");
    const running = flow.run("s13", cwd, "long job", {}, recordingSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const states: string[] = [];
    const asks: string[] = [];
    const closed: string[] = [];
    const sink = {
      ...quietSink(),
      ask: async (text: string, actions: Array<{ label: string }>) => {
        asks.push(`${text} [${actions.map((action) => action.label).join(",")}]`);
        return { close: async (outcome: string) => void closed.push(outcome) };
      },
    };
    const folded = flow.run("s13", cwd, "and this too", {}, sink, {
      resume: true,
      foldable: true,
      onState: async (state) => void states.push(state),
    });
    await vi.waitFor(() => expect(asked).toContain("handOver and this too"));
    expect(started).not.toContain("and this too");
    expect(asks[0]).toContain("Handed to the running turn");
    expect(asks[0]).toContain("[Send now]");
    expect(states).toEqual(["queued"]);
    expect(flow.queueDepth("s13")).toBe(1);

    expect(await flow.sendNow("s13")).toBe("sent");
    expect(asked).toContain("interrupt long job");
    taken.get("long job")?.("uuid-and this too");
    letEnd();
    await running;
    // Done only once the turn it joined is, so what the message brought along is held that long.
    expect(await folded).toBe(true);
    expect(states).toEqual(["queued", "running", "done"]);
    expect(closed).toEqual(["Taken up by the running turn."]);
    expect(await flow.sendNow("s13")).toBe("not-running");
  });

  it("says a message the turn ended without taking up did not run", async () => {
    const flow = makeFlow();
    const letEnd = keepRunning("busy elsewhere");
    const running = flow.run("s43", cwd, "busy elsewhere", {}, quietSink(), { resume: true });
    await vi.waitFor(() => expect(started).toContain("busy elsewhere"));

    const sink = { ...quietSink(), ask: async () => ({ close: async () => undefined }) };
    const folded = flow.run("s43", cwd, "never read", {}, sink, { resume: true, foldable: true });
    await vi.waitFor(() => expect(asked).toContain("handOver never read"));
    letEnd();
    await running;
    expect(await folded).toBe(false);
  });

  // The approval was given for the turn as it stood, and the message added to it may be from somebody who is not an owner.
  it("asks about tools again once a message is handed to a turn whose rest was approved", async () => {
    const approvals = new ApprovalPrompts();
    const flow = makeFlow(() => sayIn("en"), approvals);
    const letEnd = keepRunning("approved so far");
    const running = flow.run("s40", cwd, "approved so far", {}, recordingSink(), { resume: true });
    await vi.waitFor(() => expect(started).toContain("approved so far"));

    let asks = 0;
    const owner = "owner-1";
    const press = {
      ...quietSink(),
      ask: async (_text: string, actions: Array<{ id: string }>) => {
        asks += 1;
        if (asks === 1)
          approvals.decide(
            sayIn("en"),
            actions.find((action) => action.id.startsWith("approve-all:"))!.id.slice(12),
            owner,
            "approve-all",
          );
        return { close: async () => undefined };
      },
    };
    const english = sayIn("en");
    expect(await approvals.ask(english, "s40", press, [owner], "Bash", { command: "ls" })).toEqual({ allow: true });
    expect(await approvals.ask(english, "s40", press, [owner], "Bash", { command: "pwd" })).toEqual({ allow: true });
    expect(asks).toBe(1);

    const handed = { ...quietSink(), ask: async () => ({ close: async () => undefined }) };
    const joined = flow.run("s40", cwd, "and one from somebody else", {}, handed, { resume: true, foldable: true });
    await vi.waitFor(() => expect(asked).toContain("handOver and one from somebody else"));
    const afterwards = approvals.ask(english, "s40", press, [owner], "Bash", { command: "rm -r build" });
    await vi.waitFor(() => expect(asks).toBe(2));

    letEnd();
    await running;
    await joined;
    expect((await afterwards).allow).toBe(false);
  });

  // A branch's first turn runs in the source conversation's lane, as a process that writes to the branch.
  it("queues a message behind a branch's first turn instead of handing it to the branch", async () => {
    const flow = makeFlow();
    const letEnd = keepRunning("hello to the branch");
    const branching = flow.run("s41", cwd, "hello to the branch", {}, quietSink(), { resume: true, fork: true });
    await vi.waitFor(() => expect(started).toContain("hello to the branch"));

    const typed = flow.run("s41", cwd, "carry on with the old one", {}, quietSink(), { resume: true, foldable: true });
    await vi.waitFor(() => expect(flow.queueDepth("s41")).toBe(2));
    expect(asked).not.toContain("handOver carry on with the old one");

    letEnd();
    expect(await Promise.all([branching, typed])).toEqual([true, true]);
    expect(started).toContain("carry on with the old one");
  });

  // A session with nothing in hand starts on a message at once, long before its first words, and Send now would then cut the answer to that very message.
  it("does not interrupt a message the session has already started on", async () => {
    const flow = makeFlow();
    const letEnd = keepRunning("idle with a watcher");
    const running = flow.run("s17", cwd, "idle with a watcher", {}, recordingSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const closed: string[] = [];
    const sink = { ...quietSink(), ask: async () => ({ close: async (outcome: string) => void closed.push(outcome) }) };
    const joined = flow.run("s17", cwd, "one more thing", {}, sink, { resume: true, foldable: true });
    await vi.waitFor(() => expect(asked).toContain("handOver one more thing"));
    taken.get("idle with a watcher")?.("uuid-one more thing");
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(closed).toEqual(["Taken up by the running turn."]);
    expect(await flow.sendNow("s17")).toBe("nothing-waiting");
    expect(asked).not.toContain("interrupt idle with a watcher");
    letEnd();
    await running;
    await joined;
  });

  it("queues as before what is not a plain message, or what arrives with no turn to join", async () => {
    const flow = makeFlow();
    const letEnd = keepRunning("long job two");
    const first = flow.run("s14", cwd, "long job two", {}, quietSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const command = flow.run("s14", cwd, "/compact", {}, quietSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(flow.queueDepth("s14")).toBe(2);
    letEnd();
    expect(await Promise.all([first, command])).toEqual([true, true]);
    expect(started).toContain("/compact");

    expect(await flow.run("s15", cwd, "nobody home", {}, quietSink(), { resume: true, foldable: true })).toBe(true);
    expect(started).toContain("nobody home");
    expect(await flow.sendNow("s15")).toBe("not-running");
  });

  // What the /language reply promises: a pick applies from then on, and a turn already running ends as it began.
  it("finishes a turn in the language it started in, and starts the next in the one picked since", async () => {
    const remark = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Looking." }] } };
    scripted.set("before the pick", [remark]);
    scripted.set("after the pick", [remark]);
    const spoken: { language: Language } = { language: "en" };
    const flow = makeFlow(() => sayIn(spoken.language));

    const first = recordingSink();
    const running = flow.run("s16", cwd, "before the pick", {}, first, { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    spoken.language = "sv";
    await running;
    expect(first.messages[0]).toContain("**Worked**");

    const second = recordingSink();
    await flow.run("s16", cwd, "after the pick", {}, second, { resume: true });
    expect(second.messages[0]).toContain("**Arbetade**");
  });

  it("closes what joined a turn in the turn's language, even when the turn itself blows up", async () => {
    const blown = Promise.reject(new Error("the process went away"));
    blown.catch(() => undefined);
    endings.set("doomed in English", blown);
    const spoken: { language: Language } = { language: "en" };
    const flow = makeFlow(() => sayIn(spoken.language));
    const letEnd = keepRunning("doomed in English");
    const running = flow.run("s44", cwd, "doomed in English", {}, quietSink(), { resume: true }).catch(() => undefined);
    await vi.waitFor(() => expect(started).toContain("doomed in English"));
    spoken.language = "sv";

    const closed: string[] = [];
    const sink = { ...quietSink(), ask: async () => ({ close: async (outcome: string) => void closed.push(outcome) }) };
    const joined = flow.run("s44", cwd, "joins late", {}, sink, { resume: true, foldable: true });
    await vi.waitFor(() => expect(asked).toContain("handOver joins late"));
    letEnd();
    await running;
    await joined;
    expect(closed).toEqual(["The turn ended before this was taken up. Send it again."]);
  });

  // A report written mid-turn and then given as the answer is read once, where the trail already showed it whole.
  it("does not post an answer the trail has already shown across messages", async () => {
    const report = Array.from({ length: 40 }, (_, index) => `Finding ${index + 1}: ${"w".repeat(90)}`).join("\n");
    scripted.set("long report", [
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: report }] } },
    ]);
    endings.set("long report", { ok: true, text: report });
    const flow = makeFlow();
    const sink = recordingSink();
    vi.useFakeTimers();
    try {
      const letEnd = keepRunning("long report");
      const running = flow.run("s46", cwd, "long report", {}, sink, { resume: true });
      await vi.advanceTimersByTimeAsync(2500);
      letEnd();
      await running;
    } finally {
      vi.useRealTimers();
    }
    const everything = sink.messages.join("\n");
    expect(everything.match(/Finding 1:/g)).toHaveLength(1);
    expect(everything.match(/Finding 40:/g)).toHaveLength(1);
    expect(sink.messages.at(-1)).toContain("**Worked**");
  });

  // A progress message purged mid-turn cannot take the final edit, and the answer, the reaction and the outbox must not go down with it.
  it("still says the answer when the progress message is gone by the end", async () => {
    scripted.set("purged under it", [
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Looking." }] } },
    ]);
    const flow = makeFlow();
    const sink = recordingSink();
    const states: string[] = [];
    const deleted = { yes: false };
    const edit = sink.edit;
    sink.edit = async (text, actions) => {
      if (deleted.yes) throw new Error("Unknown Message");
      await edit(text, actions);
    };

    const letEnd = keepRunning("purged under it");
    const running = flow.run("s18", cwd, "purged under it", {}, sink, {
      resume: true,
      onState: async (state) => void states.push(state),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    deleted.yes = true;
    letEnd();

    expect(await running).toBe(true);
    expect(sink.messages.at(-1)).toBe("echo purged under it");
    expect(states).toEqual(["running", "done"]);
  });

  // A notice that cannot be sent mid-turn is a rejection nobody awaits until the turn ends, which would end the process.
  it("keeps the turn going when a notice in the middle of it cannot be sent", async () => {
    scripted.set("compacts to a dead channel", [
      {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: {
          trigger: "auto",
          pre_tokens: 9000,
          post_tokens: 900,
          cumulative_dropped_tokens: 8100,
          duration_ms: 2000,
        },
      },
    ]);
    const flow = makeFlow();
    const sink = recordingSink();
    sink.notice = async () => {
      throw new Error("Unknown Channel");
    };
    expect(await flow.run("s19", cwd, "compacts to a dead channel", {}, sink, { resume: true })).toBe(true);
    expect(sink.messages.at(-1)).toBe("echo compacts to a dead channel");
  });

  // Claude Code says the reason as its last remark too, so it is shown once, and without advice to retry that cannot help.
  it("shows a plan limit as the reason a turn failed, once, in Claude Code's own words", async () => {
    const reason = "You've hit your session limit · resets 3pm";
    scripted.set("over the limit", [
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: reason }] } },
    ]);
    endings.set("over the limit", { ok: false, text: "", error: { kind: "reported", text: reason } });
    const flow = makeFlow();
    const sink = recordingSink();
    await flow.run("s20", cwd, "over the limit", {}, sink, { resume: true });

    const shown = sink.messages.join("\n");
    expect(shown).toContain(`The turn failed.\n\`\`\`\n${reason}\n\`\`\``);
    expect(shown.split(reason)).toHaveLength(2);
    expect(shown).not.toContain("ended as");
    expect(shown).not.toContain("Try sending");
  });

  // The answer is the first remark after a prompt buried the trail, so the trail is still moving below it when the turn ends.
  it("puts the answer in the message the trail moved to, not a bare heading above it", async () => {
    scripted.set("answers after a prompt", [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "echo answers after a prompt" }] },
      },
    ]);
    const flow = makeFlow();
    const sink = recordingSink();
    const edit = sink.edit;
    sink.edit = async (text, actions) => {
      await edit(text, actions);
      sink.othersBelow = true;
    };
    const moveOn = sink.continueIn!;
    sink.continueIn = async (text, actions) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      await moveOn(text, actions);
    };
    sink.othersBelow = true;
    await flow.run("s29", cwd, "answers after a prompt", {}, sink, { resume: true });

    expect(sink.messages.at(-1)).toBe("echo answers after a prompt");
    expect(sink.messages.join("\n")).not.toContain("**Worked**");
  });

  describe("an outcome too long for one message", () => {
    const remark = (text: string) => ({
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "text", text }] },
    });
    // A sink that refuses what Discord would refuse.
    const strictSink = () => {
      const sink = recordingSink();
      const within = (text: string): void => {
        if (text.length > 2000) throw new Error("Invalid Form Body: content must be 2000 or fewer in length");
      };
      const { send, edit } = sink;
      sink.send = async (text) => {
        within(text);
        await send(text);
      };
      sink.edit = async (text, actions) => {
        within(text);
        await edit(text, actions);
      };
      return sink;
    };

    it("shows the whole reason a turn failed, across as many messages as it needs, and leaves no trail reading as live work", async () => {
      const reason = Array.from({ length: 60 }, (_, index) => `line ${index + 1}: ${"e".repeat(60)}`).join("\n");
      scripted.set("fails at length", [remark("Trying the build first.")]);
      endings.set("fails at length", { ok: false, text: "", error: { kind: "reported", text: reason } });
      const flow = makeFlow();
      const sink = strictSink();
      const states: string[] = [];
      await flow.run("s30", cwd, "fails at length", {}, sink, {
        resume: true,
        onState: async (state) => void states.push(state),
      });

      const shown = sink.messages.join("\n");
      expect(shown).toContain("line 1: ");
      expect(shown).toContain("line 60: ");
      expect(shown).not.toContain("**Working**");
      expect(states.at(-1)).toBe("failed");
    });

    // The first remark is sealed when a prompt buries the trail, so the answer's first message sits under a heading and has to leave it room.
    it("puts a long answer under the heading of the message the trail moved to, not beneath a bare one", async () => {
      // Twenty lines of 99 characters fill a message to within one character, which leaves a heading no room at all.
      const answer = Array.from({ length: 40 }, (_, index) => `Point ${index + 1}: `.padEnd(99, "y")).join("\n");
      scripted.set("long after a prompt", [remark("Looking into it first.")]);
      later.set("long after a prompt", remark(answer));
      endings.set("long after a prompt", { ok: true, text: answer });
      const flow = makeFlow();
      const sink = strictSink();
      setTimeout(() => {
        sink.othersBelow = true;
      }, 5);
      await flow.run("s31", cwd, "long after a prompt", {}, sink, { resume: true });

      const headings = sink.messages.filter((message) => message.includes("**Worked**"));
      expect(headings).toHaveLength(1);
      expect(headings[0]).toContain("Point 1: ");
      expect(sink.messages.join("\n")).toContain("Point 40: ");
    });
  });

  // The lane still holds the turn while it is being marked as seen, and nothing is left in it to stop by then.
  it("does not take a stop that lands after a turn's answer for a stop of the next turn", async () => {
    const flow = makeFlow();
    const marking = Promise.withResolvers<void>();
    const first = flow.run("s32", cwd, "answered already", {}, quietSink(), { resume: true, afterTurn: () => marking.promise });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(flow.stop("s32")).toEqual({ stopped: false, dropped: 0 });
    expect(flow.stopTurn("s32")).toEqual({ stopped: false, queued: 0 });
    marking.resolve();
    await first;

    const sink = recordingSink();
    await flow.run("s32", cwd, "the next one", {}, sink, { resume: true });
    expect(started).toContain("the next one");
    expect(sink.messages.at(-1)).toBe("echo the next one");
  });

  it("does not run a turn its own check turns back when its place in the lane comes up, and says why", async () => {
    const flow = makeFlow();
    const sink = recordingSink();
    const states: string[] = [];
    const ran = await flow.run("s33", cwd, "turned back", {}, sink, {
      resume: true,
      beforeTurn: async () => "The conversation this was for is gone.",
      onState: async (state) => void states.push(state),
    });

    expect(ran).toBe(false);
    expect(started).not.toContain("turned back");
    expect(sink.written).toEqual(["The conversation this was for is gone."]);
    expect(states).toEqual(["stopped"]);
  });

  it("asks whether to resume only when the turn's place in the lane comes up", async () => {
    const flow = makeFlow();
    const exists = { yet: false };
    const letEnd = keepRunning("creates it");
    const first = flow.run("s34", cwd, "creates it", {}, quietSink(), { resume: () => exists.yet });
    const second = flow.run("s34", cwd, "finds it there", {}, quietSink(), { resume: () => exists.yet });
    await new Promise((resolve) => setTimeout(resolve, 5));
    exists.yet = true;
    letEnd();
    await Promise.all([first, second]);

    expect(resumed.get("creates it")).toBe(false);
    expect(resumed.get("finds it there")).toBe(true);
  });

  it("says so when the files a turn left could not be attached, and still ends the turn as done", async () => {
    const flow = makeFlow();
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "flow-outbox-"));
    await fs.mkdir(outboxPath(folder, "s28"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(folder, "s28"), "report.md"), "done");
    const sink = recordingSink();
    sink.sendFiles = async () => {
      throw new Error("Missing Permissions");
    };
    const states: string[] = [];
    const ran = await flow.run("s28", folder, "writes a report", {}, sink, {
      resume: true,
      onState: async (state) => void states.push(state),
    });

    expect(ran).toBe(true);
    expect(states.at(-1)).toBe("done");
    expect(sink.written.join("\n")).toContain("Could not attach what is in `.discord-outbox/s28/`: Missing Permissions.");
    expect(await fs.readdir(outboxPath(folder, "s28"))).toEqual(["report.md"]);
  });

  it("points at /clear when the session a channel is bound to does not exist, since sending again cannot help", async () => {
    endings.set("bound to nothing", { ok: false, text: "", error: { kind: "unknown-session" } });
    const flow = makeFlow();
    const sink = recordingSink();
    await flow.run("s27", cwd, "bound to nothing", {}, sink, { resume: true });

    const shown = sink.messages.join("\n");
    expect(shown).toContain("Run `/clear` to start a fresh conversation in this channel.");
    expect(shown).not.toContain("Try sending");
  });

  describe("a stop that lands at an awkward moment", () => {
    const held = (): { wait: Promise<void>; release: () => void } => {
      const gate = Promise.withResolvers<void>();
      return { wait: gate.promise, release: gate.resolve };
    };

    // The Stop button is on screen before the turn is registered as running, so a press there has to count.
    it("stops a turn that is still being set up, before Claude Code is started", async () => {
      const flow = makeFlow();
      const sink = recordingSink();
      const states: string[] = [];
      const setUp = held();
      const running = flow.run("s21", cwd, "never starts", {}, sink, {
        resume: true,
        onState: async (state) => {
          states.push(state);
          if (state === "running") await setUp.wait;
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(flow.stopTurn("s21")).toEqual({ stopped: true, queued: 0 });
      setUp.release();
      expect(await running).toBe(true);
      expect(started).not.toContain("never starts");
      expect(sink.messages.at(-1)).toBe("Stopped.");
      expect(states).toEqual(["running", "stopped"]);
      expect(flow.stopTurn("s21")).toEqual({ stopped: false, queued: 0 });
    });

    it("tells a stop that the turn is over once its process has ended, while the answer is still being posted", async () => {
      const flow = makeFlow();
      const sink = recordingSink();
      const posting = held();
      const edit = sink.edit;
      sink.edit = async (text, actions) => {
        if (text.includes("echo already done")) await posting.wait;
        await edit(text, actions);
      };
      const running = flow.run("s22", cwd, "already done", {}, sink, { resume: true });
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(flow.stopTurn("s22")).toEqual({ stopped: false, queued: 0 });
      expect(flow.stop("s22")).toEqual({ stopped: false, dropped: 0 });
      expect(await flow.sendNow("s22")).toBe("not-running");
      expect(asked).not.toContain("stop already done");
      posting.release();
      expect(await running).toBe(true);
    });

    // A queued message's place is taken before its notice is posted, so a drop in between reaches it.
    it("drops a message that is still being told it is queued", async () => {
      const flow = makeFlow();
      keepRunning("in flight");
      const first = flow.run("s23", cwd, "in flight", {}, quietSink(), { resume: true });
      await new Promise((resolve) => setTimeout(resolve, 5));

      const telling = held();
      const sink = { ...quietSink(), notice: async () => telling.wait };
      const second = flow.run("s23", cwd, "told late", {}, sink, { resume: true });
      expect(flow.queueDepth("s23")).toBe(2);

      expect(flow.stop("s23")).toEqual({ stopped: true, dropped: 1 });
      telling.release();
      expect(await Promise.all([first, second])).toEqual([true, false]);
      expect(started).not.toContain("told late");
    });

    it("leaves the turn's last state showing when a question outlives the turn", async () => {
      asks.set("asks and ends", [
        { question: "Which?", header: "Pick", multiSelect: false, options: [{ label: "One", description: "" }] },
      ]);
      const flow = makeFlow();
      const states: string[] = [];
      const sink = menuAskingSink(() => undefined);
      await flow.run("s24", cwd, "asks and ends", {}, sink, { resume: true, onState: async (state) => void states.push(state) });
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(states).toContain("waiting");
      expect(states.at(-1)).toBe("done");
    });

    it("says so when the running turn would not be interrupted", async () => {
      uninterruptible.add("deaf to it");
      const flow = makeFlow();
      const letEnd = keepRunning("deaf to it");
      const running = flow.run("s25", cwd, "deaf to it", {}, quietSink(), { resume: true });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const sink = { ...quietSink(), ask: async () => ({ close: async () => undefined }) };
      const joined = flow.run("s25", cwd, "hurry this", {}, sink, { resume: true, foldable: true });
      await vi.waitFor(() => expect(asked).toContain("handOver hurry this"));

      expect(await flow.sendNow("s25")).toBe("not-interrupted");
      letEnd();
      await running;
      await joined;
    });

    it("closes a Send now notice that arrives after the turn it was for has ended", async () => {
      const flow = makeFlow();
      const letEnd = keepRunning("ends first");
      const running = flow.run("s26", cwd, "ends first", {}, quietSink(), { resume: true });
      await new Promise((resolve) => setTimeout(resolve, 5));

      const closed: string[] = [];
      const posted = held();
      const sink = {
        ...quietSink(),
        ask: async () => {
          await posted.wait;
          return { close: async (outcome: string) => void closed.push(outcome) };
        },
      };
      const folded = flow.run("s26", cwd, "posted late", {}, sink, { resume: true, foldable: true });
      await vi.waitFor(() => expect(asked).toContain("handOver posted late"));
      letEnd();
      await running;
      posted.release();
      await folded;

      expect(closed).toEqual(["The turn ended before this was taken up. Send it again."]);
    });
  });

  it("stops everything at once when told to, dropping what was queued", async () => {
    const flow = makeFlow();
    keepRunning("one");
    const first = flow.run("s7", cwd, "one", {}, quietSink(), { resume: true });
    const second = flow.run("s7", cwd, "two", {}, quietSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));

    flow.stopAll();
    expect(await Promise.all([first, second])).toEqual([true, false]);
    expect(flow.activeCount()).toBe(0);
  });
});
