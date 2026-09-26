import { runTurn, type ApproveTool, type ChannelSettings, type RunningTurn, type TurnResult } from "../claude/runner.ts";
import { assistantText, toolUses } from "../claude/streamParser.ts";
import { linkPlain, linkReferences, resolveReferences } from "./repoLinks.ts";
import { convertTables } from "./tables.ts";
import { describeToolUse } from "./toolTrail.ts";
import { compactMetadata, isCompactionStart, isInit, type ClaudeEvent } from "../claude/events.ts";
import type { ClaudeError } from "../claude/errors.ts";
import type { CapabilityCache } from "../claude/capabilities.ts";
import type { ContextTracker } from "../claude/contextTracker.ts";
import type { UsageLedger } from "../claude/usageLedger.ts";
import type { PlanUsage } from "../claude/planUsage.ts";
import type { ApprovalPrompts } from "./approvals.ts";
import type { QuestionPrompts } from "./questions.ts";
import type { Config } from "../config.ts";
import type { SessionRecord } from "../sessions/index.ts";
import type { MessageSink } from "./messageSink.ts";
import { StatusMessage } from "./statusMessage.ts";
import { chunkForDiscord } from "./renderer.ts";
import { displayPath } from "../displayPath.ts";
import { count } from "../text.ts";
import { lastCompactionCeiling } from "../sessions/exchanges.ts";
import { TurnQueue, describeQueued } from "./turnQueue.ts";
import { stopActionId } from "./menus.ts";
import type { OutboxDelivery } from "./outboxDelivery.ts";
import type { ActiveTurns } from "./activeTurns.ts";

const DRAINING =
  "The bridge is shutting down and takes nothing new until it is back. Send this again in a minute.";
const DRAIN_POLL_MS = 250;

export type PreflightResult =
  | { kind: "ok" }
  | { kind: "takeover-available"; shortId: string; message: string }
  | { kind: "refused"; message: string };

function describeBackgroundHold(shortId: string): string {
  return (
    `That conversation is running as a background agent (\`${shortId}\`). ` +
    `Run \`/takeover\` here to stop it and continue, or \`claude attach ${shortId}\` on the host.`
  );
}

export function preflight(record: SessionRecord | null): PreflightResult {
  const live = record?.live;
  if (!live) return { kind: "ok" };

  if (live.kind === "background" && live.id) {
    return { kind: "takeover-available", shortId: live.id, message: describeBackgroundHold(live.id) };
  }

  return {
    kind: "refused",
    message:
      `That conversation is open in a terminal on the host (pid ${live.pid}, ${displayPath(live.cwd)}). ` +
      `Close that terminal or switch it to another conversation, then try again.`,
  };
}

export interface TurnOptions {
  resume: boolean;
  name?: string;
  fork?: boolean;
  onSessionId?: (sessionId: string) => void;
  // Both run inside the conversation's lane, so a queued message sees the turn before it as finished.
  beforeTurn?: () => Promise<void>;
  afterTurn?: () => Promise<void>;
}

export interface StopOutcome {
  stopped: boolean;
  dropped: number;
}

function droppedWithIt(dropped: number): string {
  if (dropped === 0) return "";
  if (dropped === 1) return " The message queued behind it was dropped too.";
  return ` The ${count(dropped, "message")} queued behind it were dropped too.`;
}

export function describeStop(outcome: StopOutcome): string {
  if (!outcome.stopped) {
    if (outcome.dropped === 0) return "Nothing is running here.";
    const queued = outcome.dropped === 1 ? "message" : count(outcome.dropped, "message");
    return `Nothing was running, but the ${queued} queued here ${outcome.dropped === 1 ? "was" : "were"} dropped.`;
  }
  return (
    `Stopped.${droppedWithIt(outcome.dropped)} Claude takes no further action here until your next message. ` +
    "A shell command it had already started can outlive it on Windows, so check the host if it was something long."
  );
}

function describeFailure(error: ClaudeError): string {
  if (error.kind === "session-busy") return describeBackgroundHold(error.shortId);
  return `The turn failed.\n\`\`\`\n${error.message}\n\`\`\``;
}

// The last thing said is the answer, so it is posted beneath the trail rather than repeated inside it.
async function postAnswer(
  status: StatusMessage,
  sink: MessageSink,
  cwd: string,
  text: string,
  compacted: boolean,
): Promise<void> {
  const raw = text.trim() ? text : compacted ? "Compacted." : "Done, with no text to show.";
  // The echo is matched against what the model said, before any rewriting of it.
  status.dropEcho(raw);
  await conclude(status, sink, chunkForDiscord(await linkEverything(cwd, convertTables(raw))));
}

