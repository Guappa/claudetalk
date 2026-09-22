import type { TokenUsage } from "./events.ts";

export interface UsageTotals {
  turns: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  lastCostUsd: number | null;
}

export interface TurnCost {
  usage?: TokenUsage;
  sessionCostUsd?: number;
  startedHere?: boolean;
}

function empty(): UsageTotals {
  return { turns: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, lastCostUsd: null };
}

// Claude Code reports a running total for the conversation, not a price per turn, so a turn's cost is a difference.
function add(totals: UsageTotals, turn: TurnCost): UsageTotals {
  const usage = turn.usage;
  const reported = turn.sessionCostUsd;
  // A resumed conversation's first result already carries earlier turns, and a crashed one can report zero.
  const known = reported !== undefined && reported >= totals.costUsd && (totals.turns > 0 || turn.startedHere === true);
  return {
    turns: totals.turns + 1,
    costUsd: reported !== undefined && reported > totals.costUsd ? reported : totals.costUsd,
    inputTokens: totals.inputTokens + (usage?.input_tokens ?? 0),
    outputTokens: totals.outputTokens + (usage?.output_tokens ?? 0),
    cachedTokens:
      totals.cachedTokens + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
    lastCostUsd: known ? reported - totals.costUsd : null,
  };
}

export class UsageLedger {
  private readonly bySession = new Map<string, UsageTotals>();
  private readonly startedAt = new Date();

  since(): Date {
    return this.startedAt;
  }

  record(sessionId: string, turn: TurnCost): void {
    this.bySession.set(sessionId, add(this.bySession.get(sessionId) ?? empty(), turn));
  }

  // Resuming can mint a new session id, and the spend belongs to the conversation rather than the id.
  migrate(from: string, to: string): void {
    const totals = this.bySession.get(from);
    if (!totals || from === to) return;
    this.bySession.delete(from);
    const existing = this.bySession.get(to);
    this.bySession.set(to, existing ? continueAs(existing, totals) : totals);
  }

  forSession(sessionId: string): UsageTotals {
    return this.bySession.get(sessionId) ?? empty();
  }

  total(): UsageTotals {
    let totals = empty();
    for (const session of this.bySession.values()) totals = merge(totals, session);
    return totals;
  }
}

function merge(left: UsageTotals, right: UsageTotals): UsageTotals {
  return {
    turns: left.turns + right.turns,
    costUsd: left.costUsd + right.costUsd,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    lastCostUsd: right.lastCostUsd ?? left.lastCostUsd,
  };
}

// The same conversation under two ids has one running total, so the larger stands rather than the sum.
function continueAs(earlier: UsageTotals, later: UsageTotals): UsageTotals {
  return { ...merge(earlier, later), costUsd: Math.max(earlier.costUsd, later.costUsd) };
}
