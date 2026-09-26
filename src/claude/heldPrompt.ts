import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { isInit, isOrphanReport, liveBackgroundTasks, type ClaudeEvent } from "./events.ts";

// Long enough for the follow-up turn a finished task triggers to announce itself before the input is closed.
const FOLLOW_UP_GRACE_MS = 3_000;

// The CLI serves hooks and permissions only while its input is open, and a background command outlives the first answer.
export class HeldPrompt {
  private readonly prompt: string;
  private readonly grace: number;
  private outstanding = 0;
  private answered = false;
  private modelSpoke = false;
  private restart = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly started: Promise<void>;
  private readonly start: () => void;
  private readonly released: Promise<void>;
  private readonly release: () => void;

  constructor(prompt: string, grace = FOLLOW_UP_GRACE_MS) {
    this.prompt = prompt;
    this.grace = grace;
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

  // The CLI reports an orphan before it answers the initialize handshake, so a prompt sent after it is safe.
  ready(): void {
    this.start();
  }

  async *stream(): AsyncGenerator<SDKUserMessage> {
    await this.started;
    if (this.restart) return;
    yield { type: "user", message: { role: "user", content: this.prompt }, parent_tool_use_id: null, session_id: "" };
    await this.released;
  }

  observe(event: ClaudeEvent): void {
    if (isOrphanReport(event) && !this.modelSpoke) {
      this.restart = true;
      this.close();
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
      if (this.answered && live === 0) this.releaseAfterGrace();
      return;
    }
    if (event.type === "result") {
      this.answered = true;
      if (this.outstanding === 0) this.close();
    }
  }

  close(): void {
    this.clearTimer();
    this.start();
    this.release();
  }

  private releaseAfterGrace(): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.close(), this.grace);
    this.timer.unref();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
