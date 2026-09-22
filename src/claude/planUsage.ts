export interface PlanWindow {
  utilization: number;
  resetsAt: number;
}

export interface PlanUsageSnapshot {
  windows: Map<string, PlanWindow>;
  seenAt: Date;
}

const WINDOW_LABELS: Record<string, string> = {
  five_hour: "5-hour window",
  seven_day: "week, all models",
  seven_day_opus: "week, Opus",
  seven_day_sonnet: "week, Sonnet",
};

function isWindow(value: unknown): value is PlanWindow {
  const record = value as { utilization?: unknown; resetsAt?: unknown } | null;
  return typeof record?.utilization === "number" && typeof record?.resetsAt === "number";
}

// The CLI reports either a unifiedWindows map or one window's fields at the top level.
export function parsePlanUsage(info: unknown): Map<string, PlanWindow> {
  const windows = new Map<string, PlanWindow>();
  if (!info || typeof info !== "object") return windows;

  const record = info as { unifiedWindows?: Record<string, unknown>; rateLimitType?: unknown };
  for (const [name, window] of Object.entries(record.unifiedWindows ?? {})) {
    if (isWindow(window)) windows.set(name, window);
  }
  if (windows.size === 0 && typeof record.rateLimitType === "string" && isWindow(info)) {
    windows.set(record.rateLimitType, { utilization: info.utilization, resetsAt: info.resetsAt });
  }
  return windows;
}

// Every turn reports the account's windows, so the last report is the current state.
export class PlanUsage {
  private readonly windows = new Map<string, PlanWindow>();
  private seenAt: Date | null = null;

  record(info: unknown, now = new Date()): void {
    const parsed = parsePlanUsage(info);
    if (parsed.size === 0) return;
    for (const [name, window] of parsed) this.windows.set(name, window);
    this.seenAt = now;
  }

  latest(): PlanUsageSnapshot | null {
    return this.seenAt ? { windows: new Map(this.windows), seenAt: this.seenAt } : null;
  }
}

export function describePlanUsage(snapshot: PlanUsageSnapshot | null): string {
  if (!snapshot) {
    return "Plan usage: not reported yet. Claude Code sends it with each turn, so it appears after the first one.";
  }
  const parts = [...snapshot.windows].map(([name, window]) => {
    const label = WINDOW_LABELS[name] ?? name.replace(/_/g, " ");
    return `${label} ${Math.round(window.utilization * 100)}% used, resets <t:${window.resetsAt}:R>`;
  });
  return `Plan usage: ${parts.join(" · ")} (as of <t:${Math.floor(snapshot.seenAt.getTime() / 1000)}:R>)`;
}
