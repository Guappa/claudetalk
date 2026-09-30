export const PENDING_TTL_MS = 10 * 60_000;

export interface PendingCreate {
  name: string;
  cwd: string;
  categoryId?: string;
}

// A button carries at most 100 characters of id, which a name and a path, or a command's arguments, do not fit inside.
export class Pending<Held> {
  private readonly byMessage = new Map<string, { request: Held; at: number }>();

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  remember(messageId: string, request: Held): void {
    this.sweep();
    this.byMessage.set(messageId, { request, at: this.now() });
  }

  take(messageId: string): Held | null {
    const entry = this.byMessage.get(messageId);
    this.byMessage.delete(messageId);
    if (!entry) return null;
    return this.now() - entry.at > PENDING_TTL_MS ? null : entry.request;
  }

  private sweep(): void {
    for (const [messageId, entry] of this.byMessage) {
      if (this.now() - entry.at > PENDING_TTL_MS) this.byMessage.delete(messageId);
    }
  }
}

export class PendingCreates extends Pending<PendingCreate> {}
