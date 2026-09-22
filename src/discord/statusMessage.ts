import { redactHome } from "../displayPath.ts";
import { count, truncate } from "../text.ts";
import type { MessageSink, SinkAction } from "./messageSink.ts";

const MAX_NOTES_SHOWN = 6;
// Discord caps a message at 2000, and the log has to stay under it however long a turn runs.
const RENDER_BUDGET = 1800;
const MAX_NOTES_KEPT = 30;
// Discord clears the typing indicator after about ten seconds.
const TYPING_MS = 8000;

export function formatElapsed(ms: number): string {
  const seconds = Math.max(Math.round(ms / 1000), 0);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// Every tick is an edit against Discord, and a long turn does not need second-by-second precision.
export function tickIntervalMs(elapsedMs: number): number {
  if (elapsedMs < 60_000) return 2000;
  if (elapsedMs < 300_000) return 5000;
  return 15_000;
}

// A count, not a list: it shows the turn is getting somewhere without naming every tool it touches.
function heading(elapsedMs: number, steps: number, done = false): string {
  const verb = done ? "Worked" : "Working";
  return steps > 0
    ? `**${verb}** ${formatElapsed(elapsedMs)} · ${count(steps, "step")}`
    : `**${verb}** ${formatElapsed(elapsedMs)}`;
}

export function renderActivity(notes: string[], elapsedMs: number, steps = 0, done = false): string {
  const head = heading(elapsedMs, steps, done);
  if (notes.length === 0) return head;

  const shown: string[] = [];
  let used = head.length;
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index]!;

    if (shown.length >= MAX_NOTES_SHOWN) {
      shown.unshift("...");
      break;
    }

    if (used + note.length + 2 > RENDER_BUDGET) {
      // A remark is shown whole or not at all, unless it alone is larger than the whole budget.
      if (shown.length === 0) shown.push(truncate(note, RENDER_BUDGET - used - 5));
      else shown.unshift("...");
      break;
    }

    shown.unshift(note);
    used += note.length + 2;
  }
  return `${head}\n\n${shown.join("\n\n")}`;
}

function oneLine(text: string): string {
  return truncate(redactHome(text).replace(/\s+/g, " ").trim(), RENDER_BUDGET);
}

export class StatusMessage {
  private notes: string[] = [];
  private steps = 0;
  private timer: NodeJS.Timeout | null = null;
  private typingTimer: NodeJS.Timeout | null = null;
  private pendingEdit: Promise<void> = Promise.resolve();
  private lastSent = "";
  private startedAt = 0;
  private stopped = false;
  private readonly sink: MessageSink;
  private readonly now: () => number;
  private readonly actions: SinkAction[];

  constructor(sink: MessageSink, now: () => number = Date.now, actions: SinkAction[] = []) {
    this.sink = sink;
    this.now = now;
    this.actions = actions;
  }

  async start(): Promise<void> {
    this.startedAt = this.now();
    this.lastSent = renderActivity(this.notes, 0, this.steps);
    await this.sink.send(this.lastSent);
    if (this.actions.length > 0) await this.sink.edit(this.lastSent, this.actions).catch(() => undefined);
    this.sink.typing?.();
    this.typingTimer = setInterval(() => this.sink.typing?.(), TYPING_MS);
    this.typingTimer.unref();
    this.schedule();
  }

  stepped(count: number): void {
    this.steps += count;
  }

  note(text: string): void {
    const flat = oneLine(text);
    if (!flat) return;
    this.notes.push(flat);
    if (this.notes.length > MAX_NOTES_KEPT) this.notes.shift();
  }

  // A status Claude Code repeats every few seconds should read as one line, not a growing column.
  noteOnce(text: string): void {
    if (this.notes.at(-1) === oneLine(text)) return;
    this.note(text);
  }

  hasNotes(): boolean {
    return this.notes.length > 0;
  }

  // The last thing said is the answer, which is about to be posted in full beneath the trail.
  dropEcho(answer: string): void {
    const flat = oneLine(answer);
    if (!flat) return;

    while (this.notes.length > 0) {
      const last = this.notes[this.notes.length - 1]!;
      const probe = last.endsWith("...") ? last.slice(0, -3) : last;
      if (!probe || !flat.includes(probe)) break;
      this.notes.pop();
    }
  }

  // Leaves the trail in place, marked finished, so the answer can arrive beneath it.
  async settle(): Promise<void> {
    this.stop();
    await this.pendingEdit;
    await this.sink.edit(renderActivity(this.notes, this.now() - this.startedAt, this.steps, true), []);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.typingTimer) clearInterval(this.typingTimer);
    this.timer = null;
    this.typingTimer = null;
  }

  async finish(text: string): Promise<void> {
    this.stop();
    await this.pendingEdit;
    await this.sink.edit(text, []);
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), tickIntervalMs(this.now() - this.startedAt));
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;

    const text = renderActivity(this.notes, this.now() - this.startedAt, this.steps);
    if (text !== this.lastSent) {
      this.lastSent = text;
      // A failed edit (rate limit, message deleted) must not take the turn down with it.
      this.pendingEdit = this.sink.edit(text, this.actions).catch(() => undefined);
      await this.pendingEdit;
    }
    this.schedule();
  }
}
