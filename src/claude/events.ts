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

export type ClaudeEvent =
  | InitEvent
  | { type: "system"; subtype: "status"; status: string | null; compact_result?: string }
  | { type: "system"; subtype: "compact_boundary"; compact_metadata: CompactMetadata }
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

export function compactMetadata(event: ClaudeEvent): CompactMetadata | null {
  if (event.type === "system" && event.subtype === "compact_boundary" && "compact_metadata" in event) {
    return event.compact_metadata;
  }
  return null;
}
