import { randomUUID } from "node:crypto";
import { APPROVAL_REFUSED } from "../claude/prompts.ts";
import type { ToolDecision } from "../claude/runner.ts";
import { displayPath, redactHome } from "../displayPath.ts";
import type { Say } from "../i18n/index.ts";
import { truncate } from "../text.ts";
import type { Delivery, MessageSink, SinkAction } from "./messageSink.ts";
import { approvalActionId, type ApprovalChoice } from "./menus.ts";

export type { ApprovalChoice } from "./menus.ts";
// What a person chose, or that the turn was over or the time was up before anyone did.
type Settlement = ApprovalChoice | "ended" | "expired";

// Long enough to answer from a phone, short enough that a forgotten prompt does not hold a turn open.
const APPROVAL_TIMEOUT_MS = 5 * 60_000;
const DETAIL_LIMIT = 900;

interface Pending {
  turnId: string;
  ownerIds: string[];
  settle: (choice: Settlement) => void;
}

function detail(input: Record<string, unknown>): string {
  const target = input.file_path ?? input.path;
  const other = input.command ?? input.url ?? input.pattern;
  const shown =
    typeof target === "string" ? displayPath(target) : redactHome(typeof other === "string" ? other : JSON.stringify(input));
  return truncate(shown, DETAIL_LIMIT);
}

export function describeRequest(say: Say, toolName: string, input: Record<string, unknown>): string {
  return say("approvals.request", { tool: toolName, detail: detail(input) });
}

// No offer to approve the rest of the turn: a delete outside the folder is let through one command at a time or not at all.
function onceActions(say: Say, id: string): SinkAction[] {
  return [
    { id: approvalActionId("approve", id), label: say("approvals.approveOnce") },
    { id: approvalActionId("deny", id), label: say("approvals.deny"), tone: "danger" },
  ];
}

function approvalActions(say: Say, id: string): SinkAction[] {
  return [
    { id: approvalActionId("approve", id), label: say("approvals.approveOnce") },
    { id: approvalActionId("deny", id), label: say("approvals.deny"), tone: "danger" },
    { id: approvalActionId("approve-all", id), label: say("approvals.approveRest") },
  ];
}

function describeChoice(say: Say, choice: Settlement): string {
  if (choice === "ended") return say("approvals.ended");
  if (choice === "expired") return say("approvals.expired", { minutes: APPROVAL_TIMEOUT_MS / 60_000 });
  if (choice === "approve") return say("approvals.approvedOnce");
  if (choice === "approve-all") return say("approvals.approvedRest");
  return say("approvals.denied");
}

// One per turn: a decision to approve the rest of it must not outlive the turn it was given for.
export class ApprovalPrompts {
  private readonly pending = new Map<string, Pending>();
  private readonly approveAll = new Set<string>();

  decide(say: Say, id: string, userId: string, choice: ApprovalChoice): string {
    const waiting = this.pending.get(id);
    if (!waiting) return say("approvals.stale");
    if (!waiting.ownerIds.includes(userId)) return say("approvals.ownersOnly");

    this.pending.delete(id);
    waiting.settle(choice);
    if (choice !== "approve-all") return describeChoice(say, choice);

    this.approveAll.add(waiting.turnId);
    // Tools asked about side by side each have a prompt on screen; the rest of the turn includes those, or each would wait out its timer and be denied.
    for (const [otherId, other] of this.pending) {
      if (other.turnId !== waiting.turnId) continue;
      this.pending.delete(otherId);
      other.settle("approve-all");
    }
    return say("approvals.approvedRestQuiet");
  }

  covers(turnId: string): boolean {
    return this.approveAll.has(turnId);
  }

  // The standing approval was given for the turn as it stood. A message added to it since may be somebody else's, and is asked about afresh.
  revoke(turnId: string): void {
    this.approveAll.delete(turnId);
  }

  async ask(
    say: Say,
    turnId: string,
    sink: MessageSink,
    ownerIds: string[],
    toolName: string,
    input: Record<string, unknown>,
    delivery?: Delivery,
  ): Promise<ToolDecision> {
    if (this.approveAll.has(turnId)) return { allow: true };
    return await this.put(say, turnId, sink, ownerIds, describeRequest(say, toolName, input), approvalActions, delivery);
  }

  // Asked whatever the turn was approved for: approving the rest of a turn was said of ordinary calls, never of a delete outside its folder.
  async askAboutDelete(
    say: Say,
    turnId: string,
    sink: MessageSink,
    ownerIds: string[],
    command: string,
    delivery?: Delivery,
  ): Promise<ToolDecision> {
    const request = say("approvals.deleteOutside", { detail: detail({ command }) });
    return await this.put(say, turnId, sink, ownerIds, request, onceActions, delivery);
  }

  private async put(
    say: Say,
    turnId: string,
    sink: MessageSink,
    ownerIds: string[],
    request: string,
    actionsFor: (say: Say, id: string) => SinkAction[],
    delivery?: Delivery,
  ): Promise<ToolDecision> {
    // Without a way to ask, the safe answer is the one that does not act.
    if (!sink.ask) return { allow: false, reason: APPROVAL_REFUSED.unaskable };

    const id = randomUUID();
    const { promise: answered, resolve: settle } = Promise.withResolvers<Settlement>();

    this.pending.set(id, { turnId, ownerIds, settle });
    const timer = setTimeout(() => {
      if (this.pending.delete(id)) settle("expired");
    }, APPROVAL_TIMEOUT_MS);
    timer.unref();

    // A prompt that never reached Discord can never be answered, so it is refused now and nothing is left waiting on it.
    const handle = await sink.ask(request, actionsFor(say, id), delivery).catch(() => null);
    if (!handle) {
      this.pending.delete(id);
      clearTimeout(timer);
      return { allow: false, reason: APPROVAL_REFUSED.unshown };
    }
    const choice = await answered;
    clearTimeout(timer);

    await handle.close(describeChoice(say, choice));

    if (choice === "approve" || choice === "approve-all") return { allow: true };
    return { allow: false, reason: APPROVAL_REFUSED[choice === "deny" ? "denied" : choice] };
  }

  // A turn's standing approval dies with it, and so does anything of its own still waiting on an answer.
  finish(turnId: string): void {
    this.approveAll.delete(turnId);
    for (const [id, waiting] of this.pending) {
      if (waiting.turnId !== turnId) continue;
      this.pending.delete(id);
      waiting.settle("ended");
    }
  }
}
