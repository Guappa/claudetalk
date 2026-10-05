import { setTimeout as wait } from "node:timers/promises";
import { spawn } from "node:child_process";
import { query, type Options, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { killTree, turnSpawnOptions } from "../platform.ts";
import { errorMessage } from "../text.ts";
import { outboxRelative } from "../outboxFolder.ts";
import type { ContextReport } from "./contextTracker.ts";
import { detectClaudeError, type ClaudeError } from "./errors.ts";
import type { ClaudeEvent, TokenUsage } from "./events.ts";
import { HeldPrompt } from "./heldPrompt.ts";
import { APPROVAL_REFUSED, QUESTIONS_UNANSWERED } from "./prompts.ts";
import { QUESTION_TOOL, parseQuestions, type AskQuestions } from "./questions.ts";

export interface ChannelSettings {
  model?: string;
  effort?: string;
  fallbackModel?: string;
  autocompact?: string;
  agent?: string;
  // The kinds of tool call the trail leaves out in this conversation; without it the conversation follows the bridge's default.
  trailHidden?: string[];
}

export type ToolDecision = { allow: true } | { allow: false; reason: string };
export type ApproveTool = (toolName: string, input: Record<string, unknown>) => Promise<ToolDecision>;
type AskFirst = (toolName: string, input: Record<string, unknown>) => Promise<ToolDecision> | null;

export interface TurnRequest {
  sessionId: string;
  cwd: string;
  prompt: string;
  resume: boolean;
  name?: string;
  settings: ChannelSettings;
  fork?: boolean;
  approve?: ApproveTool;
  askQuestions?: AskQuestions;
  deny?: (toolName: string, toolInput: Record<string, unknown>) => string | null;
  ask?: AskFirst;
  // How many times the turn may go back to the model before Claude Code stops it; left out, it runs as long as it needs.
  maxTurns?: number;
  // Told when the turn is run a second time after a login refresh lost to another process, so the trail can say so.
  onRetry?: () => void;
  retryDelayMs?: number;
}

interface TurnOutcome {
  text: string;
  sessionId?: string;
  usage?: TokenUsage;
  // How full the session says it is, asked when the turn's answer came.
  context?: ContextReport;
  // Claude Code's running total for the conversation, not the price of this turn.
  sessionCostUsd?: number;
}

export type TurnResult = (TurnOutcome & { ok: true }) | (TurnOutcome & { ok: false; error: ClaudeError });

// Sent per turn rather than in the prompt, so it never accumulates in the transcript.
export function bridgeSystemNote(sessionId: string): string {
  return [
    "You are reached through Discord. A message caps at 2000 characters, so aim well under",
    "that and keep replies readable at phone width; longer output is split across messages.",
    `Better: write a file under 8 MB into ${outboxRelative(sessionId)} in the working directory,`,
    "creating the folder if needed, and it is attached, then removed. Anything larger is refused.",
    "Discord renders no tables; use a list instead.",
    "Think out loud as you go: before a step, and when something turns out differently than you",
    "expected, say so in a sentence. Those remarks show live while the turn runs and are the only",
    "sign of progress the reader gets, so silence reads as a hang.",
    "This conversation may also be open in a terminal here.",
  ].join(" ");
}

// Reading the working directory is what a turn is for; approving each read would make the gate unusable.
const UNGATED_TOOLS = new Set(["Read", "Glob", "Grep", "TodoWrite", "NotebookRead"]);

export function buildOptions(request: TurnRequest): Options {
  const { settings } = request;

  const options: Options = {
    cwd: request.cwd,
    systemPrompt: { type: "preset", preset: "claude_code", append: bridgeSystemNote(request.sessionId) },
    // Anyone who can reach a conversation can already run code in it; the gate below is what contains a turn.
    permissionMode: "bypassPermissions",
    includePartialMessages: false,
  };

  if (request.resume) {
    options.resume = request.sessionId;
    // Forking leaves the original untouched and lets Claude Code mint the new id.
    if (request.fork) options.forkSession = true;
  } else {
    options.sessionId = request.sessionId;
    if (request.name) options.title = request.name;
  }

  if (settings.model) options.model = settings.model;
  if (settings.fallbackModel) options.fallbackModel = settings.fallbackModel;
  if (settings.effort) options.effort = settings.effort as Options["effort"];
  if (settings.agent) options.agent = settings.agent;
  if (request.maxTurns) options.maxTurns = request.maxTurns;
  // The bridge has its own control for stopping agents, which is what makes an interrupt spare them; without this one kills every agent running.
  options.perTaskStopAffordance = true;
  // Replay is how the bridge learns a message handed over mid-turn was taken up; no typed option covers it, or autocompact.
  options.extraArgs = { "replay-user-messages": null };
  if (settings.autocompact) options.extraArgs.autocompact = settings.autocompact;
  // Claude Code offers AskUserQuestion only to a client with a prompt surface; the hook answers before that is consulted.
  if (request.askQuestions) options.permissionPromptToolName = "stdio";

  return options;
}

interface HookOutput {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason: string;
    updatedInput?: Record<string, unknown>;
  };
}