async function linkEverything(cwd: string, text: string): Promise<string> {
  const links = await resolveReferences(cwd, text);
  return links ? linkReferences(text, links) : linkPlain(text);
}

// The outcome replaces the progress message only when nothing lasting was posted beneath it since.
async function conclude(status: StatusMessage, sink: MessageSink, chunks: string[]): Promise<void> {
  const first = chunks[0] ?? "Done.";
  if (await concludeInPlace(status, sink, first)) {
    for (const chunk of chunks.slice(1)) await sink.send(chunk);
    return;
  }
  await status.settle();
  for (const chunk of chunks) await sink.send(chunk);
}

// True once the answer went into the progress message itself.
async function concludeInPlace(status: StatusMessage, sink: MessageSink, first: string): Promise<boolean> {
  if (sink.isLatest?.() === false) return false;
  if (!status.hasNotes()) {
    await status.finish(first);
    return true;
  }
  // A segment with no remarks of its own carries the answer under its heading, not a heading alone above it.
  return status.currentIsEmpty() && (await status.finishWithHeading(first));
}

export class TurnFlow {
  private readonly running = new Map<string, RunningTurn>();
  private readonly stopping = new Set<string>();
  private readonly queue = new TurnQueue();
  private readonly capabilities: CapabilityCache;
  private readonly trackerFor: (sessionId: string) => ContextTracker;
  private readonly usage: UsageLedger;
  private readonly planUsage: PlanUsage;
  private readonly approvals: ApprovalPrompts;
  private readonly questions: QuestionPrompts;
  private readonly outbox: OutboxDelivery;
  private readonly activeTurns: ActiveTurns;
  private readonly config: Config;
  private draining = false;

  constructor(
    capabilities: CapabilityCache,
    trackerFor: (sessionId: string) => ContextTracker,
    usage: UsageLedger,
    planUsage: PlanUsage,
    approvals: ApprovalPrompts,
    questions: QuestionPrompts,
    outbox: OutboxDelivery,
    activeTurns: ActiveTurns,
    config: Config,
  ) {
    this.capabilities = capabilities;
    this.trackerFor = trackerFor;
    this.usage = usage;
    this.planUsage = planUsage;
    this.approvals = approvals;
    this.questions = questions;
    this.outbox = outbox;
    this.activeTurns = activeTurns;
    this.config = config;
  }

  // Running and queued turns together: what a shutdown has to wait for.
  activeCount(): number {
    return this.queue.total();
  }

  // Nothing new is admitted; what was already accepted runs to the end, queued messages included.
  async drain(onProgress: (turns: number) => void): Promise<void> {
    this.draining = true;
    let last = -1;
    while (this.activeCount() > 0) {
      if (this.activeCount() !== last) {
        last = this.activeCount();
        onProgress(last);
      }
      await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
    }
  }

  stopAll(): void {
    this.draining = true;
    for (const sessionId of [...this.running.keys()]) this.stop(sessionId);
    for (const sessionId of this.queue.keys()) this.queue.drain(sessionId);
  }

  // Reading the transcript for a ceiling is expensive, so it happens once per session.
  async ensureCeiling(sessionId: string, transcriptPath: string): Promise<void> {
    const tracker = this.trackerFor(sessionId);
    if (tracker.knownCeiling()) return;
    const ceiling = await lastCompactionCeiling(transcriptPath);
    if (ceiling) tracker.learnCeiling(ceiling);
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }

  available(sessionId: string, record: SessionRecord | null): PreflightResult {
    if (this.running.has(sessionId)) return { kind: "ok" };
    return preflight(record);
  }

  stop(sessionId: string): StopOutcome {
    const dropped = this.queue.drain(sessionId);
    const turn = this.running.get(sessionId);
    if (!turn) return { stopped: false, dropped };
    this.stopping.add(sessionId);
    // Aborting ends the turn; a command it already handed to the shell can outlive it.
    turn.stop();
    return { stopped: true, dropped };
  }

  queueDepth(sessionId: string): number {
    return this.queue.depth(sessionId);
  }

  async run(
    sessionId: string,
    cwd: string,
    prompt: string,
    settings: ChannelSettings,
    sink: MessageSink,
    options: TurnOptions,
  ): Promise<boolean> {
    if (this.draining) {
      await sink.notice(DRAINING);
      return false;
    }
    const admission = this.queue.admit(sessionId);
    if (admission.kind === "full") {
      await sink.notice(admission.message);
      return false;
    }
    if (admission.kind === "queued") await sink.notice(describeQueued(admission.ahead));

    return await this.queue.enqueue(sessionId, async () => {
      try {
        await options.beforeTurn?.();
        await this.runNow(sessionId, cwd, prompt, settings, sink, options);
      } finally {
        await options.afterTurn?.();
      }
    });
  }

