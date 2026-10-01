import type { AgentEvent, AgentOutcome } from "../claude/events.ts";
import type { Say } from "../i18n/index.ts";
import { truncate } from "../text.ts";
import type { DetailPost, DetailSink, MessageSink } from "./messageSink.ts";
import { formatElapsed } from "./statusMessage.ts";

// The trail names this many running agents and counts the rest, so a fan-out cannot swamp the progress message.
const MAX_LISTED = 4;
const DESCRIPTION_CHARS = 60;
const ACTIVITY_CHARS = 40;
// Entries to one roster message: ten of them stay under Discord's limit with room to spare.
const PAGE_SIZE = 10;
const ROSTER_DESCRIPTION_CHARS = 100;
// Discord allows about five edits in five seconds per channel, and busy agents report far more often than that.
const PACE_MS = 3000;
// Discord allows a thread name a hundred characters.
const TITLE_CHARS = 97;

type TallyKey = "agents.tallyRunning" | "agents.tallyDone" | "agents.tallyFailed" | "agents.tallyStopped";

const ENDED: Record<AgentOutcome, "trail.agentDone" | "trail.agentFailed" | "trail.agentStopped"> = {
  completed: "trail.agentDone",
  failed: "trail.agentFailed",
  stopped: "trail.agentStopped",
};

interface Agent {
  index: number;
  taskId: string;
  // Runs in the cloud, where killing this process would not reach it.
  remote: boolean;
  type: string;
  description: string;
  state: "running" | AgentOutcome;
  activity: string;
  toolUses: number;
  tokens: number;
  startedAt: number;
  durationMs: number;
  // What earlier runs added up to, since an agent sent back to work reports its new run from zero.
  earlierToolUses: number;
  earlierMs: number;
}

// Who a turn's agents are and what they are on, kept as a roster in a side room so the trail stays the session's own.
export class AgentBoard {
  private readonly agents = new Map<string, Agent>();
  private readonly byToolUse = new Map<string, Agent>();
  // Which agent made each tool call, so a command it leaves running can be traced back to it.
  private readonly calls = new Map<string, Agent>();
  private readonly background = new Map<string, Agent | null>();
  private readonly cancelled = new Set<Agent>();
  private readonly pages: Array<DetailPost | null> = [];
  private readonly stale = new Set<number>();
  private detail: DetailSink | null = null;
  private opened = false;
  private timer: NodeJS.Timeout | null = null;
  private writes: Promise<void> = Promise.resolve();
  private readonly say: Say;
  private readonly sink: MessageSink;
  private readonly title: string;
  private readonly now: () => number;
  private readonly paceMs: number;
  private readonly stopTask: (taskId: string) => void;

  // stopTask is how an agent that was stopped is stopped again, should the session send it back to work.
  constructor(
    say: Say,
    sink: MessageSink,
    title: string,
    now: () => number = Date.now,
    paceMs: number = PACE_MS,
    stopTask: (taskId: string) => void = () => undefined,
  ) {
    this.say = say;
    this.sink = sink;
    this.title = title;
    this.now = now;
    this.paceMs = paceMs;
    this.stopTask = stopTask;
  }

  // Returns the one line the trail gets about an agent: that it ended, named, with how long it took, as the terminal reports it.
  observe(event: AgentEvent): string | null {
    if (event.kind === "started") {
      this.start(event);
      return null;
    }
    if (event.kind === "background") {
      const owner = (event.toolUseId ? this.calls.get(event.toolUseId) : undefined) ?? null;
      this.background.set(event.taskId, owner);
      if (owner) this.touch(owner);
      return null;
    }
    if (event.kind === "ended" && this.background.has(event.taskId)) {
      const owner = this.background.get(event.taskId);
      this.background.delete(event.taskId);
      if (owner) this.touch(owner);
      return null;
    }
    const agent = this.agents.get(event.taskId);
    if (!agent) return null;

    if (event.kind === "progress") {
      this.resume(agent);
      // The stream sometimes repeats the task as the activity, which says nothing the task does not.
      agent.activity = event.activity === agent.description ? "" : event.activity;
      agent.toolUses = agent.earlierToolUses + event.toolUses;
      agent.tokens = event.tokens;
      this.touch(agent);
      return null;
    }
    if (agent.state !== "running") return null;
    agent.state = event.outcome;
    agent.toolUses = event.toolUses === null ? agent.toolUses : agent.earlierToolUses + event.toolUses;
    agent.tokens = event.tokens ?? agent.tokens;
    agent.durationMs = agent.earlierMs + (event.durationMs ?? this.now() - agent.startedAt);
    this.touch(agent);
    return this.say(ENDED[event.outcome], {
      name: truncate(agent.description || agent.type, DESCRIPTION_CHARS),
      elapsed: formatElapsed(this.say, agent.durationMs),
    });
  }

