import { runTurn, type ApproveTool, type ChannelSettings, type RunningTurn, type TurnResult } from "../claude/runner.ts";
import { assistantText, toolUses } from "../claude/streamParser.ts";
import { linkPlain, linkReferences, resolveReferences } from "./repoLinks.ts";
import { convertTables } from "./tables.ts";
import { describeToolUse } from "./toolTrail.ts";
import {
  agentEvent,
  commandsChanged,
  compactMetadata,
  isCompactionStart,
  isInit,
  parentToolUseId,
  takenUp,
  type ClaudeEvent,
} from "../claude/events.ts";
import { AgentBoard, agentsTitle } from "./agentBoard.ts";
import type { ClaudeError } from "../claude/errors.ts";
import type { Say } from "../i18n/index.ts";
import type { CapabilityCache } from "../claude/capabilities.ts";
import type { ContextTracker } from "../claude/contextTracker.ts";
import type { UsageLedger } from "../claude/usageLedger.ts";
import type { PlanUsage } from "../claude/planUsage.ts";
import type { ApprovalPrompts } from "./approvals.ts";
import type { QuestionPrompts } from "./questions.ts";
import type { Config } from "../config.ts";
import type { SessionRecord } from "../sessions/index.ts";
import type { AskHandle, MessageSink, SinkAction } from "./messageSink.ts";
import { StatusMessage } from "./statusMessage.ts";
import { splitForDiscord } from "./outgoing.ts";
import { displayPath } from "../displayPath.ts";
import { lastCompactionCeiling } from "../sessions/exchanges.ts";
import { TurnQueue, describeFull, describeQueued } from "./turnQueue.ts";
import { sendNowActionId, stopActionId, stopAgentsActionId, stopAllActionId } from "./menus.ts";
import type { OutboxDelivery } from "./outboxDelivery.ts";
import type { StateMarker } from "./reactions.ts";
import type { Mood } from "./statusMessage.ts";
import type { ActiveTurns } from "./activeTurns.ts";

const DRAIN_POLL_MS = 250;

export type PreflightResult =
  | { kind: "ok" }
  | { kind: "takeover-available"; shortId: string; message: string }
  | { kind: "refused"; message: string };

export function preflight(say: Say, record: SessionRecord | null): PreflightResult {
  const live = record?.live;
  if (!live) return { kind: "ok" };

  if (live.kind === "background" && live.id) {
    return {
      kind: "takeover-available",
      shortId: live.id,
      message: say("turn.heldByBackgroundAgent", { shortId: live.id }),
    };
  }

  return { kind: "refused", message: say("turn.openInTerminal", { pid: live.pid, cwd: displayPath(live.cwd) }) };
}

export interface TurnOptions {
  resume: boolean;
  name?: string;
  fork?: boolean;
  onSessionId?: (sessionId: string) => void;
  // Both run inside the conversation's lane, so a queued message sees the turn before it as finished.
  beforeTurn?: () => Promise<void>;
  afterTurn?: () => Promise<void>;
  // Where the turn stands, for the reaction on the message that started it.
  onState?: StateMarker;
  // What the person asked in their own words, where the prompt carries context around it.
  asked?: string;
  // A plain message may join the turn already running, the way the terminal takes one typed mid-turn.
  foldable?: boolean;
}

// A message handed to a running turn: where it stands, and the notice that offers to hurry it.
interface Folded {
  onState?: StateMarker;
  notice: AskHandle | null;
  taken: boolean;
  // Set when the turn ended with the message still waiting, so a notice that arrives after that is closed at once.
  missed: boolean;
}

// What one turn carries from its set-up into its run: where it is, what it was asked, and what it shows through.
interface TurnScope {
  sessionId: string;
  cwd: string;
  prompt: string;
  settings: ChannelSettings;
  sink: MessageSink;
  options: TurnOptions;
  say: Say;
  status: StatusMessage;
  board: AgentBoard;
  tracker: ContextTracker;
}

export type SendNowOutcome = "sent" | "nothing-waiting" | "not-running" | "not-interrupted";

