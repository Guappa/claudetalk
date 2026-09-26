import { redactHome } from "../displayPath.ts";
import { count, truncate } from "../text.ts";
import type { MessageSink, SinkAction } from "./messageSink.ts";
import { DISCORD_MESSAGE_LIMIT, chunkForDiscord } from "./renderer.ts";

const MAX_NOTES_SHOWN = 10;
// Discord caps a message at 2000, and the log has to stay under it however long a turn runs.
const RENDER_BUDGET = 1800;
// A single remark leaves room for the heading beside it; anything longer continues in the next message.
const NOTE_BUDGET = 1700;
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

interface Selection {
  shown: string[];
  elided: boolean;
}

// Newest first, as many as fit; a remark is shown whole or not at all, unless it alone is larger than the budget.
function selectShown(notes: string[], headLength: number): Selection {
  const shown: string[] = [];
  let used = headLength;
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index]!;
    if (shown.length >= MAX_NOTES_SHOWN) return { shown, elided: true };
    if (used + note.length + 2 > RENDER_BUDGET) {
      if (shown.length > 0) return { shown, elided: true };
      shown.push(truncate(note, RENDER_BUDGET - used - 5));
      return { shown, elided: false };
    }
    shown.unshift(note);
    used += note.length + 2;
  }
  return { shown, elided: false };
}

export function renderActivity(notes: string[], elapsedMs: number, steps = 0, done = false): string {
  const head = heading(elapsedMs, steps, done);
  if (notes.length === 0) return head;
  const { shown, elided } = selectShown(notes, head.length);
  if (elided) shown.unshift("...");
  return `${head}\n\n${shown.join("\n\n")}`;
}

// True when every remark would be shown whole.
function fitsInOne(notes: string[], elapsedMs: number, steps: number): boolean {
  const { shown, elided } = selectShown(notes, heading(elapsedMs, steps).length);
  return !elided && shown.length === notes.length && shown.every((note, index) => note === notes[index]);
}