  // What a stop would reach: the agents at work, and the commands agents left running behind them.
  running(): string[] {
    return [...this.active().map((agent) => agent.taskId), ...this.background.keys()];
  }

  // The same, and a note of whose work it was: an agent stopped here is stopped again if the session sends it back.
  claim(): string[] {
    const taskIds = this.running();
    for (const agent of this.agents.values()) {
      const waiting = this.waiting(agent);
      if (agent.state !== "running" && !waiting) continue;
      this.cancelled.add(agent);
      if (waiting) agent.state = "stopped";
      this.touch(agent);
    }
    return taskIds;
  }

  noteCall(agentToolUseId: string, callId: string): void {
    const agent = this.byToolUse.get(agentToolUseId);
    if (agent) this.calls.set(callId, agent);
  }

  runningRemote(): string[] {
    return this.active()
      .filter((agent) => agent.remote)
      .map((agent) => agent.taskId);
  }

  // Null when there is nothing to stop, so no button is offered for it.
  stopLabel(): string | null {
    const active = this.active();
    if (active.length === 0 && this.background.size === 0) return null;
    const cloudOnly = this.background.size === 0 && active.every((agent) => agent.remote);
    return this.say(cloudOnly ? "stop.cloudTaskButton" : "stop.agentsButton");
  }

  private active(): Agent[] {
    return [...this.agents.values()].filter((agent) => agent.state === "running");
  }

  // Reported as finished while a command it started is still going; it is not done in any sense a reader means.
  private waiting(agent: Agent): boolean {
    return agent.state === "completed" && [...this.background.values()].includes(agent);
  }

  // True when the message came from inside an agent this board follows, not from the session itself.
  follows(toolUseId: string | null): boolean {
    return toolUseId !== null && this.byToolUse.has(toolUseId);
  }

  // Only where no side room can be had; with one, the roster is the single place agents are shown.
  block(): string {
    const all = [...this.agents.values()];
    if (all.length === 0 || this.detail) return "";
    if (!this.opened && this.sink.openDetail) return "";
    const running = all.filter((agent) => agent.state === "running" || this.waiting(agent));
    const tally = [
      this.tallied("agents.tallyRunning", running.length),
      this.tallied("agents.tallyDone", all.filter((agent) => agent.state === "completed" && !this.waiting(agent)).length),
      this.tallied("agents.tallyFailed", all.filter((agent) => agent.state === "failed").length),
      this.tallied("agents.tallyStopped", all.filter((agent) => agent.state === "stopped").length),
    ].filter(Boolean);
    const lines = running.slice(0, MAX_LISTED).map((agent) => `- ${this.line(agent)}`);
    if (running.length > MAX_LISTED) lines.push(`- ${this.say("agents.more", { quantity: running.length - MAX_LISTED })}`);
    return [this.say("agents.tally", { tally: tally.join(" · ") }), ...lines].join("\n");
  }

  private tallied(key: TallyKey, quantity: number): string {
    return quantity > 0 ? this.say(key, { quantity }) : "";
  }

  // A turn that is over has no agent still working, whatever the stream managed to say before it ended.
  end(): void {
    for (const agent of this.agents.values()) {
      if (agent.state !== "running") continue;
      agent.state = "stopped";
      agent.durationMs = agent.earlierMs + this.now() - agent.startedAt;
      this.stale.add(pageOf(agent));
    }
    for (const owner of this.background.values()) if (owner) this.stale.add(pageOf(owner));
    this.background.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.write();
  }

  async flush(): Promise<void> {
    await this.writes;
  }

