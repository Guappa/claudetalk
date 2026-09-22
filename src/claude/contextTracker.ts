import type { TokenUsage } from "./events.ts";

export type WarningLevel = "approaching" | "critical";

export interface Warning {
  level: WarningLevel;
  message: string;
}

const APPROACHING = 0.75;
const CRITICAL = 0.9;

export class ContextTracker {
  private readonly fired = new Set<WarningLevel>();
  private ceiling: number | null;

  constructor(ceiling: number | null = null) {
    this.ceiling = ceiling;
  }

  // The only trustworthy sign of where this session compacts is where it last compacted.
  learnCeiling(preTokens: number): void {
    if (preTokens > 0) this.ceiling = Math.max(this.ceiling ?? 0, preTokens);
  }

  knownCeiling(): number | null {
    return this.ceiling;
  }

  reset(): void {
    this.fired.clear();
  }

  observe(usage: TokenUsage): Warning | null {
    if (!this.ceiling) return null;

    const usedTokens =
      usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
    const percent = usedTokens / this.ceiling;

    const level: WarningLevel | null =
      percent >= CRITICAL ? "critical" : percent >= APPROACHING ? "approaching" : null;
    if (!level || this.fired.has(level)) return null;
    this.fired.add(level);

    const rounded = Math.min(Math.round(percent * 100), 99);
    return {
      level,
      message:
        level === "critical"
          ? `Context is about ${rounded}% full. Run \`/compact\` soon, or it will compact on its own mid-task.`
          : `Context is about ${rounded}% full. \`/context\` shows the breakdown, \`/compact\` frees space.`,
    };
  }
}