const SEND_NOW_OUTCOMES = {
  sent: "fold.sent",
  "nothing-waiting": "fold.nothingWaiting",
  "not-running": "fold.notRunning",
  "not-interrupted": "fold.notInterrupted",
} as const;

export function describeSendNow(say: Say, outcome: SendNowOutcome): string {
  return say(SEND_NOW_OUTCOMES[outcome]);
}

export interface StopOutcome {
  stopped: boolean;
  dropped: number;
}

export interface StopTurnOutcome {
  stopped: boolean;
  queued: number;
}

export function describeStopAgents(say: Say, stopped: number): string {
  return stopped === 0 ? say("stop.noAgents") : say("stop.agentsAsked", { count: stopped });
}

export function describeStopTurn(say: Say, outcome: StopTurnOutcome): string {
  if (!outcome.stopped) {
    return outcome.queued === 0 ? say("common.nothingRunning") : say("stop.nothingYet", { count: outcome.queued });
  }
  return outcome.queued === 0 ? say("stop.turn") : say("stop.turnThenQueue", { count: outcome.queued });
}

export function describeStop(say: Say, outcome: StopOutcome): string {
  if (!outcome.stopped) {
    return outcome.dropped === 0 ? say("common.nothingRunning") : say("stop.queueOnly", { count: outcome.dropped });
  }
  return outcome.dropped === 0 ? say("stop.all") : say("stop.allWithQueue", { count: outcome.dropped });
}

// The reaction shows a question mark while the turn waits on a person, and eyes again once it has its answer.
async function whileWaiting<T>(onState: StateMarker | undefined, stillRunning: () => boolean, ask: () => Promise<T>): Promise<T> {
  await onState?.("waiting");
  try {
    return await ask();
  } finally {
    // A prompt its turn outlived is settled after the turn's last state is shown, and must not put the eyes back over it.
    if (stillRunning()) await onState?.("running");
  }
}

function describeFailure(say: Say, error: ClaudeError): string {
  if (error.kind === "session-busy") return say("turn.heldByBackgroundAgent", { shortId: error.shortId });
  return say("turn.failed", { error: failureDetail(say, error) });
}

function failureDetail(say: Say, error: Exclude<ClaudeError, { kind: "session-busy" }>): string {
  switch (error.kind) {
    case "stopped":
      return say("turn.errors.stopped");
    case "orphan-twice":
      return say("turn.errors.orphanTwice");
    case "ended":
      return error.text
        ? say("turn.errors.endedSaying", { subtype: error.subtype, text: error.text })
        : say("turn.errors.ended", { subtype: error.subtype });
    case "could-not-run":
      return say("turn.errors.couldNotRun", { error: error.message });
    case "reported":
      return error.text || say("turn.errors.unexplained");
  }
}

// The last thing said is the answer, so it is posted beneath the trail rather than repeated inside it.
async function postAnswer(
  say: Say,
  status: StatusMessage,
  sink: MessageSink,
  cwd: string,
  text: string,
  compacted: boolean,
): Promise<void> {
  const raw = text.trim() ? text : say(compacted ? "trail.answerCompacted" : "trail.answerDoneNoText");
  // The echo is matched against what the model said, before any rewriting of it.
  status.dropEcho(raw);
  await conclude(say, status, sink, splitForDiscord(await linkEverything(cwd, convertTables(raw))), "done");
}

async function linkEverything(cwd: string, text: string): Promise<string> {
  const links = await resolveReferences(cwd, text);
  return links ? linkReferences(text, links) : linkPlain(text);
}

// The outcome replaces the progress message only when nothing lasting was posted beneath it since.
async function conclude(say: Say, status: StatusMessage, sink: MessageSink, chunks: string[], mood: Mood): Promise<void> {
  const first = chunks[0] ?? say("trail.answerDone");
  // The progress message can be gone by now, purged or deleted by hand; what it could not be given is then said beneath where it was.
  const inPlace = await concludeInPlace(status, sink, first, mood).catch(() => null);
  if (inPlace) {
    for (const chunk of chunks.slice(1)) await sink.send(chunk);
    return;
  }
  if (inPlace === false) await status.settle(mood).catch(() => undefined);
  for (const chunk of chunks.length > 0 ? chunks : [first]) await sink.send(chunk);
}

