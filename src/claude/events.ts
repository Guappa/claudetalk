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
  | { type: "assistant"; message: { content: ContentBlock[] } }
  | { type: "user"; message: { content: ContentBlock[] } }
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

export function compactMetadata(event: ClaudeEvent): CompactMetadata | null {
  if (event.type === "system" && event.subtype === "compact_boundary" && "compact_metadata" in event) {
    return event.compact_metadata;
  }
  return null;
}
