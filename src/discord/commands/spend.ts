import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import type { UsageTotals } from "../../claude/usageLedger.ts";
import { describePlanUsage } from "../../claude/planUsage.ts";
import type { Say } from "../../i18n/index.ts";
import { requireConversation } from "../binding.ts";
import { respond } from "../respond.ts";

function money(say: Say, amount: number): string {
  return amount < 0.01 && amount > 0 ? say("spend.underCent") : `$${amount.toFixed(2)}`;
}

function tokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

function describeTotals(say: Say, whose: "mine" | "all", totals: UsageTotals): string {
  if (totals.turns === 0) return say(`spend.${whose}None`);
  return say(`spend.${whose}`, {
    count: totals.turns,
    input: tokens(totals.inputTokens),
    output: tokens(totals.outputTokens),
    cached: tokens(totals.cachedTokens),
  });
}

// A subscription is not billed in dollars; the figure only ranks conversations against each other.
function describeCost(say: Say, mine: UsageTotals, all: UsageTotals): string {
  if (all.turns === 0) return "";
  const costs = { mine: money(say, mine.costUsd), all: money(say, all.costUsd) };
  return mine.lastCostUsd === null
    ? say("spend.cost", costs)
    : say("spend.costWithLast", { ...costs, last: money(say, mine.lastCostUsd) });
}

export async function handleSpend(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const mine = bridge.usage.forSession(conversation.sessionId);
  const all = bridge.usage.total();
  const since = bridge.usage.since();
  const say = bridge.language.say;

  await respond(
    interaction,
    [
      describePlanUsage(say, bridge.planUsage.latest()),
      describeTotals(say, "mine", mine),
      describeTotals(say, "all", all),
      describeCost(say, mine, all),
      say("spend.footnote", { since: `<t:${Math.floor(since.getTime() / 1000)}:R>` }),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
