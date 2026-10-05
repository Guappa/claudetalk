import { redactHome } from "../displayPath.ts";
import type { Say } from "../i18n/index.ts";
import { truncate } from "../text.ts";
import type { MessageSink, SinkAction } from "./messageSink.ts";
import { forDiscord } from "./outgoing.ts";
import { DISCORD_MESSAGE_LIMIT } from "./limits.ts";
import { chunkForDiscord } from "./renderer.ts";
import { defuseStrayMarkup } from "./strayMarkup.ts";
import { convertTables } from "./tables.ts";

const MAX_NOTES_SHOWN = 10;
// Discord caps a message at 2000, and the log has to stay under it however long a turn runs.
const RENDER_BUDGET = 1800;
// A single remark leaves room for the heading beside it; anything longer continues in the next message.
const NOTE_BUDGET = 1700;
const MAX_NOTES_KEPT = 30;
// Discord clears the typing indicator after about ten seconds.
const TYPING_MS = 8000;
// The blank line under a heading, and the characters its elapsed time can grow by between measuring and sending.
const HEADING_SLACK = 12;

export function formatElapsed(say: Say, ms: number): string {
  const seconds = Math.max(Math.round(ms / 1000), 0);
  if (seconds < 60) return say("units.seconds", { seconds });
  return say("units.minutesSeconds", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
}

// Every tick is an edit against Discord, and a long turn does not need second-by-second precision.
export function tickIntervalMs(elapsedMs: number): number {
  if (elapsedMs < 60_000) return 2000;
  if (elapsedMs < 300_000) return 5000;
  return 15_000;
}

// The state a heading shows, at a glance.
export type Mood = "working" | "compacting" | "done" | "stopped" | "failed";
// What the heading says while the turn runs: at work, or compacting, which the terminal shows in place of its spinner.
export type LiveMood = "working" | "compacting";

// What became of an answer the trail may already hold: nothing of it was there, its remark was dropped from the live message, or it was already shown whole across sealed messages.
export type Echo = "none" | "dropped" | "shown";

// The state at a glance, in the heading only, standard Unicode only; the trail's one other emoji marks an agent sent out.
const EMOJI: Record<Mood, string> = {
  working: "⏳",
  compacting: "⏳",
  done: "✅",
  stopped: "⏹️",
  failed: "❌",
};

const HEADINGS = {
  working: "trail.working",
  compacting: "trail.compactingHeading",
  done: "trail.done",
  stopped: "trail.stopped",
  failed: "trail.failed",
} as const;

const HEADINGS_WITH_STEPS = {
  working: "trail.workingSteps",
  compacting: "trail.compactingSteps",
  done: "trail.doneSteps",
  stopped: "trail.stoppedSteps",
  failed: "trail.failedSteps",
} as const;

function heading(say: Say, elapsedMs: number, steps: number, mood: Mood = "working"): string {
  const elapsed = formatElapsed(say, elapsedMs);
  const words = steps > 0 ? say(HEADINGS_WITH_STEPS[mood], { elapsed, count: steps }) : say(HEADINGS[mood], { elapsed });
  return `${EMOJI[mood]} ${words}`;
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

// Whatever rides under the heading, the agents' tally for one, counts against the message like the heading does.
function headWith(say: Say, elapsedMs: number, steps: number, mood: Mood, extra: string): string {
  const head = heading(say, elapsedMs, steps, mood);
  return extra ? `${head}\n\n${extra}` : head;
}

export function renderActivity(
  say: Say,
  notes: string[],
  elapsedMs: number,
  steps = 0,
  mood: Mood = "working",
  extra = "",
): string {
  const head = headWith(say, elapsedMs, steps, mood, extra);
  if (notes.length === 0) return head;
  const { shown, elided } = selectShown(notes, head.length);
  if (elided) shown.unshift("...");
  return `${head}\n\n${shown.join("\n\n")}`;
}

// True when every remark would be shown whole.
function fitsInOne(say: Say, notes: string[], elapsedMs: number, steps: number, extra: string): boolean {
  const { shown, elided } = selectShown(notes, headWith(say, elapsedMs, steps, "working", extra).length);
  return !elided && shown.length === notes.length && shown.every((note, index) => note === notes[index]);
}

// A remark keeps its paragraphs and code blocks, the way the terminal shows it; only stray blank lines go.
function tidy(text: string): string {
  return redactHome(text)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Whitespace and the escapes the markup guard adds never decide whether two texts are the same remark.
function comparable(text: string): string {
  return text
    .replace(/\\([^0-9A-Za-z\s])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// The trail reads in time order, like the terminal: a message is left as it stands once it is full or buried.
export class StatusMessage {
  private notes: string[] = [];
  // Which remark each piece of the trail came from, and the remarks as they were said before being cut up and drawn.
  private origins: number[] = [];
  private readonly remarks: string[] = [];
  // Remarks a piece of which has been sealed into a finished message, where nothing can take it back.
  private readonly sealedOrigins = new Set<number>();
  private sealed = 0;
  private steps = 0;
  private timer: NodeJS.Timeout | null = null;
  private typingTimer: NodeJS.Timeout | null = null;
  private pendingEdit: Promise<void> = Promise.resolve();
  private lastSent = "";
  private startedAt = 0;
  private stopped = false;
  private moving = false;
  private live: LiveMood = "working";
  private readonly say: Say;
  private readonly sink: MessageSink;
  private readonly now: () => number;
  private readonly actions: () => SinkAction[];
  private readonly onContinue: (() => Promise<void>) | undefined;
  private readonly finalize: (text: string) => Promise<string>;
  private readonly extra: () => string;

  // finalize runs once per message when it is final, so a lookup per edit is never paid.
  constructor(
    say: Say,
    sink: MessageSink,
    now: () => number = Date.now,
    actions: () => SinkAction[] = () => [],
    onContinue?: () => Promise<void>,
    finalize: (text: string) => Promise<string> = async (text) => text,
    extra: () => string = () => "",
  ) {
    this.say = say;
    this.sink = sink;
    this.now = now;
    this.actions = actions;
    this.onContinue = onContinue;
    this.finalize = finalize;
    this.extra = extra;
  }

  async start(): Promise<void> {
    this.startedAt = this.now();
    this.lastSent = this.drawn(this.live);
    // One request: an edit with nothing to edit yet posts the message, controls and all.
    await this.sink.edit(this.lastSent, this.actions());
    this.sink.typing?.();
    this.typingTimer = setInterval(() => this.sink.typing?.(), TYPING_MS);
    this.typingTimer.unref();
    this.schedule();
  }

  stepped(count: number): void {
    this.steps += count;
  }

  // Drawn on the next tick, as the terminal swaps its spinner's words; the remarks are untouched.
  setLive(mood: LiveMood): void {
    this.live = mood;
  }

  // A remark longer than a message is not cut short; it continues across as many as it needs.
  note(text: string): void {
    const clean = tidy(text);
    if (!clean) return;
    const origin = this.remarks.push(clean) - 1;
    // Remarks share one message, so each is sealed on its own and none can reach into the next.
    for (const piece of chunkForDiscord(convertTables(clean), NOTE_BUDGET)) this.addNote(defuseStrayMarkup(piece), origin);
  }

  private addNote(piece: string, origin: number): void {
    // While a move is still queued the sink reads as buried; the remarks meanwhile belong to that new message.
    const buried = this.sink.continueIn !== undefined && !this.moving && this.sink.isLatest?.() === false;
    if (buried) this.rollOver(this.notes);
    this.notes.push(piece);
    this.origins.push(origin);
    // Without a way to continue, the oldest remarks give way instead.
    if (!this.sink.continueIn && this.notes.length > MAX_NOTES_KEPT) {
      this.notes.shift();
      this.origins.shift();
    }
  }

  // Whatever no longer fits under the heading is sealed the moment it is said, the newest remark included: the channel reads in order, and nothing waits for the turn to end to be shown whole.
  private rollOverOverflow(): void {
    if (!this.sink.continueIn) return;
    const elapsed = this.now() - this.startedAt;
    while (this.notes.length > 0 && !fitsInOne(this.say, this.notes, elapsed, this.steps, this.extra())) {
      this.rollOver(this.oldestThatFit());
    }
  }

  // The oldest remarks that fill one message on their own; the newer ones carry on in the next. A lone piece too long for the heading beside it is sealed alone, so that it is never cut.
  private oldestThatFit(): string[] {
    const sealed: string[] = [];
    let used = 0;
    for (const note of this.notes) {
      if (sealed.length > 0 && used + note.length + 2 > RENDER_BUDGET) break;
      sealed.push(note);
      used += note.length + 2;
    }
    if (sealed.length < this.notes.length) return sealed;
    return this.notes.length > 1 ? this.notes.slice(0, -1) : this.notes;
  }

  // A status Claude Code repeats every few seconds should read as one line, not a growing column.
  noteOnce(text: string): void {
    const last = this.lastRemark();
    if (last !== undefined && comparable(last) === comparable(tidy(text))) return;
    this.note(text);
  }

  hasNotes(): boolean {
    return this.notes.length > 0 || this.sealed > 0;
  }

  currentIsEmpty(): boolean {
    return this.notes.length === 0;
  }

  // The last thing said is the answer, which is about to be posted in full beneath the trail; one the trail already sealed in part is left where it stands, since the sealed part cannot be taken back and the answer would show twice.
  dropEcho(answer: string): Echo {
    // Tidied the way a remark is, or an answer naming a home path would never match the remark that had it redacted.
    const said = comparable(tidy(answer));
    if (!said) return "none";

    let echo: Echo = "none";
    for (let last = this.lastRemark(); last !== undefined && said.includes(comparable(last)); last = this.lastRemark()) {
      const origin = this.origins.at(-1)!;
      if (this.sealedOrigins.has(origin)) return "shown";
      while (this.origins.length > 0 && this.origins.at(-1) === origin) {
        this.notes.pop();
        this.origins.pop();
      }
      echo = "dropped";
    }
    return echo;
  }

  // The newest remark still in hand, as it was said: a piece of the trail may be a cut of it, or a table redrawn.
  private lastRemark(): string | undefined {
    const origin = this.origins.at(-1);
    return origin === undefined ? undefined : this.remarks[origin];
  }

  // Leaves the trail in place, marked finished, so the answer can arrive beneath it.
  async settle(mood: Mood = "done"): Promise<void> {
    this.stop();
    this.rollOverOverflow();
    await this.pendingEdit;
    await this.sink.edit(await this.finalized(this.drawn(mood)), []);
  }

  // A link is longer than the reference it replaces, and the trail was measured before it was linked. One that no longer fits goes out as it was: a refused edit would leave it reading as live work, or lose what it sealed.
  private async finalized(text: string): Promise<string> {
    const linked = await this.finalize(text);
    return forDiscord(linked).length <= DISCORD_MESSAGE_LIMIT ? linked : text;
  }

  // The trail as it stands now, under a heading in the given mood.
  private drawn(mood: Mood): string {
    return renderActivity(this.say, this.notes, this.now() - this.startedAt, this.steps, mood, this.extra());
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
  async finishWithHeading(text: string, mood: Mood = "done"): Promise<boolean> {
    const combined = `${headWith(this.say, this.now() - this.startedAt, this.steps, mood, this.extra())}\n\n${text}`;
    // Measured as it will be sent: the sink escapes what it is given, and that is what has to fit.
    if (forDiscord(combined).length > DISCORD_MESSAGE_LIMIT) return false;
    await this.finish(combined);
    return true;
  }

  // How long the outcome's first message may be: where it will sit under this trail's heading, the heading's share is kept free for it.
  roomForOutcome(mood: Mood): number {
    if (!this.hasNotes() || !this.currentIsEmpty()) return DISCORD_MESSAGE_LIMIT;
    const head = headWith(this.say, this.now() - this.startedAt, this.steps, mood, this.extra());
    return DISCORD_MESSAGE_LIMIT - forDiscord(head).length - HEADING_SLACK;
  }

  // Whatever is queued against Discord has gone out; a turn ends only once that is true.
  async flush(): Promise<void> {
    await this.pendingEdit;
  }

  // The sealed remarks stay in the current message as they are; the heading and the button move to a new one below.
  private rollOver(sealed: string[]): void {
    for (const origin of this.origins.slice(0, sealed.length)) this.sealedOrigins.add(origin);
    this.notes = this.notes.slice(sealed.length);
    this.origins = this.origins.slice(sealed.length);
    this.sealed += sealed.length;
    // A message with no remarks yet must not be left reading as live work, so it becomes a plain marker.
    const sealedText = sealed.length > 0 ? sealed.join("\n\n") : this.say("trail.started");
    this.lastSent = "";
    this.moving = true;
    this.chain(async () => {
      try {
        await this.sink.edit(await this.finalized(sealedText), []);
        await this.sink.continueIn!(this.drawn(this.live), this.actions());
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
    const text = this.drawn(this.live);
    if (text !== this.lastSent) {
      this.lastSent = text;
      this.chain(() => this.sink.edit(text, this.actions()));
      await this.pendingEdit;
    }
    this.schedule();
  }
}