  private async runNow(
    sessionId: string,
    cwd: string,
    prompt: string,
    settings: ChannelSettings,
    sink: MessageSink,
    options: TurnOptions,
  ): Promise<void> {
    // The record follows the trail into each new message, so an interruption is marked where the reader looks.
    let ended = false;
    const remember = async (): Promise<void> => {
      const anchor = sink.anchor?.();
      if (anchor && !ended) await this.activeTurns.record(sessionId, anchor);
    };
    const status = new StatusMessage(
      sink,
      Date.now,
      [{ id: stopActionId(sessionId), label: "Stop", tone: "danger" }],
      remember,
      (trail) => linkEverything(cwd, trail),
    );
    await status.start();
    await remember();

    const tracker = this.trackerFor(sessionId);
    const pending: Array<Promise<void>> = [];
    const compaction = { happened: false };

    const turn = runTurn(
      {
        sessionId,
        cwd,
        prompt,
        settings,
        resume: options.resume,
        name: options.name,
        fork: options.fork,
        approve: this.approvalGate(sessionId, sink),
        askQuestions: (questions) => this.questions.ask(sessionId, sink, questions),
      },
      (event) => {
        pending.push(this.handleEvent(event, sessionId, status, sink, tracker, () => void (compaction.happened = true)));
      },
    );
    this.running.set(sessionId, turn);

    try {
      const result = await turn.done;
      this.recordSpend(sessionId, result, options);
      await Promise.allSettled(pending);

      if (!result.ok) {
        // Windows has no signals, so a killed turn looks like any other non-zero exit from here.
        await conclude(status, sink, [this.stopping.has(sessionId) ? "Stopped." : describeFailure(result.error)]);
        return;
      }

      await postAnswer(status, sink, cwd, result.text, compaction.happened);
      await this.outbox.deliver(cwd, sessionId, sink);

      if (result.contextUsage) {
        const warning = tracker.observe(result.contextUsage);
        if (warning) await sink.notice(warning.message);
      }
    } finally {
      status.stop();
      this.approvals.finish(sessionId);
      this.questions.finish(sessionId);
      // A move still queued would record the turn again after it was cleared, so the queue is emptied first.
      ended = true;
      await status.flush();
      await this.activeTurns.clear(sessionId);
      this.running.delete(sessionId);
      this.stopping.delete(sessionId);
    }
  }

  private approvalGate(sessionId: string, sink: MessageSink): ApproveTool | undefined {
    if (!this.config.toolApprovals) return undefined;
    return (toolName, input) => this.approvals.ask(sessionId, sink, this.config.ownerIds, toolName, input);
  }

  private recordSpend(sessionId: string, result: TurnResult, options: TurnOptions): void {
    // A fork is a new conversation; moving the source's spend to it would empty the source.
    if (result.sessionId && !options.fork) this.usage.migrate(sessionId, result.sessionId);
    // A turn that failed still spent what it spent, so it is recorded before the outcome is read.
    this.usage.record(result.sessionId ?? sessionId, { ...result, startedHere: !options.resume });
    if (result.sessionId) options.onSessionId?.(result.sessionId);
  }

  private async handleEvent(
    event: ClaudeEvent,
    sessionId: string,
    status: StatusMessage,
    sink: MessageSink,
    tracker: ContextTracker,
    onCompactionStart: () => void,
  ): Promise<void> {
    if (isInit(event)) {
      this.capabilities.record(sessionId, event);
      return;
    }

    if (event.type === "rate_limit_event") {
      this.planUsage.record(event.rate_limit_info);
      return;
    }

    if (isCompactionStart(event)) {
      onCompactionStart();
      status.noteOnce("Compacting the conversation, which can take a while.");
      return;
    }

    const summary = compactMetadata(event);
    if (summary) {
      tracker.reset();
      // A manual compaction happens wherever it was asked for and says nothing about where the session fills up.
      if (summary.trigger === "auto") tracker.learnCeiling(summary.pre_tokens);
      const seconds = Math.round(summary.duration_ms / 1000);
      await sink.notice(
        `Compacted (${summary.trigger}): ${summary.pre_tokens.toLocaleString()} to ` +
          `${summary.post_tokens.toLocaleString()} tokens, ` +
          `${summary.cumulative_dropped_tokens.toLocaleString()} dropped in total, ${seconds}s.`,
      );
      return;
    }

    const uses = toolUses(event);
    status.stepped(uses.length);
    for (const use of uses) {
      const shown = describeToolUse(use.name, use.input);
      if (shown) status.note(shown);
    }
    status.note(assistantText(event));
  }
}
