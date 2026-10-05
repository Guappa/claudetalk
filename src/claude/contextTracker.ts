export type WarningLevel = "approaching" | "critical";

export interface Warning {
  level: WarningLevel;
  percent: number;
}

// The session's own account of itself: what it holds, and where it compacts, or where its window ends when it does not.
export interface ContextReport {
  usedTokens: number;
  ceilingTokens: number;
}

export interface ContextStanding {
  percent: number;
  ceilingTokens: number;
}

const APPROACHING = 0.75;
const CRITICAL = 0.9;

const fullness = (report: ContextReport): number => Math.min(Math.round((report.usedTokens / report.ceilingTokens) * 100), 99);

export class ContextTracker {
  private readonly fired = new Set<WarningLevel>();
  private latest: ContextReport | null = null;

  // A compaction empties the session, so both warnings are due again and the last measure describes what is gone.
  reset(): void {
    this.fired.clear();
    this.latest = null;
  }

  // Null until a turn has been measured.
  standing(): ContextStanding | null {
    return this.latest ? { percent: fullness(this.latest), ceilingTokens: this.latest.ceilingTokens } : null;
  }

  observe(report: ContextReport): Warning | null {
    this.latest = report;
    const share = report.usedTokens / report.ceilingTokens;

    const level: WarningLevel | null = share >= CRITICAL ? "critical" : share >= APPROACHING ? "approaching" : null;
    if (!level || this.fired.has(level)) return null;
    this.fired.add(level);

    return { level, percent: fullness(report) };
  }
}

// One tracker per conversation, made when its first turn starts.
export class ContextTrackers {
  private readonly bySession = new Map<string, ContextTracker>();

  trackerFor(sessionId: string): ContextTracker {
    const existing = this.bySession.get(sessionId);
    if (existing) return existing;
    const created = new ContextTracker();
    this.bySession.set(sessionId, created);
    return created;
  }

  standing(sessionId: string): ContextStanding | null {
    return this.bySession.get(sessionId)?.standing() ?? null;
  }
}