function allowed(reason: string, updatedInput?: Record<string, unknown>): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: reason,
      updatedInput,
    },
  };
}

function denied(reason: string): HookOutput {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}

interface Gates {
  approve?: ApproveTool;
  askQuestions?: AskQuestions;
  // The reason a call is refused outright, before any approval is asked; null lets it through to the rest of the gate.
  deny?: (toolName: string, toolInput: Record<string, unknown>) => string | null;
  // A call that is refused unless a person lets this one through; null where no such rule applies to it.
  ask?: AskFirst;
}

async function decide(
  gates: Gates,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<HookOutput | { continue: true }> {
  if (toolName === QUESTION_TOOL && gates.askQuestions) {
    const outcome = await gates.askQuestions(parseQuestions(toolInput));
    return outcome.answered
      ? allowed("Answered from Discord.", { ...toolInput, answers: outcome.answers })
      : denied(outcome.reason);
  }

  const refused = gates.deny?.(toolName, toolInput);
  if (refused) return denied(refused);
  // Let through by name, it is not asked about a second time by the approvals that cover every call.
  const asked = gates.ask?.(toolName, toolInput);
  if (asked) {
    const answer = await asked;
    return answer.allow ? allowed("Approved from Discord.") : denied(answer.reason);
  }
  if (!gates.approve || UNGATED_TOOLS.has(toolName)) return { continue: true };
  const decision = await gates.approve(toolName, toolInput);
  return decision.allow ? allowed("Approved from Discord.") : denied(decision.reason);
}

const GATE_TIMEOUT_SECONDS = 15 * 60;
// Enough of what the process wrote to stderr to hold the line on which it says why it gave up.
const STDERR_TAIL_CHARS = 2000;

// A permission mode cannot hold the gate: the host's own allow rules are consulted first, a hook is not.
export function gate(gates: Gates): NonNullable<Options["hooks"]> {
  return {
    PreToolUse: [
      {
        // Claude Code gives a hook ten minutes by default, which is what the bridge gives a question; its own clock would run out first and the reason the bridge returns would reach nobody.
        timeout: GATE_TIMEOUT_SECONDS,
        hooks: [
          async (input) => {
            const toolName = String((input as { tool_name?: unknown }).tool_name ?? "");
            const toolInput = ((input as { tool_input?: unknown }).tool_input ?? {}) as Record<string, unknown>;
            // Claude Code takes a hook that throws for one with no opinion and runs the tool, so a gate that cannot answer has to refuse.
            try {
              return await decide(gates, toolName, toolInput);
            } catch (error) {
              console.error(`the gate for ${toolName} failed and refused it`, error);
              return denied(toolName === QUESTION_TOOL ? QUESTIONS_UNANSWERED.unshown : APPROVAL_REFUSED.failed);
            }
          },
        ],
      },
    ],
  };
}

// The API leaves cache counts null when nothing was cached, and the tracker adds them.
function messageUsage(usage: unknown): TokenUsage | undefined {
  const record = usage as Partial<Record<keyof TokenUsage, number | null>> | null | undefined;
  if (!record || typeof record.input_tokens !== "number") return undefined;
  return {
    input_tokens: record.input_tokens,
    output_tokens: record.output_tokens ?? 0,
    cache_read_input_tokens: record.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: record.cache_creation_input_tokens ?? 0,
  };
}

// A session that does not answer must not hold up the end of its turn.
const CONTEXT_ANSWER_MS = 2_000;

async function contextOf(session: Query): Promise<ContextReport | undefined> {
  const answer = session.getContextUsage().then(
    (usage): ContextReport | undefined => {
      const ceilingTokens = (usage.isAutoCompactEnabled && usage.autoCompactThreshold) || usage.maxTokens;
      return ceilingTokens > 0 ? { usedTokens: usage.totalTokens, ceilingTokens } : undefined;
    },
    () => undefined,
  );
  return await Promise.race([answer, wait(CONTEXT_ANSWER_MS, undefined, { ref: false })]);
}

const RESTART = Symbol("restart");
// What Claude Code itself advises on this error: retry in a minute. A lock left by a process that died takes about that long to count as stale.
const REFRESH_RETRY_MS = 60_000;

async function consumeStream(
  held: HeldPrompt,
  options: Options,
  abort: AbortController,
  live: Live,
  onEvent: (event: ClaudeEvent) => void,
  complained: () => string,
): Promise<TurnResult | typeof RESTART> {
  const outcome: TurnOutcome = { text: "" };
  // What the last result failed with while a message was still waiting to run; it is the outcome after all if nothing follows.
  let unanswered: ClaudeError | null = null;

  try {
    const run = query({ prompt: held.stream(), options: { ...options, abortController: abort } });
    live.query = run;
    // Either outcome of the handshake lets the prompt go; a doomed process has already been marked by then.
    run.initializationResult().then(
      (introduced) => {
        held.ready();
        // The handshake is the one place a session lists its commands with their descriptions.
        onEvent({ type: "system", subtype: "commands_changed", commands: introduced.commands } as unknown as ClaudeEvent);
      },
      () => held.ready(),
    );
    for await (const message of run) {
      // A session answers about itself only while its input is open, and taking in its answer to the turn is what closes it.
      if (message.type === "result" && !message.is_error) outcome.context = (await contextOf(run)) ?? outcome.context;
      held.observe(message as unknown as ClaudeEvent);
      if (held.needsRestart) {
        abort.abort();
        return RESTART;
      }
      onEvent(message as unknown as ClaudeEvent);

      const reported = (message as { session_id?: string }).session_id;
      if (reported) outcome.sessionId = reported;

      if (message.type === "result") {
        unanswered = foldResult(outcome, message as unknown as ResultMessage);
        // An interrupted turn ends as an error, but a message still waiting makes it the start of the next, not a failure.
        if (unanswered && !held.awaitsUntaken) return { ...outcome, ok: false, error: unanswered };
      }
    }
  } catch (error) {
    if (held.needsRestart) return RESTART;
    if (abort.signal.aborted) {
      return { ...outcome, ok: false, error: { kind: "stopped" } };
    }
    return { ...outcome, ok: false, error: failure(error, complained()) };
  }

  return unanswered ? { ...outcome, ok: false, error: unanswered } : { ...outcome, ok: true };
}

// A result as the stream delivers it: a success carries its text, a failure its errors, and a success can still be an error when the API refused.
interface ResultMessage {
  subtype: string;
  is_error: boolean;
  result?: string;
  errors?: string[];
  usage?: unknown;
  total_cost_usd?: number;
}

// One process answers several turns, so each result is folded into what came before: the latest answer stands, the tokens add up, the cost is already a running total. Returns what it failed with, if it failed.
export function foldResult(outcome: TurnOutcome, result: ResultMessage): ClaudeError | null {
  const said = typeof result.result === "string" ? result.result : "";
  outcome.usage = addUsage(outcome.usage, messageUsage(result.usage));
  if (result.total_cost_usd !== undefined) outcome.sessionCostUsd = result.total_cost_usd;
  if (!result.is_error) {
    outcome.text = said;
    return null;
  }
  if (result.subtype !== "success") return resultError(result.subtype, result.errors ?? []);
  return detectClaudeError(said) ?? { kind: "reported", text: said };
}

function addUsage(earlier: TokenUsage | undefined, later: TokenUsage | undefined): TokenUsage | undefined {
  if (!earlier || !later) return later ?? earlier;
  return {
    input_tokens: earlier.input_tokens + later.input_tokens,
    output_tokens: earlier.output_tokens + later.output_tokens,
    cache_read_input_tokens: earlier.cache_read_input_tokens + later.cache_read_input_tokens,
    cache_creation_input_tokens: earlier.cache_creation_input_tokens + later.cache_creation_input_tokens,
  };
}

const ORPHAN_TWICE: TurnResult = { text: "", ok: false, error: { kind: "orphan-twice" } };

export interface RunningTurn {
  stop: () => void;
  // Stops tasks inside the turn and leaves the turn running; a cloud task is closed down where it runs.
  stopTasks: (taskIds: string[]) => Promise<void>;
  // Hands the running turn another message, taken up at its next step; null when it is past taking one.
  handOver: (text: string) => string | null;
  // Cuts short what the turn is doing, so a message still waiting runs at once; false when there was nothing to tell, or it would not be told.
  interrupt: () => Promise<boolean>;
  done: Promise<TurnResult>;
}

// The session a turn is talking to, once there is one; controls such as stopping a task go through it.
interface Live {
  query: Query | null;
}

interface Attempt {
  held: HeldPrompt;
  abort: AbortController;
  live: Live;
  done: Promise<TurnResult | typeof RESTART>;
}

export function runTurn(request: TurnRequest, onEvent: (event: ClaudeEvent) => void): RunningTurn {
  const options = buildOptions(request);
  if (request.approve || request.askQuestions || request.deny || request.ask) options.hooks = gate(request);

  // Spawning it ourselves is the only way to learn the pid, and stopping a turn means its whole tree.
  let pid: number | undefined;
  const complaints = { tail: "" };
  options.spawnClaudeCodeProcess = (spawnOptions) => {
    const child = spawn(spawnOptions.command, spawnOptions.args, {
      ...turnSpawnOptions(spawnOptions.cwd ?? request.cwd),
      env: spawnOptions.env,
      signal: spawnOptions.signal,
    });
    pid = child.pid;
    complaints.tail = "";
    // Read, or the pipe fills and the process stalls on its next line; kept, because a process that will not start says why only there.
    child.stderr?.on("data", (chunk: Buffer) => {
      complaints.tail = `${complaints.tail}${chunk.toString("utf8")}`.slice(-STDERR_TAIL_CHARS);
    });
    return child;
  };

  const start = (): Attempt => {
    const held = new HeldPrompt(request.prompt);
    const abort = new AbortController();
    const live: Live = { query: null };
    return { held, abort, live, done: consumeStream(held, options, abort, live, onEvent, () => complaints.tail) };
  };

  let attempt = start();
  let stopped = false;

  // A process that met an orphaned task is thrown away before the prompt goes out, and a fresh one gets the turn; one that lost the login refresh to another process gets a second go after a pause.
  const done = attempt.done.then(async (result) => {
    const lostRefresh = result !== RESTART && !result.ok && result.error.kind === "token-refresh";
    if (result !== RESTART && !lostRefresh) return result;
    if (lostRefresh) {
      request.onRetry?.();
      await wait(request.retryDelayMs ?? REFRESH_RETRY_MS);
    }
    if (stopped) return { text: "", ok: false, error: { kind: "stopped" } } as TurnResult;
    attempt = start();
    const again = await attempt.done;
    return again === RESTART ? ORPHAN_TWICE : again;
  });

  // Once the turn is over its pid belongs to nobody, or to somebody else.
  let over = false;
  void done.then(() => {
    over = true;
  });

  const stop = (): void => {
    if (over) return;
    stopped = true;
    // Killing only the turn leaves whatever it was running alive, which is not what a stop means.
    if (pid !== undefined) killTree(pid);
    attempt.held.close();
    attempt.abort.abort();
  };

  // A task that ended a moment ago refuses to be stopped, which is the outcome that was wanted anyway.
  const stopTasks = async (taskIds: string[]): Promise<void> => {
    for (const taskId of taskIds) await attempt.live.query?.stopTask(taskId).catch(() => undefined);
  };

  const handOver = (text: string): string | null => (stopped ? null : attempt.held.handOver(text));

  const interrupt = async (): Promise<boolean> => {
    const session = attempt.live.query;
    if (!session || over) return false;
    return await session.interrupt().then(
      () => true,
      () => false,
    );
  };

  return { stop, stopTasks, handOver, interrupt, done };
}

// A session opened to ask Claude Code about the folder and nothing else: no message is sent, so no model is called, and no transcript is kept.
export async function askSession<Answer>(cwd: string, ask: (session: Query) => Promise<Answer>): Promise<Answer> {
  const done = Promise.withResolvers<void>();
  // An input that says nothing and ends once the question is answered; an input that ended at once would close the session before it could be asked.
  const silence: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await done.promise;
        return { done: true, value: undefined };
      },
    }),
  };
  const session = query({ prompt: silence, options: { cwd, persistSession: false } });
  // Nobody reads what it says of itself, and output left unread stalls the process that writes it.
  const drained = (async () => {
    for await (const message of session) void message;
  })().catch(() => undefined);
  try {
    await session.initializationResult();
    return await ask(session);
  } finally {
    done.resolve();
    session.close();
    await drained;
  }
}

// What a failed result says went wrong is its own errors, never the answer an earlier turn in the same process left behind.
export function resultError(subtype: string, errors: string[]): ClaudeError {
  if (subtype === "error_max_turns") return { kind: "turn-limit" };
  const text = errors.join("\n");
  return detectClaudeError(text) ?? { kind: "ended", subtype, text };
}

function failure(error: unknown, stderr: string): ClaudeError {
  const said = stderr.trim();
  const message = said ? `${errorMessage(error)}. stderr: ${said}` : errorMessage(error);
  return detectClaudeError(message) ?? { kind: "could-not-run", message };
}
