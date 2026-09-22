import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import type { UsageTotals } from "../../claude/usageLedger.ts";
import { describePlanUsage } from "../../claude/planUsage.ts";
import { count } from "../../text.ts";
import { requireConversation } from "../binding.ts";
import { respond } from "../respond.ts";

function money(amount: number): string {
  return amount < 0.01 && amount > 0 ? "under $0.01" : `$${amount.toFixed(2)}`;
}

function tokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

function describeTotals(label: string, totals: UsageTotals): string {
  if (totals.turns === 0) return `${label}: nothing yet.`;
  return `${label}: ${count(totals.turns, "turn")} here · ${tokens(totals.inputTokens)} in, ${tokens(totals.outputTokens)} out, ${tokens(totals.cachedTokens)} cached`;
}

// A subscription is not billed in dollars; the figure only ranks conversations against each other.
function describeCost(mine: UsageTotals, all: UsageTotals): string {
  if (all.turns === 0) return "";
  const last = mine.lastCostUsd === null ? "" : ` (last turn ${money(mine.lastCostUsd)})`;
  return (
    `API-equivalent cost, which a subscription is not billed by: ${money(mine.costUsd)} this conversation ` +
    `over its life${last}, ${money(all.costUsd)} across every conversation touched.`
  );
}

export async function handleSpend(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const mine = bridge.usage.forSession(conversation.sessionId);
  const all = bridge.usage.total();
  const since = bridge.usage.since();
  const stamp = `<t:${Math.floor(since.getTime() / 1000)}:R>`;

  await respond(
    interaction,
    [
      describePlanUsage(bridge.planUsage.latest()),
      describeTotals("This conversation", mine),
      describeTotals("Every conversation touched", all),
      describeCost(mine, all),
      `Plan usage is for the whole account. Turns and tokens are counted since the bridge started ${stamp}; ` +
        "a restart resets them, and turns run in a terminal are never counted.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
