import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import os from "node:os";
import { runTurn } from "../src/claude/runner.ts";
import type { ClaudeEvent } from "../src/claude/events.ts";

type Script = (signal: AbortSignal) => AsyncGenerator<ClaudeEvent>;
type SpawnHook = (spawnOptions: { command: string; args: string[]; env: NodeJS.ProcessEnv; signal: AbortSignal }) => ChildProcess;

// One script per process the runner starts, in order; what each Agent SDK session says.
const sessions = vi.hoisted(() => ({
  scripts: [] as Script[],
  options: [] as Array<Record<string, unknown>>,
  children: [] as ChildProcess[],
  // What the session says of its own context when asked; null is a session that does not answer.
  context: null as Record<string, unknown> | null,
}));
const killed = vi.hoisted(() => [] as number[]);

// The real query() starts Claude Code; these tests are about what the runner does around a session.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({
    options,
  }: {
    options: Record<string, unknown> & { abortController: AbortController; spawnClaudeCodeProcess: SpawnHook };
  }) => {
    sessions.options.push(options);
    // A real idle process stands in for Claude Code, so the runner learns a pid the way it does in production.
    const idle = ["-e", "setInterval(() => undefined, 1000)"];
    const child = options.spawnClaudeCodeProcess({
      command: process.execPath,
      args: idle,
      env: process.env,
      signal: options.abortController.signal,
    });
    // Aborting a spawned process raises an error on it, which the SDK handles and this stand-in has to as well.
    child.on("error", () => undefined);
    sessions.children.push(child);
    const script = sessions.scripts.shift();
    if (!script) throw new Error("no script for this session");
    return Object.assign(script(options.abortController.signal), {
      initializationResult: async () => ({ commands: [] }),
      interrupt: async () => undefined,
      stopTask: async () => undefined,
      getContextUsage: async () => {
        if (!sessions.context) throw new Error("no answer");
        return sessions.context;
      },
    });
  },
}));

vi.mock("../src/platform.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/platform.ts")>()),
  killTree: (pid: number) => void killed.push(pid),
}));

afterEach(() => {
  for (const child of sessions.children) child.kill();
  sessions.children.length = 0;
  sessions.scripts.length = 0;
  sessions.options.length = 0;
  sessions.context = null;
  killed.length = 0;
});

const spoke: ClaudeEvent = {
  type: "assistant",
  parent_tool_use_id: null,
  message: { content: [{ type: "text", text: "on it" }], usage: { input_tokens: 40, cache_read_input_tokens: 10 } },
} as unknown as ClaudeEvent;
const answered = (text: string): ClaudeEvent =>
  ({ type: "result", subtype: "success", is_error: false, result: text, usage: { input_tokens: 1 } }) as unknown as ClaudeEvent;
const failed: ClaudeEvent = {
  type: "result",
  subtype: "error",
  is_error: true,
  errors: ["the model stopped"],
} as unknown as ClaudeEvent;
const orphan: ClaudeEvent = { type: "system", subtype: "task_notification", status: "stopped" } as ClaudeEvent;
const taken = (uuid: string): ClaudeEvent => ({ type: "command_lifecycle", command_uuid: uuid, state: "started" }) as ClaudeEvent;

const aborted = (signal: AbortSignal): Promise<never> =>
  new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));

// A session that answers at once.
const answers = (text: string): Script =>
  async function* () {
    yield spoke;
    yield answered(text);
  };

const request = (extra: Record<string, unknown> = {}) => ({
  sessionId: "s1",
  cwd: os.tmpdir(),
  prompt: "hello",
  settings: {},
  resume: true,
  ...extra,
});

