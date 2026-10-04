import type { Delivery } from "./messageSink.ts";

// Whether the person a turn works for has been away from it long enough that its next call on them should reach them, not only be shown.
export class Attention {
  private readonly afterMs: number;
  private readonly now: () => number;
  private lastSeen: number;

  constructor(afterMs: number, now: () => number = Date.now) {
    this.afterMs = afterMs;
    this.now = now;
    this.lastSeen = now();
  }

  seen(): void {
    this.lastSeen = this.now();
  }

  away(): boolean {
    return this.afterMs > 0 && this.now() - this.lastSeen >= this.afterMs;
  }

  // An answer a person gave says they are back; one that timed out or died with the turn says nothing about them.
  async calling<T>(ask: (delivery: Delivery) => Promise<T>, byPerson: (answer: T) => boolean): Promise<T> {
    const answer = await ask({ notify: this.away() });
    if (byPerson(answer)) this.seen();
    return answer;
  }
}