// A remark keeps its paragraphs and code blocks, the way the terminal shows it; only stray blank lines go.
function tidy(text: string): string {
  return redactHome(text).replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Whitespace never decides whether two texts are the same remark.
function comparable(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// The trail reads in time order, like the terminal: a message is left as it stands once it is full or buried.
export class StatusMessage {
  private notes: string[] = [];
  private sealed = 0;
  private steps = 0;
  private timer: NodeJS.Timeout | null = null;
  private typingTimer: NodeJS.Timeout | null = null;
  private pendingEdit: Promise<void> = Promise.resolve();
  private lastSent = "";
  private startedAt = 0;
  private stopped = false;
  private moving = false;
  private readonly sink: MessageSink;
  private readonly now: () => number;
  private readonly actions: SinkAction[];
  private readonly onContinue: (() => Promise<void>) | undefined;
  private readonly finalize: (text: string) => Promise<string>;

  // finalize runs once per message when it is final, so a lookup per edit is never paid.
  constructor(
    sink: MessageSink,
    now: () => number = Date.now,
    actions: SinkAction[] = [],
    onContinue?: () => Promise<void>,
    finalize: (text: string) => Promise<string> = async (text) => text,
  ) {
    this.sink = sink;
    this.now = now;
    this.actions = actions;
    this.onContinue = onContinue;
    this.finalize = finalize;
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

  // A remark longer than a message is not cut short; it continues across as many as it needs.
  note(text: string): void {
    const clean = tidy(text);
    if (!clean) return;
    for (const piece of chunkForDiscord(clean, NOTE_BUDGET)) this.addNote(piece);
  }

  private addNote(piece: string): void {
    // While a move is still queued the sink reads as buried; the remarks meanwhile belong to that new message.
    const buried = this.sink.continueIn !== undefined && !this.moving && this.sink.isLatest?.() === false;
    if (buried) this.rollOver(this.notes);
    this.notes.push(piece);
    // Without a way to continue, the oldest remarks give way instead.
    if (!this.sink.continueIn && this.notes.length > MAX_NOTES_KEPT) this.notes.shift();
  }

  // Overflow moves at the next edit, not on arrival, so a remark that turns out to be the answer can still be taken back.
  private rollOverOverflow(): void {
    if (!this.sink.continueIn) return;
    const elapsed = this.now() - this.startedAt;
    while (this.notes.length > 1 && !fitsInOne(this.notes, elapsed, this.steps)) {
      const sealed = this.oldestThatFit();
      this.rollOver(sealed);
    }
  }

  // The oldest remarks that fill one message on their own; the newer ones carry on in the next.
  private oldestThatFit(): string[] {
    const sealed: string[] = [];
    let used = 0;
    for (const note of this.notes) {
      if (sealed.length > 0 && used + note.length + 2 > RENDER_BUDGET) break;
      sealed.push(note);
      used += note.length + 2;
    }
    return sealed.length < this.notes.length ? sealed : this.notes.slice(0, -1);
  }

  // A status Claude Code repeats every few seconds should read as one line, not a growing column.
  noteOnce(text: string): void {
    const last = this.notes.at(-1);
    if (last !== undefined && comparable(last) === comparable(tidy(text))) return;
    this.note(text);
  }

  hasNotes(): boolean {
    return this.notes.length > 0 || this.sealed > 0;
  }

  currentIsEmpty(): boolean {
    return this.notes.length === 0;
  }

  // The last thing said is the answer, which is about to be posted in full beneath the trail.
  dropEcho(answer: string): void {
    const flat = comparable(answer);
    if (!flat) return;

    while (this.notes.length > 0) {
      const last = comparable(this.notes[this.notes.length - 1]!);
      const probe = last.endsWith("...") ? last.slice(0, -3) : last;
      if (!probe || !flat.includes(probe)) break;
      this.notes.pop();
    }
  }

  // Leaves the trail in place, marked finished, so the answer can arrive beneath it.
  async settle(): Promise<void> {
    this.stop();
    this.rollOverOverflow();
    await this.pendingEdit;
    const trail = renderActivity(this.notes, this.now() - this.startedAt, this.steps, true);
    await this.sink.edit(await this.finalize(trail), []);
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

  // A segment that holds no remarks of its own carries the answer under its heading rather than a heading alone.
  async finishWithHeading(text: string): Promise<boolean> {
    const combined = `${heading(this.now() - this.startedAt, this.steps, true)}\n\n${text}`;
    if (combined.length > DISCORD_MESSAGE_LIMIT) return false;
    await this.finish(combined);
    return true;
  }

  // Whatever is queued against Discord has gone out; a turn ends only once that is true.
  async flush(): Promise<void> {
    await this.pendingEdit;
  }

  // The sealed remarks stay in the current message as they are; the heading and the button move to a new one below.
  private rollOver(sealed: string[]): void {
    this.notes = this.notes.slice(sealed.length);
    this.sealed += sealed.length;
    // A message with no remarks yet must not be left reading as live work, so it becomes a plain marker.
    const sealedText = sealed.length > 0 ? sealed.join("\n\n") : "**Started**";
    this.lastSent = "";
    this.moving = true;
    this.chain(async () => {
      try {
        await this.sink.edit(await this.finalize(sealedText), []);
        await this.sink.continueIn!(renderActivity(this.notes, this.now() - this.startedAt, this.steps), this.actions);
        await this.onContinue?.();
      } finally {
        this.moving = false;
      }
    });
  }

  // Edits go out one at a time, in order, and a failed one (rate limit, message deleted) never takes the turn down.
  private chain(work: () => Promise<void>): void {
    this.pendingEdit = this.pendingEdit.then(work).catch(() => undefined);
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), tickIntervalMs(this.now() - this.startedAt));
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;

    this.rollOverOverflow();
    const text = renderActivity(this.notes, this.now() - this.startedAt, this.steps);
    if (text !== this.lastSent) {
      this.lastSent = text;
      this.chain(() => this.sink.edit(text, this.actions));
      await this.pendingEdit;
    }
    this.schedule();
  }
}
