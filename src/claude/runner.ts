import { spawn } from "node:child_process";
import { query, type Options, type Query } from "@anthropic-ai/claude-agent-sdk";
import { killTree, turnSpawnOptions } from "../platform.ts";
import { outboxRelative } from "../discord/outbox.ts";
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
}

export type ToolDecision = { allow: true } | { allow: false; reason: string };
export type ApproveTool = (toolName: string, input: Record<string, unknown>) => Promise<ToolDecision>;

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
}

interface TurnOutcome {
  text: string;
  sessionId?: string;
  usage?: TokenUsage;
  // The context as it stood on the turn's last model call; usage above sums every call in the turn.
  contextUsage?: TokenUsage;
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

  if (!gates.approve || UNGATED_TOOLS.has(toolName)) return { continue: true };
  const decision = await gates.approve(toolName, toolInput);
  return decision.allow ? allowed("Approved from Discord.") : denied(decision.reason);
}

// A permission mode cannot hold the gate: the host's own allow rules are consulted first, a hook is not.
export function gate(gates: Gates): NonNullable<Options["hooks"]> {
  return {
    PreToolUse: [
      {
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

const RESTART = Symbol("restart");

async function consumeStream(
  held: HeldPrompt,
  options: Options,
  abort: AbortController,
  live: Live,
  onEvent: (event: ClaudeEvent) => void,
): Promise<TurnResult | typeof RESTART> {
  const outcome: TurnOutcome = { text: "" };

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
      held.observe(message as unknown as ClaudeEvent);
      if (held.needsRestart) {
        abort.abort();
        return RESTART;
      }
      onEvent(message as unknown as ClaudeEvent);

      const reported = (message as { session_id?: string }).session_id;
      if (reported) outcome.sessionId = reported;

      if (message.type === "assistant") {
        const modelCall = messageUsage(message.message.usage);
        if (modelCall) outcome.contextUsage = modelCall;
      }

      if (message.type === "result") {
        if ("result" in message && message.result) outcome.text = String(message.result);
        outcome.usage = message.usage as unknown as TokenUsage;
        outcome.sessionCostUsd = message.total_cost_usd;
        // An interrupted turn ends as an error, but a message still waiting makes it the start of the next, not a failure.
        if (message.is_error && !held.awaitsUntaken) {
          return { ...outcome, ok: false, error: resultError(message.subtype, "errors" in message ? message.errors : []) };
        }
      }
    }
  } catch (error) {
    if (held.needsRestart) return RESTART;
    if (abort.signal.aborted) {
      return { ...outcome, ok: false, error: { kind: "stopped" } };
    }
    return { ...outcome, ok: false, error: failure(error) };
  }

  return { ...outcome, ok: true };
}

const ORPHAN_TWICE: TurnResult = { text: "", ok: false, error: { kind: "orphan-twice" } };

export interface RunningTurn {
  stop: () => void;
  // Stops tasks inside the turn and leaves the turn running; a cloud task is closed down where it runs.
  stopTasks: (taskIds: string[]) => Promise<void>;
  // Hands the running turn another message, taken up at its next step; null when it is past taking one.
  handOver: (text: string) => string | null;
  // Cuts short what the turn is doing, so a message still waiting runs at once; resolves to those still waiting.
  interrupt: () => Promise<string[]>;
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
  if (request.approve || request.askQuestions) options.hooks = gate(request);

  // Spawning it ourselves is the only way to learn the pid, and stopping a turn means its whole tree.
  let pid: number | undefined;
  options.spawnClaudeCodeProcess = (spawnOptions) => {
    const child = spawn(spawnOptions.command, spawnOptions.args, {
      ...turnSpawnOptions(spawnOptions.cwd ?? request.cwd),
      env: spawnOptions.env,
      signal: spawnOptions.signal,
    });
    pid = child.pid;
    return child;
  };

  const start = (): Attempt => {
    const held = new HeldPrompt(request.prompt);
    const abort = new AbortController();
    const live: Live = { query: null };
    return { held, abort, live, done: consumeStream(held, options, abort, live, onEvent) };
  };

  let attempt = start();
  let stopped = false;

  // A process that met an orphaned task is thrown away before the prompt goes out, and a fresh one gets the turn.
  const done = attempt.done.then(async (result) => {
    if (result !== RESTART) return result;
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

  const interrupt = async (): Promise<string[]> => {
    const receipt = await attempt.live.query?.interrupt().catch(() => undefined);
    return receipt?.still_queued ?? [];
  };

  return { stop, stopTasks, handOver, interrupt, done };
}

// What a failed result says went wrong is its own errors, never the answer an earlier turn in the same process left behind.
export function resultError(subtype: string, errors: string[]): ClaudeError {
  const text = errors.join("\n");
  return detectClaudeError(text) ?? { kind: "ended", subtype, text };
}

function failure(error: unknown): ClaudeError {
  const message = error instanceof Error ? error.message : String(error);
  return detectClaudeError(message) ?? { kind: "could-not-run", message };
}
