import type { Say } from "../i18n/index.ts";

export const MAX_QUEUE_DEPTH = 5;

export type QueueOutcome = { kind: "run-now" } | { kind: "queued"; ahead: number } | { kind: "full" };

interface Ticket {
  started: boolean;
  cancelled: boolean;
}

interface Lane {
  chain: Promise<void>;
  tickets: Ticket[];
}

export function describeQueued(say: Say, ahead: number): string {
  return say("queue.behind", { count: ahead });
}

export function describeDepth(say: Say, depth: number): string {
  if (depth === 0) return say("common.nothingRunning");
  if (depth === 1) return say("queue.runningAlone");
  return say("queue.runningWith", { count: depth - 1 });
}

export function describeFull(say: Say): string {
  return say("queue.full", { limit: MAX_QUEUE_DEPTH, queued: MAX_QUEUE_DEPTH - 1 });
}

// One lane per conversation, so messages run in order instead of being dropped mid-turn.
export class TurnQueue {
  private readonly lanes = new Map<string, Lane>();

  // A dropped message keeps its place in the lane until the turn ahead of it ends, and counts for nothing meanwhile.
  depth(key: string): number {
    return this.lanes.get(key)?.tickets.filter((ticket) => !ticket.cancelled).length ?? 0;
  }

  total(): number {
    let sum = 0;
    for (const key of this.lanes.keys()) sum += this.depth(key);
    return sum;
  }

  keys(): string[] {
    return [...this.lanes.keys()];
  }

  // True from the moment a lane's work begins until it is done, which is longer than the turn inside it is running.
  hasStarted(key: string): boolean {
    return this.lanes.get(key)?.tickets.some((ticket) => ticket.started) ?? false;
  }

  admit(key: string): QueueOutcome {
    const waiting = this.depth(key);
    if (waiting === 0) return { kind: "run-now" };
    if (waiting >= MAX_QUEUE_DEPTH) return { kind: "full" };
    return { kind: "queued", ahead: waiting };
  }

  // Whatever has not started is skipped; the turn in flight is the caller's to stop.
  drain(key: string): number {
    const lane = this.lanes.get(key);
    if (!lane) return 0;
    const dropped = lane.tickets.filter((ticket) => !ticket.started && !ticket.cancelled);
    for (const ticket of dropped) ticket.cancelled = true;
    return dropped.length;
  }

  // Resolves true once the work ran, false when a drain skipped it.
  async enqueue(key: string, work: () => Promise<void>): Promise<boolean> {
    const lane = this.lanes.get(key) ?? { chain: Promise.resolve(), tickets: [] };
    const ticket: Ticket = { started: false, cancelled: false };
    lane.tickets.push(ticket);
    this.lanes.set(key, lane);

    const mine = lane.chain
      .then(async () => {
        if (ticket.cancelled) return false;
        ticket.started = true;
        await work();
        return true;
      })
      .finally(() => {
        lane.tickets.splice(lane.tickets.indexOf(ticket), 1);
        if (lane.tickets.length === 0) this.lanes.delete(key);
      });
    // The lane swallows failures so later turns still run; the caller still sees its own.
    lane.chain = mine.then(
      () => undefined,
      () => undefined,
    );

    return await mine;
  }
}
