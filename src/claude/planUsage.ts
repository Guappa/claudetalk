import type { Say } from "../i18n/index.ts";

export interface PlanWindow {
  utilization: number;
  resetsAt: number;
}

export interface PlanUsageSnapshot {
  windows: Map<string, PlanWindow>;
  seenAt: Date;
}

const WINDOW_LABELS = {
  five_hour: "usage.fiveHour",
  seven_day: "usage.weekAll",
  seven_day_opus: "usage.weekOpus",
  seven_day_sonnet: "usage.weekSonnet",
} as const;

// A window Claude Code adds later is still shown, under the name it was reported by.
function windowLabel(say: Say, name: string): string {
  return Object.hasOwn(WINDOW_LABELS, name) ? say(WINDOW_LABELS[name as keyof typeof WINDOW_LABELS]) : name.replace(/_/g, " ");
}

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

export function describePlanUsage(say: Say, snapshot: PlanUsageSnapshot | null): string {
  if (!snapshot) return say("usage.notReported");
  const windows = [...snapshot.windows].map(([name, window]) =>
    say("usage.window", {
      label: windowLabel(say, name),
      percent: Math.round(window.utilization * 100),
      when: `<t:${window.resetsAt}:R>`,
    }),
  );
  return say("usage.plan", {
    windows: windows.join(" · "),
    when: `<t:${Math.floor(snapshot.seenAt.getTime() / 1000)}:R>`,
  });
}
