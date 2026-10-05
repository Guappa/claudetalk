import { randomUUID } from "node:crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { isInit, isOrphanReport, liveBackgroundTasks, takenUp, type ClaudeEvent } from "./events.ts";

// Long enough for the follow-up turn a finished task triggers to announce itself before the input is closed.
const FOLLOW_UP_GRACE_MS = 3_000;
// A message handed over but never taken up must not hold the input open for good.
const UNTAKEN_GRACE_MS = 15_000;

// An image that travels inside a message, so the model sees it as it reads the words and spends no tool call fetching it.
export interface PromptImage {
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  base64: string;
}

// The CLI serves hooks and permissions only while its input is open, and a background command outlives the first answer.
export class HeldPrompt {
  private readonly prompt: string;
  private readonly images: PromptImage[];
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

  constructor(prompt: string, images: PromptImage[] = [], grace = FOLLOW_UP_GRACE_MS, untakenGrace = UNTAKEN_GRACE_MS) {
    this.prompt = prompt;
    this.images = images;
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
  handOver(text: string, images: PromptImage[] = []): string | null {
    if (this.closed || this.restart || !this.modelSpoke) return null;
    const uuid = randomUUID();
    this.untaken.add(uuid);
    this.unsent.push({ ...userMessage(text, images), uuid, priority: "next" });
    this.clearTimer();
    // Handed over after the answer, no result is on its way to start the clock on it.
    if (this.answered) this.dropUntakenAfter(this.untakenGrace);
    this.arrival.resolve();
    return uuid;
  }

  async *stream(): AsyncGenerator<SDKUserMessage> {
    await this.started;
    // Closed before the handshake is a turn stopped before it began, and the prompt must not reach a process that is still dying.
    if (this.restart || this.closed) return;
    yield userMessage(this.prompt, this.images);
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
      if (this.awaitsUntaken) this.dropUntakenAfter(this.untakenGrace);
      else if (this.outstanding === 0) this.close();
    }
  }

  close(): void {
    this.closed = true;
    this.clearTimer();
    this.start();
    this.release();
  }

  // A message the session never takes stops being a reason to hold the input; a command still running in the background goes on being one.
  private dropUntakenAfter(ms: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.untaken.clear();
      if (this.outstanding === 0) this.close();
    }, ms);
    this.timer.unref();
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

// A message with nothing to show stays the plain string it has always been; one with images names its text as the first part.
function userMessage(text: string, images: PromptImage[]): SDKUserMessage {
  const shown = images.map((image) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: image.mediaType, data: image.base64 },
  }));
  const content = shown.length === 0 ? text : [{ type: "text" as const, text }, ...shown];
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" };
}
