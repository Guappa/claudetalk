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
import path from "node:path";

const started = vi.hoisted(() => [] as string[]);
// Events a mocked turn replays before it finishes, keyed by its prompt.
const scripted = vi.hoisted(() => new Map<string, unknown[]>());

// A real turn spawns Claude Code; these tests are about what surrounds one, not the turn itself.
vi.mock("../src/claude/runner.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/claude/runner.ts")>();
  return {
    ...actual,
    runTurn: (request: { prompt: string }, onEvent: (event: unknown) => void) => {
      started.push(request.prompt);
      for (const event of scripted.get(request.prompt) ?? []) onEvent(event);
      return {
        stop: () => undefined,
        done: new Promise((resolve) => setTimeout(() => resolve({ ok: true, text: `echo ${request.prompt}` }), 20)),
      };
    },
  };
});

function makeFlow(): TurnFlow {
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
    await flow.run("s2", cwd, "boom", {}, quietSink(), {
      resume: true,
      beforeTurn: async () => {
        throw new Error("preflight blew up");
      },
      afterTurn: async () => void order.push("after"),
    }).catch(() => undefined);
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
    const first = flow.run("s8", cwd, "wrong", {}, quietSink(), { ...hooks("wrong"), onState: async (state) => void states.push(state) });
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

  // An agent's edit once showed in the trail as if the session had made it, with its report repeated as a remark.
  it("keeps an agent out of the trail altogether, and shows it as an entry in the side room's roster", async () => {
    scripted.set("fan out", [
      { type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "use1", description: "Write the fixture", subagent_type: "general-purpose", task_type: "local_agent" },
      { type: "assistant", parent_tool_use_id: "use1", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/srv/app/fixture.txt", content: "alpha" } }] } },
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Waiting on the agent." }] } },
      { type: "assistant", parent_tool_use_id: "use1", message: { content: [{ type: "text", text: "Wrote the fixture." }] } },
      { type: "system", subtype: "task_notification", task_id: "t1", status: "completed", summary: "Wrote the fixture.", usage: { total_tokens: 1, tool_uses: 1, duration_ms: 2000 } },
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
