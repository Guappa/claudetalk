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
  replayed,
  type ClaudeEvent,
} from "../claude/events.ts";
import { AgentBoard, agentsTitle } from "./agentBoard.ts";
import type { ClaudeError } from "../claude/errors.ts";
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
import { chunkForDiscord } from "./renderer.ts";
import { displayPath } from "../displayPath.ts";
import { count } from "../text.ts";
import { lastCompactionCeiling } from "../sessions/exchanges.ts";
import { TurnQueue, describeQueued } from "./turnQueue.ts";
import { sendNowActionId, stopActionId, stopAgentsActionId, stopAllActionId } from "./menus.ts";
import type { OutboxDelivery } from "./outboxDelivery.ts";
import type { StateMarker } from "./reactions.ts";
import type { Mood } from "./statusMessage.ts";
import type { ActiveTurns } from "./activeTurns.ts";

const DRAINING =
  "The bridge is shutting down and takes nothing new until it is back. Send this again in a minute.";
const DRAIN_POLL_MS = 250;
const HANDED_OVER = "Handed to the running turn. Claude takes it up at its next step.";
const TAKEN_UP = "Taken up by the running turn.";
const NEVER_TAKEN = "The turn ended before this was taken up. Send it again.";

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
}

export type SendNowOutcome = "sent" | "nothing-waiting" | "not-running";

export function describeSendNow(outcome: SendNowOutcome): string {
  if (outcome === "sent") {
    return "Sent now. The step Claude was on was cut short so it could read your message; it carries on from there.";
  }
  if (outcome === "nothing-waiting") return "Nothing is waiting: the running turn has already taken your message up.";
  return "No turn is running here any more, so there is nothing to interrupt.";
}

export interface StopOutcome {
  stopped: boolean;
  dropped: number;
}

export interface StopTurnOutcome {
  stopped: boolean;
  queued: number;
}

export function describeStopAgents(stopped: number): string {
  if (stopped === 0) return "No agent or cloud task is running here, so there was nothing to stop.";
  return (
    `Asked ${count(stopped, "task")} to stop. The turn itself carries on, and Claude is told they were stopped; ` +
    "press **Stop** to end the turn as well."
  );
}