  private start(event: Extract<AgentEvent, { kind: "started" }>): void {
    const known = this.agents.get(event.taskId);
    if (known) {
      if (event.toolUseId) this.byToolUse.set(event.toolUseId, known);
      this.resume(known);
      this.touch(known);
      return;
    }
    const agent: Agent = {
      index: this.agents.size + 1,
      taskId: event.taskId,
      remote: event.remote,
      type: event.agentType,
      description: event.description,
      state: "running",
      activity: "",
      toolUses: 0,
      tokens: 0,
      startedAt: this.now(),
      durationMs: 0,
      earlierToolUses: 0,
      earlierMs: 0,
    };
    this.agents.set(event.taskId, agent);
    if (event.toolUseId) this.byToolUse.set(event.toolUseId, agent);
    // A new agent shows at once; only the updates that follow are paced.
    this.stale.add(pageOf(agent));
    this.write();
  }

  // An agent that reported and was then sent back to work is running again, under the entry it already has.
  private resume(agent: Agent): void {
    if (agent.state === "running") return;
    agent.earlierToolUses = agent.toolUses;
    agent.earlierMs = agent.durationMs;
    agent.state = "running";
    agent.activity = "";
    agent.startedAt = this.now();
    if (this.cancelled.has(agent)) this.stopTask(agent.taskId);
  }

  private touch(agent: Agent): void {
    this.stale.add(pageOf(agent));
    if (this.paceMs <= 0) {
      this.write();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, this.paceMs);
    this.timer.unref();
  }

  // Writes go out one at a time, in order, and a failed one costs a line of detail, never the turn.
  private write(): void {
    const pages = [...this.stale].sort((first, second) => first - second);
    this.stale.clear();
    for (const page of pages) {
      this.writes = this.writes.then(() => this.writePage(page)).catch(() => undefined);
    }
  }

  private async writePage(page: number): Promise<void> {
    await this.open();
    if (!this.detail) return;
    const text = this.roster(page);
    const posted = this.pages[page];
    if (posted) await posted.revise(text);
    else this.pages[page] = await this.detail.post(text);
  }

  // The side room is opened by the first agent, so a turn that uses none never creates one.
  private async open(): Promise<void> {
    if (this.opened) return;
    this.opened = true;
    this.detail = (await this.sink.openDetail?.(this.title)) ?? null;
  }

  private roster(page: number): string {
    return [...this.agents.values()]
      .filter((agent) => pageOf(agent) === page)
      .map(
        (agent) =>
          `**${agent.index} · ${agent.type}** · ${truncate(agent.description, ROSTER_DESCRIPTION_CHARS)}\n${this.standing(agent, false)}`,
      )
      .join("\n\n");
  }

  private line(agent: Agent): string {
    return `${agent.type} · ${truncate(agent.description, DESCRIPTION_CHARS)} · ${this.standing(agent, true)}`;
  }

  // A running time is only true in the trail, which is redrawn every few seconds; the roster is written on change.
  private standing(agent: Agent, live: boolean): string {
    const tools = this.say("agents.tools", { count: agent.toolUses });
    const spent = agent.tokens > 0 ? `${tools} · ${this.tokens(agent.tokens)}` : tools;
    if (this.waiting(agent)) return `${this.say("agents.waiting")} · ${spent}`;
    if (agent.state !== "running") return `${this.ending(agent.state, agent.durationMs)} · ${spent}`;
    const doing = agent.activity
      ? `${truncate(agent.activity, ACTIVITY_CHARS)} · `
      : live
        ? ""
        : `${this.say("agents.running")} · `;
    const elapsed = live ? ` · ${formatElapsed(this.say, agent.earlierMs + this.now() - agent.startedAt)}` : "";
    return `${doing}${spent}${elapsed}`;
  }

  private ending(outcome: AgentOutcome, durationMs: number): string {
    return this.say(`agents.${outcome}`, { elapsed: formatElapsed(this.say, durationMs) });
  }

  private tokens(quantity: number): string {
    return quantity >= 1000
      ? this.say("units.kiloTokens", { thousands: (quantity / 1000).toFixed(1) })
      : this.say("units.tokens", { count: quantity });
  }
}

// A turn's agents can each be on something different, so their thread is named after what was asked of the turn as a whole.
export function agentsTitle(say: Say, asked: string): string {
  const line = asked.replace(/\s+/g, " ").trim();
  return line ? truncate(say("agents.title", { asked: line }), TITLE_CHARS) : say("agents.titleBare");
}

function pageOf(agent: Agent): number {
  return Math.floor((agent.index - 1) / PAGE_SIZE);
}
