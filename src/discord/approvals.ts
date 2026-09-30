import { randomUUID } from "node:crypto";
import { APPROVAL_REFUSED } from "../claude/prompts.ts";
import type { ToolDecision } from "../claude/runner.ts";
import { displayPath, redactHome } from "../displayPath.ts";
import type { Say } from "../i18n/index.ts";
import { truncate } from "../text.ts";
import type { MessageSink, SinkAction } from "./messageSink.ts";

export type ApprovalChoice = "approve" | "deny" | "approve-all";

// Long enough to answer from a phone, short enough that a forgotten prompt does not hold a turn open.
const APPROVAL_TIMEOUT_MS = 5 * 60_000;
const DETAIL_LIMIT = 900;

interface Pending {
  turnId: string;
  ownerIds: string[];
  settle: (choice: ApprovalChoice) => void;
}

function detail(input: Record<string, unknown>): string {
  const target = input.file_path ?? input.path;
  const other = input.command ?? input.url ?? input.pattern;
  const shown =
    typeof target === "string"
      ? displayPath(target)
      : redactHome(typeof other === "string" ? other : JSON.stringify(input));
  return truncate(shown, DETAIL_LIMIT);
}

export function describeRequest(say: Say, toolName: string, input: Record<string, unknown>): string {
  return say("approvals.request", { tool: toolName, detail: detail(input) });
}

function approvalActions(say: Say, id: string): SinkAction[] {
  return [
    { id: `approve:${id}`, label: say("approvals.approveOnce") },
    { id: `deny:${id}`, label: say("approvals.deny"), tone: "danger" },
    { id: `approve-all:${id}`, label: say("approvals.approveRest") },
  ];
}

function describeChoice(say: Say, choice: ApprovalChoice, expired = false): string {
  if (choice === "approve") return say("approvals.approvedOnce");
  if (choice === "approve-all") return say("approvals.approvedRest");
  return expired ? say("approvals.expired", { minutes: APPROVAL_TIMEOUT_MS / 60_000 }) : say("approvals.denied");
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
    return choice === "approve-all" ? say("approvals.approvedRestQuiet") : describeChoice(say, choice);
  }

  async ask(
    say: Say,
    turnId: string,
    sink: MessageSink,
    ownerIds: string[],
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<ToolDecision> {
    if (this.approveAll.has(turnId)) return { allow: true };
    // Without a way to ask, the safe answer is the one that does not act.
    if (!sink.ask) return { allow: false, reason: APPROVAL_REFUSED.unaskable };

    const id = randomUUID();
    const { promise: answered, resolve: settle } = Promise.withResolvers<ApprovalChoice>();

    this.pending.set(id, { turnId, ownerIds, settle });
    let expired = false;
    const timer = setTimeout(() => {
      if (!this.pending.delete(id)) return;
      expired = true;
      settle("deny");
    }, APPROVAL_TIMEOUT_MS);
    timer.unref();

    const handle = await sink.ask(describeRequest(say, toolName, input), approvalActions(say, id));
    const choice = await answered;
    clearTimeout(timer);

    if (choice === "approve-all") this.approveAll.add(turnId);
    await handle.close(describeChoice(say, choice, expired));

    if (choice !== "deny") return { allow: true };
    return { allow: false, reason: expired ? APPROVAL_REFUSED.expired : APPROVAL_REFUSED.denied };
  }

  // A turn's standing approval dies with it, and so does anything of its own still waiting on an answer.
  finish(turnId: string): void {
    this.approveAll.delete(turnId);
    for (const [id, waiting] of this.pending) {
      if (waiting.turnId !== turnId) continue;
      this.pending.delete(id);
      waiting.settle("deny");
    }
  }
}