describe("a turn around an Agent SDK session", () => {
  // Every turn runs in bypassPermissions; the hook is what contains one, so it has to be there when an approver is.
  it("attaches the gate to the session when a turn has an approver or a question sink, and not otherwise", async () => {
    sessions.scripts.push(answers("first"), answers("second"), answers("third"));
    await runTurn(request(), () => undefined).done;
    await runTurn(request({ approve: async () => ({ allow: true }) }), () => undefined).done;
    await runTurn(request({ askQuestions: async () => ({ answered: false, reason: "no" }) }), () => undefined).done;

    expect(sessions.options.map((options) => options.hooks !== undefined)).toEqual([false, true, true]);
  });

  // A session compacts short of its window's end, so a share of the window would call a nearly full session comfortable.
  it("takes how full the session is from the session's own account, measured against where it compacts", async () => {
    sessions.context = { totalTokens: 140_000, maxTokens: 200_000, isAutoCompactEnabled: true, autoCompactThreshold: 167_000 };
    sessions.scripts.push(answers("done"));
    expect((await runTurn(request(), () => undefined).done).context).toEqual({ usedTokens: 140_000, ceilingTokens: 167_000 });

    sessions.context = { totalTokens: 140_000, maxTokens: 200_000, isAutoCompactEnabled: false };
    sessions.scripts.push(answers("done"));
    expect((await runTurn(request(), () => undefined).done).context).toEqual({ usedTokens: 140_000, ceilingTokens: 200_000 });
  });

  it("ends the turn with its answer when the session gives no account of its context", async () => {
    sessions.scripts.push(answers("done"));
    const result = await runTurn(request(), () => undefined).done;
    expect(result).toMatchObject({ ok: true, text: "done" });
    expect(result.context).toBeUndefined();
  });

  // A stop that lands after the turn is over must not signal a pid that by then belongs to nobody, or to somebody else.
  it("does not kill anything for a stop that arrives once the turn is over", async () => {
    sessions.scripts.push(answers("done"));
    const turn = runTurn(request(), () => undefined);
    await turn.done;
    expect(sessions.children[0]?.pid).toBeDefined();
    turn.stop();
    expect(killed).toEqual([]);
  });

  // A process that opens by reporting an orphaned task cancels every tool call afterwards; only a fresh one is clean.
  it("starts a fresh process when the first reports an orphan, and gives up when the second does too", async () => {
    sessions.scripts.push(async function* () {
      yield orphan;
    }, answers("clean"));
    expect(await runTurn(request(), () => undefined).done).toMatchObject({ ok: true, text: "clean" });
    expect(sessions.options).toHaveLength(2);

    sessions.scripts.push(
      async function* () {
        yield orphan;
      },
      async function* () {
        yield orphan;
      },
    );
    expect(await runTurn(request(), () => undefined).done).toMatchObject({ ok: false, error: { kind: "orphan-twice" } });
  });

  // The token expires on the hour for every process at once; the loser of the refresh is told to retry, and the bridge does it.
  it("runs the turn once more after a login refresh lost to another process, and gives up on a second loss", async () => {
    const lost: ClaudeEvent = {
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh.",
      usage: { input_tokens: 1 },
    } as unknown as ClaudeEvent;
    const onRetry = vi.fn();
    sessions.scripts.push(async function* () {
      yield lost;
    }, answers("clean"));
    const first = await runTurn({ ...request(), retryDelayMs: 5, onRetry }, () => undefined).done;
    expect(first).toMatchObject({ ok: true, text: "clean" });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(sessions.options).toHaveLength(2);

    sessions.scripts.push(
      async function* () {
        yield lost;
      },
      async function* () {
        yield lost;
      },
    );
    const second = await runTurn({ ...request(), retryDelayMs: 5 }, () => undefined).done;
    expect(second).toMatchObject({ ok: false, error: { kind: "token-refresh" } });
  });

  it("ends as stopped, with no second process, when stopped while the first attempt is still under way", async () => {
    sessions.scripts.push(async function* (signal) {
      // Says nothing until it is aborted; the yield after that is never reached and only makes this a generator.
      await aborted(signal);
      yield spoke;
    });
    const turn = runTurn(request(), () => undefined);
    await vi.waitFor(() => expect(sessions.options).toHaveLength(1));
    turn.stop();
    expect(await turn.done).toMatchObject({ ok: false, error: { kind: "stopped" } });
    expect(sessions.options).toHaveLength(1);
  });

  // A message handed to the turn runs as the next turn in the same process, so a failed result before it is not the end.
  it("does not end on a failed result while a message handed to it is still waiting to run", async () => {
    const handed = Promise.withResolvers<string>();
    sessions.scripts.push(async function* () {
      yield spoke;
      const uuid = await handed.promise;
      yield failed;
      yield taken(uuid);
      yield spoke;
      yield answered("the second answer");
    });
    const turn = runTurn(request(), () => undefined);
    await vi.waitFor(() => expect(sessions.options).toHaveLength(1));
    await vi.waitFor(() => expect(turn.handOver("and this")).not.toBeNull(), { timeout: 2000 });
    handed.resolve("uuid-pending");

    expect(await turn.done).toMatchObject({ ok: true, text: "the second answer" });
  });
});
