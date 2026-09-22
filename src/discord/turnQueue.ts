import { count } from "../text.ts";

export const MAX_QUEUE_DEPTH = 5;

export type QueueOutcome =
  | { kind: "run-now" }
  | { kind: "queued"; ahead: number }
  | { kind: "full"; message: string };

interface Ticket {
  started: boolean;
  cancelled: boolean;
}

interface Lane {
  chain: Promise<void>;
  tickets: Ticket[];
}

export function describeQueued(ahead: number): string {
  return ahead === 1
    ? "Queued behind the message still running."
    : `Queued behind ${ahead} messages.`;
}

export function describeDepth(depth: number): string {
  if (depth === 0) return "Nothing is running here.";
  if (depth === 1) return "One turn is running, with nothing queued behind it.";
  return `One turn is running, with ${count(depth - 1, "message")} queued behind it.`;
}

// One lane per conversation, so messages run in order instead of being dropped mid-turn.
export class TurnQueue {
  private readonly lanes = new Map<string, Lane>();

  depth(key: string): number {
    return this.lanes.get(key)?.tickets.length ?? 0;
  }

  admit(key: string): QueueOutcome {
    const waiting = this.depth(key);
    if (waiting === 0) return { kind: "run-now" };
    if (waiting >= MAX_QUEUE_DEPTH) {
      return {
        kind: "full",
        message:
          `This conversation already holds ${MAX_QUEUE_DEPTH} messages: one running and ` +
          `${MAX_QUEUE_DEPTH - 1} queued behind it. Let it catch up, or run \`/stop\` to drop the one ` +
          `in flight and everything queued behind it.`,
      };
    }
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
