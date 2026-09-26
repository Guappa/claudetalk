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

// A real turn spawns Claude Code; these tests are about what surrounds one, not the turn itself.
vi.mock("../src/claude/runner.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/claude/runner.ts")>();
  return {
    ...actual,
    runTurn: (request: { prompt: string }) => {
      started.push(request.prompt);
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
