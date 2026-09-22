import type { SessionRecord } from "../../src/sessions/index.ts";
import type { TokenUsage } from "../../src/claude/events.ts";

export function record(over: Partial<SessionRecord> & { sessionId: string }): SessionRecord {
  return {
    name: null,
    cwd: null,
    lastActivity: null,
    transcriptPath: "",
    sizeBytes: 0,
    live: null,
    ...over,
  };
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export function usage(total: number): TokenUsage {
  return { input_tokens: total, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
}
