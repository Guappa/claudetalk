import { describe, it, expect, vi } from "vitest";
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
import { quietSink, recordingSink } from "./helpers/sinks.ts";
import { sayIn, type Language, type Say } from "../src/i18n/index.ts";
import path from "node:path";

const started = vi.hoisted(() => [] as string[]);
// Events a mocked turn replays before it finishes, keyed by its prompt.
const scripted = vi.hoisted(() => new Map<string, unknown[]>());
// What a mocked turn was asked to do, in order: tasks stopped inside it, and the turn itself stopped.
const asked = vi.hoisted(() => [] as string[]);
// How a test makes a mocked turn report that it took up a message handed to it.
const taken = vi.hoisted(() => new Map<string, (uuid: string) => void>());
// How a mocked turn ends when it does not simply answer, keyed by its prompt.
const endings = vi.hoisted(() => new Map<string, unknown>());

// A real turn spawns Claude Code; these tests are about what surrounds one, not the turn itself.
vi.mock("../src/claude/runner.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/claude/runner.ts")>();
  return {
    ...actual,
    runTurn: (request: { prompt: string }, onEvent: (event: unknown) => void) => {
      started.push(request.prompt);
      for (const event of scripted.get(request.prompt) ?? []) onEvent(event);
      return {
        stop: () => void asked.push(`stop ${request.prompt}`),
        stopTasks: async (taskIds: string[]) => void asked.push(`stopTasks ${taskIds.join(",")}`),
        handOver: (text: string) => {
          asked.push(`handOver ${text}`);
          taken.set(request.prompt, (uuid) => onEvent({ type: "command_lifecycle", command_uuid: uuid, state: "started" }));
          return `uuid-${text}`;
        },
        interrupt: async () => {
          asked.push(`interrupt ${request.prompt}`);
          return [];
        },
        done: new Promise((resolve) =>
          setTimeout(() => resolve(endings.get(request.prompt) ?? { ok: true, text: `echo ${request.prompt}` }), 20),
        ),
      };
    },
  };
});

function makeFlow(language: () => Say = () => sayIn("en")): TurnFlow {
  const config = { toolApprovals: false, ownerIds: [] } as unknown as Config;
  return new TurnFlow(
    new CapabilityCache(),
    () => new ContextTracker(),
    new UsageLedger(),
    new PlanUsage(),
    new ApprovalPrompts(),
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
    const first = flow.run("s5", cwd, "one", {}, quietSink(), { resume: true });
    const second = flow.run("s5", cwd, "two", {}, quietSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(flow.activeCount()).toBe(2);

    const seen: number[] = [];
    const drained = flow.drain((turns) => seen.push(turns));
    const refused = recordingSink();
    expect(await flow.run("s6", cwd, "three", {}, refused, { resume: true })).toBe(false);
    expect(refused.written[0]).toContain("shutting down");

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
    expect(sink.details).toEqual(["**1 · general-purpose** · Write the fixture\ndone in 2s · 1 tool · 1 tokens"]);
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
    const running = flow.run("s11", cwd, "spread out", {}, recordingSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(await flow.stopAgents("s11")).toBe(2);
    expect(asked).toContain("stopTasks t1,t2");
    expect(asked).not.toContain("stop spread out");
    expect(await running).toBe(true);
    expect(await flow.stopAgents("s11")).toBe(0);
  });

  // Killing the process never reaches a task running in the cloud, which would go on being billed.
  it("tells a cloud task to stop before it kills the turn, and only a cloud one", async () => {
    scripted.set("review it", [agentStart("t3", "local_agent"), agentStart("t4", "remote_agent")]);
    const flow = makeFlow();
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
    const folded = await flow.run("s13", cwd, "and this too", {}, sink, {
      resume: true,
      foldable: true,
      onState: async (state) => void states.push(state),
    });
    expect(folded).toBe(true);
    expect(asked).toContain("handOver and this too");
    expect(started).not.toContain("and this too");
    expect(asks[0]).toContain("Handed to the running turn");
    expect(asks[0]).toContain("[Send now]");
    expect(states).toEqual(["queued"]);
    expect(flow.queueDepth("s13")).toBe(1);

    expect(await flow.sendNow("s13")).toBe("sent");
    expect(asked).toContain("interrupt long job");
    taken.get("long job")?.("uuid-and this too");
    await running;
    expect(states).toEqual(["queued", "running", "done"]);
    expect(closed).toEqual(["Taken up by the running turn."]);
    expect(await flow.sendNow("s13")).toBe("not-running");
  });

  // A session with nothing in hand starts on a message at once, long before its first words, and Send now would then cut the answer to that very message.
  it("does not interrupt a message the session has already started on", async () => {
    const flow = makeFlow();
    const running = flow.run("s17", cwd, "idle with a watcher", {}, recordingSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const closed: string[] = [];
    const sink = { ...quietSink(), ask: async () => ({ close: async (outcome: string) => void closed.push(outcome) }) };
    await flow.run("s17", cwd, "one more thing", {}, sink, { resume: true, foldable: true });
    taken.get("idle with a watcher")?.("uuid-one more thing");
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(closed).toEqual(["Taken up by the running turn."]);
    expect(await flow.sendNow("s17")).toBe("nothing-waiting");
    expect(asked).not.toContain("interrupt idle with a watcher");
    await running;
  });

  it("queues as before what is not a plain message, or what arrives with no turn to join", async () => {
    const flow = makeFlow();
    const first = flow.run("s14", cwd, "long job two", {}, quietSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const command = flow.run("s14", cwd, "/compact", {}, quietSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(flow.queueDepth("s14")).toBe(2);
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

    const running = flow.run("s18", cwd, "purged under it", {}, sink, {
      resume: true,
      onState: async (state) => void states.push(state),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    deleted.yes = true;

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

  it("stops everything at once when told to, dropping what was queued", async () => {
    const flow = makeFlow();
    const first = flow.run("s7", cwd, "one", {}, quietSink(), { resume: true });
    const second = flow.run("s7", cwd, "two", {}, quietSink(), { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 5));

    flow.stopAll();
    expect(await Promise.all([first, second])).toEqual([true, false]);
    expect(flow.activeCount()).toBe(0);
  });
});
