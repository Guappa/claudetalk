import { randomUUID } from "node:crypto";
import type { ToolDecision } from "../claude/runner.ts";
import { displayPath, redactHome } from "../displayPath.ts";
import { truncate } from "../text.ts";
import type { MessageSink, SinkAction } from "./messageSink.ts";

export type ApprovalChoice = "approve" | "deny" | "approve-all";

// Long enough to answer from a phone, short enough that a forgotten prompt does not hold a turn open.
const APPROVAL_TIMEOUT_MS = 5 * 60_000;
const DETAIL_LIMIT = 900;

const DENIED = "Denied from Discord.";
const EXPIRED = `No answer in ${APPROVAL_TIMEOUT_MS / 60_000} minutes, so it was denied.`;

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

export function describeRequest(toolName: string, input: Record<string, unknown>): string {
  return `**${toolName}** wants to run. Approve it?\n\`\`\`\n${detail(input)}\n\`\`\``;
}

function approvalActions(id: string): SinkAction[] {
  return [
    { id: `approve:${id}`, label: "Approve once" },
    { id: `deny:${id}`, label: "Deny", tone: "danger" },
    { id: `approve-all:${id}`, label: "Approve the rest of this turn" },
  ];
}

function describeChoice(choice: ApprovalChoice, expired = false): string {
  if (choice === "approve") return "Approved once.";
  if (choice === "approve-all") return "Approved for the rest of this turn.";
  return expired ? EXPIRED : DENIED;
}

// One per turn: a decision to approve the rest of it must not outlive the turn it was given for.
export class ApprovalPrompts {
  private readonly pending = new Map<string, Pending>();
  private readonly approveAll = new Set<string>();

  decide(id: string, userId: string, choice: ApprovalChoice): string {
    const waiting = this.pending.get(id);
    if (!waiting) return "That request is already answered, expired, or from before a restart.";
    if (!waiting.ownerIds.includes(userId)) return "Only an owner of this bridge can answer a permission request.";

    this.pending.delete(id);
    waiting.settle(choice);
    return choice === "approve-all" ? "Approved, and the rest of this turn will not ask again." : describeChoice(choice);
  }

  async ask(
    turnId: string,
    sink: MessageSink,
    ownerIds: string[],
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<ToolDecision> {
    if (this.approveAll.has(turnId)) return { allow: true };
    // Without a way to ask, the safe answer is the one that does not act.
    if (!sink.ask) return { allow: false, reason: "This conversation cannot show approval buttons." };

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

    const handle = await sink.ask(describeRequest(toolName, input), approvalActions(id));
    const choice = await answered;
    clearTimeout(timer);

    if (choice === "approve-all") this.approveAll.add(turnId);
    const outcome = describeChoice(choice, expired);
    await handle.close(outcome);

    return choice === "deny" ? { allow: false, reason: outcome } : { allow: true };
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