export function describeStopTurn(outcome: StopTurnOutcome): string {
  if (!outcome.stopped) {
    return outcome.queued === 0
      ? "Nothing is running here."
      : `Nothing is running yet; ${count(outcome.queued, "message")} queued here will run in turn.`;
  }
  const next =
    outcome.queued === 0
      ? "Nothing was queued, so Claude takes no further action here until your next message."
      : `The ${count(outcome.queued, "message")} queued behind it ${outcome.queued === 1 ? "runs" : "run"} next.`;
  return `Stopped this turn. ${next}`;
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

// The reaction shows a question mark while the turn waits on a person, and eyes again once it has its answer.
async function whileWaiting<T>(onState: StateMarker | undefined, ask: () => Promise<T>): Promise<T> {
  await onState?.("waiting");
  try {
    return await ask();
  } finally {
    await onState?.("running");
  }
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
  await conclude(status, sink, chunkForDiscord(await linkEverything(cwd, convertTables(raw))), "done");
}

async function linkEverything(cwd: string, text: string): Promise<string> {
  const links = await resolveReferences(cwd, text);
  return links ? linkReferences(text, links) : linkPlain(text);
}

// The outcome replaces the progress message only when nothing lasting was posted beneath it since.
async function conclude(status: StatusMessage, sink: MessageSink, chunks: string[], mood: Mood): Promise<void> {
  const first = chunks[0] ?? "Done.";
  if (await concludeInPlace(status, sink, first, mood)) {
    for (const chunk of chunks.slice(1)) await sink.send(chunk);
    return;
  }
  await status.settle(mood);
  for (const chunk of chunks) await sink.send(chunk);
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
    this.halt(sessionId, turn);
    return { stopped: true, dropped };
  }

  // Ends only the turn in flight; a correction queued behind it is exactly what should run next.
  stopTurn(sessionId: string): StopTurnOutcome {
    const turn = this.running.get(sessionId);
    const queued = Math.max(this.queue.depth(sessionId) - (turn ? 1 : 0), 0);
    if (!turn) return { stopped: false, queued };
    this.stopping.add(sessionId);
    this.halt(sessionId, turn);
    return { stopped: true, queued };
  }

  // The agents go and the turn stays, which is what asking Claude to stop them would come to.
  async stopAgents(sessionId: string): Promise<number> {
    const turn = this.running.get(sessionId);
    const taskIds = this.boards.get(sessionId)?.claim() ?? [];
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
      .finally(() => turn.stop());
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
    if (options.foldable && (await this.fold(sessionId, prompt, sink, options))) return true;

    const admission = this.queue.admit(sessionId);
    if (admission.kind === "full") {
      await sink.notice(admission.message);
      return false;
    }
    if (admission.kind === "queued") {
      await sink.notice(describeQueued(admission.ahead));
      await options.onState?.("queued");
    }

    const ran = await this.queue.enqueue(sessionId, async () => {
      try {
        await options.beforeTurn?.();
        await this.runNow(sessionId, cwd, prompt, settings, sink, options);
      } finally {
        await options.afterTurn?.();
      }
    });
    if (!ran) await options.onState?.("stopped");
    return ran;
  }

  // False when no turn is running or it is past taking a message, and the message then waits its turn as before.
  private async fold(sessionId: string, prompt: string, sink: MessageSink, options: TurnOptions): Promise<boolean> {
    const turn = this.running.get(sessionId);
    if (!turn || this.stopping.has(sessionId)) return false;
    const uuid = turn.handOver(prompt);
    if (!uuid) return false;

    const entry: Folded = { onState: options.onState, notice: null, taken: false };
    const waiting = this.folded.get(sessionId) ?? new Map<string, Folded>();
    waiting.set(uuid, entry);
    this.folded.set(sessionId, waiting);
    await options.onState?.("queued");
    entry.notice = (await sink.ask?.(HANDED_OVER, [{ id: sendNowActionId(sessionId), label: "Send now" }])) ?? null;
    // It can be taken up while the notice is still on its way.
    if (entry.taken) await entry.notice?.close(TAKEN_UP);
    return true;
  }

  private async takeUp(sessionId: string, uuid: string): Promise<void> {
    const entry = this.folded.get(sessionId)?.get(uuid);
    if (!entry || entry.taken) return;
    entry.taken = true;
    await entry.onState?.("running");
    await entry.notice?.close(TAKEN_UP);
  }

  // A message that joined a turn ends the way the turn did; one never taken up says so, since nothing answered it.
  private async settleFolded(sessionId: string, state: "done" | "stopped" | "failed"): Promise<void> {
    const entries = [...(this.folded.get(sessionId)?.values() ?? [])];
    this.folded.delete(sessionId);
    for (const entry of entries) {
      if (!entry.taken) await entry.notice?.close(NEVER_TAKEN);
      await entry.onState?.(entry.taken ? state : "stopped");
    }
  }

  // Interrupting is only worth it while something waits; after that it would cut the turn short for nothing.
  async sendNow(sessionId: string): Promise<SendNowOutcome> {
    const turn = this.running.get(sessionId);
    if (!turn) return "not-running";
    const waiting = [...(this.folded.get(sessionId)?.values() ?? [])].some((entry) => !entry.taken);
    if (!waiting) return "nothing-waiting";
    await turn.interrupt();
    return "sent";
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
    // Each extra button appears only while it would do something: a queue to drop, or agents and cloud tasks to stop.
    const actions = (): SinkAction[] => {
      const offered: SinkAction[] = [{ id: stopActionId(sessionId), label: "Stop", tone: "danger" }];
      if (this.queue.depth(sessionId) > 1) offered.push({ id: stopAllActionId(sessionId), label: "Stop all", tone: "danger" });
      const stopAgents = board.stopLabel();
      if (stopAgents) offered.push({ id: stopAgentsActionId(sessionId), label: stopAgents });
      return offered;
    };
    const board = new AgentBoard(sink, agentsTitle(options.asked ?? prompt), Date.now, undefined, (taskId) => {
      void this.running.get(sessionId)?.stopTasks([taskId]);
    });
    this.boards.set(sessionId, board);
    const status = new StatusMessage(
      sink,
      Date.now,
      actions,
      remember,
      (trail) => linkEverything(cwd, trail),
      () => board.block(),
    );
    await status.start();
    await remember();
    await options.onState?.("running");

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
        approve: this.approvalGate(sessionId, sink, options.onState),
        askQuestions: (questions) =>
          whileWaiting(options.onState, () => this.questions.ask(sessionId, sink, questions)),
      },
      (event) => {
        pending.push(
          this.handleEvent(event, sessionId, cwd, status, board, sink, tracker, () => void (compaction.happened = true)),
        );
      },
    );
    this.running.set(sessionId, turn);

    try {
      const result = await turn.done;
      this.recordSpend(sessionId, result, options);
      await Promise.allSettled(pending);
      board.end();

      if (!result.ok) {
        // Windows has no signals, so a killed turn looks like any other non-zero exit from here.
        const stopped = this.stopping.has(sessionId);
        await conclude(status, sink, [stopped ? "Stopped." : describeFailure(result.error)], stopped ? "stopped" : "failed");
        await options.onState?.(stopped ? "stopped" : "failed");
        await this.settleFolded(sessionId, stopped ? "stopped" : "failed");
        return;
      }

      await postAnswer(status, sink, cwd, result.text, compaction.happened);
      await options.onState?.("done");
      await this.settleFolded(sessionId, "done");
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
      board.end();
      await board.flush();
      await status.flush();
      await this.activeTurns.clear(sessionId);
      this.running.delete(sessionId);
      await this.settleFolded(sessionId, "stopped");
      this.boards.delete(sessionId);
      this.stopping.delete(sessionId);
    }
  }

  private approvalGate(sessionId: string, sink: MessageSink, onState?: StateMarker): ApproveTool | undefined {
    if (!this.config.toolApprovals) return undefined;
    return (toolName, input) =>
      whileWaiting(onState, () => this.approvals.ask(sessionId, sink, this.config.ownerIds, toolName, input));
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

    const taken = replayed(event);
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
      const shown = describeToolUse(use.name, use.input);
      if (shown) status.note(shown);
    }
    status.note(assistantText(event));
  }
}