// A turn that ran must still end properly when its channel cannot be written to: the state is set, the queue moves on, and the host log says why nothing was posted.
function reportUnposted(sessionId: string): (error: unknown) => void {
  return (error) => console.error(`could not post how the turn in ${sessionId} ended`, error);
}

// True once the answer went into the progress message itself.
async function concludeInPlace(status: StatusMessage, sink: MessageSink, first: string, mood: Mood): Promise<boolean> {
  if (sink.isLatest?.() === false) return false;
  if (!status.hasNotes()) {
    await status.finish(first);
    return true;
  }
  // A segment with no remarks of its own carries the answer under its heading, not a heading alone above it.
  return status.currentIsEmpty() && (await status.finishWithHeading(first, mood));
}

// Long enough for a cloud session to be told to close, short enough that Stop still feels like stopping.
const CLOUD_STOP_GRACE_MS = 2000;

export class TurnFlow {
  private readonly running = new Map<string, RunningTurn>();
  private readonly stopping = new Set<string>();
  // Turns whose process has ended and whose answer is still being posted: there is nothing left in them to stop.
  private readonly finishing = new Set<string>();
  private readonly boards = new Map<string, AgentBoard>();
  private readonly folded = new Map<string, Map<string, Folded>>();
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
  private readonly say: () => Say;
  private readonly cloudGraceMs: number;
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
    say: () => Say,
    cloudGraceMs: number = CLOUD_STOP_GRACE_MS,
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
    this.say = say;
    this.cloudGraceMs = cloudGraceMs;
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
    for (const sessionId of this.queue.keys()) this.stop(sessionId);
  }

  // The turn a stop can act on: one still setting up is stopped before it starts, one whose process has ended is past stopping.
  private stoppable(sessionId: string): RunningTurn | "starting" | null {
    if (this.finishing.has(sessionId)) return null;
    return this.running.get(sessionId) ?? (this.queue.hasStarted(sessionId) ? "starting" : null);
  }

  private end(sessionId: string, turn: RunningTurn | "starting"): void {
    this.stopping.add(sessionId);
    // Aborting ends the turn; a command it already handed to the shell can outlive it.
    if (turn !== "starting") this.halt(sessionId, turn);
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
    return preflight(this.say(), record);
  }

  stop(sessionId: string): StopOutcome {
    const dropped = this.queue.drain(sessionId);
    const turn = this.stoppable(sessionId);
    if (!turn) return { stopped: false, dropped };
    this.end(sessionId, turn);
    return { stopped: true, dropped };
  }

  // Ends only the turn in flight; a correction queued behind it is exactly what should run next.
  stopTurn(sessionId: string): StopTurnOutcome {
    const turn = this.stoppable(sessionId);
    // The lane counts the turn it is on, whether that one is starting, running or posting its answer.
    const queued = Math.max(this.queue.depth(sessionId) - (this.queue.hasStarted(sessionId) ? 1 : 0), 0);
    if (!turn) return { stopped: false, queued };
    this.end(sessionId, turn);
    return { stopped: true, queued };
  }

  // The agents go and the turn stays, which is what asking Claude to stop them would come to.
  async stopAgents(sessionId: string): Promise<number> {
    const turn = this.finishing.has(sessionId) ? undefined : this.running.get(sessionId);
    const taskIds = turn ? (this.boards.get(sessionId)?.claim() ?? []) : [];
    if (!turn || taskIds.length === 0) return 0;
    await turn.stopTasks(taskIds);
    return taskIds.length;
  }

  // Killing the process would leave a cloud task running where it is billed, so it is told to stop first and given a moment to close down.
  private halt(sessionId: string, turn: RunningTurn): void {
    const cloud = this.boards.get(sessionId)?.runningRemote() ?? [];
    if (cloud.length === 0) {
      turn.stop();
      return;
    }
    const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, this.cloudGraceMs));
    void Promise.race([turn.stopTasks(cloud), pause()])
      .then(pause)
      .finally(() => turn.stop())
      .catch((error: unknown) => console.error(`stopping the turn in ${sessionId} failed`, error));
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
    const say = this.say();
    if (this.draining) {
      await sink.notice(say("turn.draining"));
      return false;
    }
    if (options.foldable && (await this.fold(sessionId, prompt, sink, options))) return true;

    const admission = this.queue.admit(sessionId);
    if (admission.kind === "full") {
      await sink.notice(describeFull(say));
      return false;
    }
    // The place in the lane is taken before anything is awaited, so whatever arrives or is dropped meanwhile counts this message too.
    const announced = Promise.withResolvers<void>();
    const running = this.queue.enqueue(sessionId, async () => {
      await announced.promise;
      try {
        await options.beforeTurn?.();
        await this.runNow(sessionId, cwd, prompt, settings, sink, options);
      } finally {
        this.stopping.delete(sessionId);
        await options.afterTurn?.();
      }
    });
    if (admission.kind === "queued") {
      await sink.notice(describeQueued(say, admission.ahead)).catch(() => undefined);
      await options.onState?.("queued");
    }
    announced.resolve();

    const ran = await running;
    if (!ran) await options.onState?.("stopped");
    return ran;
  }

  // False when no turn is running or it is past taking a message, and the message then waits its turn as before.
  private async fold(sessionId: string, prompt: string, sink: MessageSink, options: TurnOptions): Promise<boolean> {
    const turn = this.running.get(sessionId);
    if (!turn || this.stopping.has(sessionId) || this.finishing.has(sessionId)) return false;
    const uuid = turn.handOver(prompt);
    if (!uuid) return false;

    const entry: Folded = { onState: options.onState, notice: null, taken: false, missed: false };
    const waiting = this.folded.get(sessionId) ?? new Map<string, Folded>();
    waiting.set(uuid, entry);
    this.folded.set(sessionId, waiting);
    await options.onState?.("queued");
    const say = this.say();
    const hurry = [{ id: sendNowActionId(sessionId), label: say("fold.sendNow") }];
    entry.notice = (await sink.ask?.(say("fold.handedOver"), hurry)) ?? null;
    // It can be taken up, or the turn can end, while the notice is still on its way.
    if (entry.taken) await entry.notice?.close(say("fold.takenUp"));
    else if (entry.missed) await entry.notice?.close(say("fold.neverTaken"));
    return true;
  }

  private async takeUp(sessionId: string, uuid: string): Promise<void> {
    const entry = this.folded.get(sessionId)?.get(uuid);
    if (!entry || entry.taken) return;
    entry.taken = true;
    await entry.onState?.("running");
    await entry.notice?.close(this.say()("fold.takenUp"));
  }

  // A message that joined a turn ends the way the turn did; one never taken up says so, since nothing answered it.
  private async settleFolded(sessionId: string, state: "done" | "stopped" | "failed"): Promise<void> {
    const entries = [...(this.folded.get(sessionId)?.values() ?? [])];
    this.folded.delete(sessionId);
    for (const entry of entries) {
      entry.missed = !entry.taken;
      if (entry.missed) await entry.notice?.close(this.say()("fold.neverTaken"));
      await entry.onState?.(entry.taken ? state : "stopped");
    }
  }

  // Interrupting is only worth it while something waits; after that it would cut the turn short for nothing.
  async sendNow(sessionId: string): Promise<SendNowOutcome> {
    const turn = this.finishing.has(sessionId) ? undefined : this.running.get(sessionId);
    if (!turn) return "not-running";
    const waiting = [...(this.folded.get(sessionId)?.values() ?? [])].some((entry) => !entry.taken);
    if (!waiting) return "nothing-waiting";
    return (await turn.interrupt()) ? "sent" : "not-interrupted";
  }

  private async runNow(
    sessionId: string,
    cwd: string,
    prompt: string,
    settings: ChannelSettings,
    sink: MessageSink,
    options: TurnOptions,
  ): Promise<void> {
    // Read once, so a turn finishes in the language it started in even if another is picked while it runs.
    const say = this.say();
    // True once Claude Code's process has ended, which is before the answer is posted and the turn is cleared away.
    let over = false;
    // The record follows the trail into each new message, so an interruption is marked where the reader looks.
    let ended = false;
    const remember = async (): Promise<void> => {
      const anchor = sink.anchor?.();
      if (anchor && !ended) await this.activeTurns.record(sessionId, anchor);
    };
    // Each extra button appears only while it would do something: a queue to drop, or agents and cloud tasks to stop.
    const actions = (): SinkAction[] => {
      const offered: SinkAction[] = [{ id: stopActionId(sessionId), label: say("stop.button"), tone: "danger" }];
      if (this.queue.depth(sessionId) > 1) {
        offered.push({ id: stopAllActionId(sessionId), label: say("stop.allButton"), tone: "danger" });
      }
      const stopAgents = board.stopLabel();
      if (stopAgents) offered.push({ id: stopAgentsActionId(sessionId), label: stopAgents });
      return offered;
    };
    const board = new AgentBoard(say, sink, agentsTitle(say, options.asked ?? prompt), Date.now, undefined, (taskId) => {
      void this.running.get(sessionId)?.stopTasks([taskId]);
    });
    this.boards.set(sessionId, board);
    const status = new StatusMessage(
      say,
      sink,
      Date.now,
      actions,
      remember,
      (trail) => linkEverything(cwd, trail),
      () => board.block(),
    );
    const scope: TurnScope = {
      sessionId,
      cwd,
      prompt,
      settings,
      sink,
      options,
      say,
      status,
      board,
      tracker: this.trackerFor(sessionId),
    };

    try {
      await status.start();
      await remember();
      await options.onState?.("running");
      // A stop that came while all this was being set up is honoured here, before Claude Code is started at all.
      if (this.stopping.has(sessionId)) {
        await conclude(say, status, sink, [say("trail.answerStopped")], "stopped").catch(reportUnposted(sessionId));
        await options.onState?.("stopped");
        return;
      }
      await this.live(
        scope,
        () => !over,
        () => {
          over = true;
        },
      );
    } finally {
      status.stop();
      this.approvals.finish(sessionId);
      this.questions.finish(sessionId);
      // A move still queued would record the turn again after it was cleared, so the queue is emptied first.
      ended = true;
      board.end();
      await board.flush();
      await status.flush();
      await this.activeTurns.clear(sessionId);
      this.running.delete(sessionId);
      await this.settleFolded(sessionId, "stopped");
      this.boards.delete(sessionId);
      this.stopping.delete(sessionId);
      this.finishing.delete(sessionId);
    }
  }

  // The part of a turn during which Claude Code runs, and the posting of what it came to.
  private async live(scope: TurnScope, stillRunning: () => boolean, onOver: () => void): Promise<void> {
    const { sessionId, cwd, prompt, settings, sink, options, say, status, board, tracker } = scope;
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
        approve: this.approvalGate(say, sessionId, sink, stillRunning, options.onState),
        askQuestions: (questions) =>
          whileWaiting(options.onState, stillRunning, () => this.questions.ask(say, sessionId, sink, questions)),
      },
      (event) => {
        const noteCompaction = (): void => {
          compaction.happened = true;
        };
        // Nothing awaits these until the turn ends, and a rejection left unhandled that long takes the whole bridge down.
        const handled = this.handleEvent(say, event, sessionId, cwd, status, board, sink, tracker, noteCompaction);
        pending.push(handled.catch((error: unknown) => console.error(`an event in ${sessionId} could not be shown`, error)));
      },
    );
    this.running.set(sessionId, turn);

    const result = await turn.done;
    onOver();
    this.finishing.add(sessionId);
    this.recordSpend(sessionId, result, options);
    await Promise.allSettled(pending);
    board.end();

    if (!result.ok) {
      // Windows has no signals, so a killed turn looks like any other non-zero exit from here.
      const stopped = this.stopping.has(sessionId);
      // Claude Code says its own reason as the turn's last remark too, and once is enough.
      if (result.error.kind === "reported") status.dropEcho(result.error.text);
      const outcome = stopped ? say("trail.answerStopped") : describeFailure(say, result.error);
      await conclude(say, status, sink, [outcome], stopped ? "stopped" : "failed").catch(reportUnposted(sessionId));
      await options.onState?.(stopped ? "stopped" : "failed");
      await this.settleFolded(sessionId, stopped ? "stopped" : "failed");
      return;
    }

    await postAnswer(say, status, sink, cwd, result.text, compaction.happened).catch(reportUnposted(sessionId));
    await options.onState?.("done");
    await this.settleFolded(sessionId, "done");
    await this.outbox.deliver(say, cwd, sessionId, sink);

    if (result.contextUsage) {
      const warning = tracker.observe(result.contextUsage);
      if (warning) await sink.notice(say(`context.${warning.level}`, { percent: warning.percent }));
    }
  }

  private approvalGate(
    say: Say,
    sessionId: string,
    sink: MessageSink,
    stillRunning: () => boolean,
    onState?: StateMarker,
  ): ApproveTool | undefined {
    if (!this.config.toolApprovals) return undefined;
    return (toolName, input) =>
      whileWaiting(onState, stillRunning, () => this.approvals.ask(say, sessionId, sink, this.config.ownerIds, toolName, input));
  }

  private recordSpend(sessionId: string, result: TurnResult, options: TurnOptions): void {
    // A fork is a new conversation; moving the source's spend to it would empty the source.
    if (result.sessionId && !options.fork) this.usage.migrate(sessionId, result.sessionId);
    // A turn that failed still spent what it spent, so it is recorded before the outcome is read.
    this.usage.record(result.sessionId ?? sessionId, { ...result, startedHere: !options.resume });
    if (result.sessionId) options.onSessionId?.(result.sessionId);
  }

  private async handleEvent(
    say: Say,
    event: ClaudeEvent,
    sessionId: string,
    cwd: string,
    status: StatusMessage,
    board: AgentBoard,
    sink: MessageSink,
    tracker: ContextTracker,
    onCompactionStart: () => void,
  ): Promise<void> {
    if (isInit(event)) {
      this.capabilities.record(sessionId, event);
      return;
    }

    const taken = takenUp(event);
    if (taken) {
      await this.takeUp(sessionId, taken);
      return;
    }

    const commands = commandsChanged(event);
    if (commands) {
      await this.capabilities.recordCommands(cwd, commands);
      return;
    }

    if (event.type === "rate_limit_event") {
      this.planUsage.record(event.rate_limit_info);
      return;
    }

    if (isCompactionStart(event)) {
      onCompactionStart();
      status.noteOnce(say("trail.compacting"));
      return;
    }

    const summary = compactMetadata(event);
    if (summary) {
      tracker.reset();
      // A manual compaction happens wherever it was asked for and says nothing about where the session fills up.
      if (summary.trigger === "auto") tracker.learnCeiling(summary.pre_tokens);
      await sink.notice(
        say(summary.trigger === "auto" ? "trail.compactedAuto" : "trail.compactedManual", {
          before: summary.pre_tokens,
          after: summary.post_tokens,
          dropped: summary.cumulative_dropped_tokens,
          seconds: Math.round(summary.duration_ms / 1000),
        }),
      );
      return;
    }

    const agent = agentEvent(event);
    if (agent) {
      board.observe(agent);
      return;
    }

    const uses = toolUses(event);
    status.stepped(uses.length);
    // As in the terminal, an agent is shown working and on what; its own edits, commands and words are not the session's.
    const parent = parentToolUseId(event);
    if (parent && board.follows(parent)) {
      for (const use of uses) if (use.id) board.noteCall(parent, use.id);
      return;
    }

    for (const use of uses) {
      const shown = describeToolUse(say, use.name, use.input);
      if (shown) status.note(shown);
    }
    status.note(assistantText(event));
  }
}
