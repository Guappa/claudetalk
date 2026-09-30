export interface CompactMetadata {
  trigger: "manual" | "auto";
  pre_tokens: number;
  post_tokens: number;
  cumulative_dropped_tokens: number;
  duration_ms: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface InitEvent {
  type: "system";
  subtype: "init";
  model: string;
  terminal_slash_commands: string[];
  skills: string[];
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; content: unknown };

export interface BackgroundTask {
  task_id: string;
  ambient?: boolean;
}

export type ClaudeEvent =
  | InitEvent
  | { type: "system"; subtype: "status"; status: string | null; compact_result?: string }
  | { type: "system"; subtype: "compact_boundary"; compact_metadata: CompactMetadata }
  | { type: "system"; subtype: "background_tasks_changed"; tasks: BackgroundTask[] }
  | { type: "system"; subtype: "task_notification"; status: string }
  | { type: "system"; subtype: string }
  | { type: "assistant"; message: { content: ContentBlock[] }; parent_tool_use_id?: string | null }
  | { type: "user"; message: { content: ContentBlock[] }; parent_tool_use_id?: string | null }
  | { type: "rate_limit_event"; rate_limit_info: unknown }
  | { type: "result"; subtype: string; is_error: boolean; total_cost_usd: number; result?: string; usage: TokenUsage };

export function isInit(event: ClaudeEvent): event is InitEvent {
  return event.type === "system" && event.subtype === "init";
}

export function isCompactionStart(event: ClaudeEvent): boolean {
  return (
    event.type === "system" &&
    event.subtype === "status" &&
    "status" in event &&
    event.status === "compacting"
  );
}

// A task the previous process left running is reported once, by the next process to resume the session.
export function isOrphanReport(event: ClaudeEvent): boolean {
  return event.type === "system" && event.subtype === "task_notification" && "status" in event && event.status === "stopped";
}

// Ambient tasks are watchers, not work; only real work keeps a turn's input open.
export function liveBackgroundTasks(event: ClaudeEvent): number | null {
  if (event.type !== "system" || event.subtype !== "background_tasks_changed" || !("tasks" in event)) return null;
  return event.tasks.filter((task) => !task.ambient).length;
}

export type AgentOutcome = "completed" | "failed" | "stopped";

export type AgentEvent =
  | { kind: "started"; taskId: string; toolUseId: string | null; description: string; agentType: string }
  | { kind: "progress"; taskId: string; activity: string; toolUses: number; tokens: number }
  | { kind: "ended"; taskId: string; outcome: AgentOutcome; toolUses: number | null; tokens: number | null; durationMs: number | null };

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const usageOf = (value: unknown): { tool_uses?: number; total_tokens?: number; duration_ms?: number } =>
  typeof value === "object" && value !== null ? value : {};

// The stream reports every task; an agent is one a reader follows by name, a background command is not.
export function agentEvent(event: ClaudeEvent): AgentEvent | null {
  if (event.type !== "system") return null;
  const fields = event as unknown as Record<string, unknown>;
  const taskId = text(fields.task_id);
  if (!taskId) return null;
  const usage = usageOf(fields.usage);

  if (event.subtype === "task_started") {
    if (fields.task_type !== "local_agent") return null;
    return {
      kind: "started",
      taskId,
      toolUseId: text(fields.tool_use_id) || null,
      description: text(fields.description),
      agentType: text(fields.subagent_type) || "agent",
    };
  }
  if (event.subtype === "task_progress") {
    return {
      kind: "progress",
      taskId,
      activity: text(fields.description),
      toolUses: usage.tool_uses ?? 0,
      tokens: usage.total_tokens ?? 0,
    };
  }
  if (event.subtype === "task_notification") {
    const status = text(fields.status);
    return {
      kind: "ended",
      taskId,
      outcome: status === "completed" || status === "failed" ? status : "stopped",
      toolUses: usage.tool_uses ?? null,
      tokens: usage.total_tokens ?? null,
      durationMs: usage.duration_ms ?? null,
    };
  }
  return null;
}

// Set on everything an agent says or does; null or absent on the session's own messages.
export function parentToolUseId(event: ClaudeEvent): string | null {
  if (event.type !== "assistant" && event.type !== "user") return null;
  return event.parent_tool_use_id ?? null;
}

export function compactMetadata(event: ClaudeEvent): CompactMetadata | null {
  if (event.type === "system" && event.subtype === "compact_boundary" && "compact_metadata" in event) {
    return event.compact_metadata;
  }
  return null;
}
