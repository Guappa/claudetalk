import { spawn } from "node:child_process";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { killTree, turnSpawnOptions } from "../platform.ts";
import { outboxRelative } from "../discord/outbox.ts";
import { detectClaudeError, type ClaudeError } from "./errors.ts";
import type { ClaudeEvent, TokenUsage } from "./events.ts";
import { HeldPrompt } from "./heldPrompt.ts";
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
    "Think out loud as you go: before a step, and when something turns out differently than you",
    "expected, say so in a sentence. Those remarks show live while the turn runs and are the only",
    "sign of progress the reader gets, so silence reads as a hang.",
    "This conversation may also be open in a terminal here.",
  ].join(" ");
}

// Reading the working directory is what a turn is for; approving each read would make the gate unusable.
export const UNGATED_TOOLS = new Set(["Read", "Glob", "Grep", "TodoWrite", "NotebookRead"]);

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
  // No typed option covers autocompact, and extraArgs is the SDK's own escape hatch to the flag.
  if (settings.autocompact) options.extraArgs = { autocompact: settings.autocompact };
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
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: reason, updatedInput },
  };
}

function denied(reason: string): HookOutput {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}

interface Gates {
  approve?: ApproveTool;
  askQuestions?: AskQuestions;
}

// A permission mode cannot hold the gate: the host's own allow rules are consulted first, a hook is not.
function gate(gates: Gates): NonNullable<Options["hooks"]> {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            const toolName = String((input as { tool_name?: unknown }).tool_name ?? "");
            const toolInput = ((input as { tool_input?: unknown }).tool_input ?? {}) as Record<string, unknown>;

            if (toolName === QUESTION_TOOL && gates.askQuestions) {
              const outcome = await gates.askQuestions(parseQuestions(toolInput));
              return outcome.answered
                ? allowed("Answered from Discord.", { ...toolInput, answers: outcome.answers })
                : denied(outcome.reason);
            }

            if (!gates.approve || UNGATED_TOOLS.has(toolName)) return { continue: true };
            const decision = await gates.approve(toolName, toolInput);
            return decision.allow ? allowed("Approved from Discord.") : denied(decision.reason);
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
  onEvent: (event: ClaudeEvent) => void,
): Promise<TurnResult | typeof RESTART> {
  const outcome: TurnOutcome = { text: "" };

  try {
    const run = query({ prompt: held.stream(), options: { ...options, abortController: abort } });
    // Either outcome of the handshake lets the prompt go; a doomed process has already been marked by then.
    run.initializationResult().then(
      () => held.ready(),
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
        outcome.text = ("result" in message ? String(message.result ?? "") : "") || outcome.text;
        outcome.usage = message.usage as unknown as TokenUsage;
        outcome.sessionCostUsd = message.total_cost_usd;
        if (message.is_error) return { ...outcome, ok: false, error: resultError(message.subtype, outcome.text) };
      }
    }
  } catch (error) {
    if (held.needsRestart) return RESTART;
    if (abort.signal.aborted) {
      return { ...outcome, ok: false, error: { kind: "unknown", message: "The turn was stopped." } };
    }
    return { ...outcome, ok: false, error: failure(error) };
  }

  return { ...outcome, ok: true };
}

const ORPHAN_TWICE: TurnResult = {
  text: "",
  ok: false,
  error: {
    kind: "unknown",
    message:
      "Claude Code reported a background command left over from an earlier turn twice in a row, and a session " +
      "that starts by reporting one refuses every tool call. Send the message again; it normally clears on the next try.",
  },
};

export interface RunningTurn {
  stop: () => void;
  done: Promise<TurnResult>;
}

interface Attempt {
  held: HeldPrompt;
  abort: AbortController;
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
    return { held, abort, done: consumeStream(held, options, abort, onEvent) };
  };

  let attempt = start();
  let stopped = false;

  // A process that met an orphaned task is thrown away before the prompt goes out, and a fresh one gets the turn.
  const done = attempt.done.then(async (result) => {
    if (result !== RESTART) return result;
    if (stopped) return { text: "", ok: false, error: { kind: "unknown", message: "The turn was stopped." } } as TurnResult;
    attempt = start();
    const again = await attempt.done;
    return again === RESTART ? ORPHAN_TWICE : again;
  });

  const stop = (): void => {
    stopped = true;
    // Killing only the turn leaves whatever it was running alive, which is not what a stop means.
    if (pid !== undefined) killTree(pid);
    attempt.held.close();
    attempt.abort.abort();
  };

  return { stop, done };
}

function resultError(subtype: string, text: string): ClaudeError {
  return (
    detectClaudeError(text) ?? {
      kind: "unknown",
      message: `The turn ended as ${subtype}.${text ? `\n${text}` : ""} Try sending your message again.`,
    }
  );
}

function failure(error: unknown): ClaudeError {
  const message = error instanceof Error ? error.message : String(error);
  return (
    detectClaudeError(message) ?? {
      kind: "unknown",
      message:
        `Claude Code could not run this turn: ${message}. ` +
        `Check that it is installed and logged in on the host, then try again.`,
    }
  );
}
