import { randomUUID } from "node:crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { isInit, isOrphanReport, liveBackgroundTasks, takenUp, type ClaudeEvent } from "./events.ts";

// Long enough for the follow-up turn a finished task triggers to announce itself before the input is closed.
const FOLLOW_UP_GRACE_MS = 3_000;
// A message handed over but never taken up must not hold the input open for good.
const UNTAKEN_GRACE_MS = 15_000;

// The CLI serves hooks and permissions only while its input is open, and a background command outlives the first answer.
export class HeldPrompt {
  private readonly prompt: string;
  private readonly grace: number;
  private readonly untakenGrace: number;
  private outstanding = 0;
  private answered = false;
  private modelSpoke = false;
  private restart = false;
  private closed = false;
  private timer: NodeJS.Timeout | null = null;
  // Messages handed over while the turn runs, and the ones among them the session has not taken up yet.
  private readonly unsent: SDKUserMessage[] = [];
  private readonly untaken = new Set<string>();
  private arrival = Promise.withResolvers<void>();
  private readonly started: Promise<void>;
  private readonly start: () => void;
  private readonly released: Promise<void>;
  private readonly release: () => void;

  constructor(prompt: string, grace = FOLLOW_UP_GRACE_MS, untakenGrace = UNTAKEN_GRACE_MS) {
    this.prompt = prompt;
    this.grace = grace;
    this.untakenGrace = untakenGrace;
    const startGate = Promise.withResolvers<void>();
    this.started = startGate.promise;
    this.start = startGate.resolve;
    const releaseGate = Promise.withResolvers<void>();
    this.released = releaseGate.promise;
    this.release = releaseGate.resolve;
  }

  // A process that opens by reporting an orphaned task cancels every tool call afterwards; only a fresh one is clean.
  get needsRestart(): boolean {
    return this.restart;
  }

  // True while a message handed over is still to be answered, so a turn that ends early is not the end.
  get awaitsUntaken(): boolean {
    return this.untaken.size > 0;
  }

  // The CLI reports an orphan before it answers the initialize handshake, so a prompt sent after it is safe.
  ready(): void {
    this.start();
  }

  // Null when the turn can no longer take it: not yet under way, or already letting go of its input.
  handOver(text: string): string | null {
    if (this.closed || this.restart || !this.modelSpoke) return null;
    const uuid = randomUUID();
    this.untaken.add(uuid);
    this.unsent.push({ ...userMessage(text), uuid, priority: "next" });
    this.clearTimer();
    this.arrival.resolve();
    return uuid;
  }

  async *stream(): AsyncGenerator<SDKUserMessage> {
    await this.started;
    if (this.restart) return;
    yield userMessage(this.prompt);
    while (!this.closed) {
      await Promise.race([this.released, this.arrival.promise]);
      this.arrival = Promise.withResolvers<void>();
      while (this.unsent.length > 0) yield this.unsent.shift()!;
    }
  }

  observe(event: ClaudeEvent): void {
    if (isOrphanReport(event) && !this.modelSpoke) {
      this.restart = true;
      this.close();
      return;
    }
    const taken = takenUp(event);
    if (taken) {
      this.untaken.delete(taken);
      return;
    }
    if (event.type === "assistant") {
      this.modelSpoke = true;
      return;
    }
    if (isInit(event)) {
      this.answered = false;
      this.clearTimer();
      return;
    }
    const live = liveBackgroundTasks(event);
    if (live !== null) {
      this.outstanding = live;
      if (this.answered && live === 0 && !this.awaitsUntaken) this.closeAfter(this.grace);
      return;
    }
    if (event.type === "result") {
      this.answered = true;
      // A message still waiting runs as the next turn in this same process, so the input stays open for it.
      if (this.awaitsUntaken) this.closeAfter(this.untakenGrace);
      else if (this.outstanding === 0) this.close();
    }
  }

  close(): void {
    this.closed = true;
    this.clearTimer();
    this.start();
    this.release();
  }

  private closeAfter(ms: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.close(), ms);
    this.timer.unref();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

function userMessage(text: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "" };
}
