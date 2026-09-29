import type { Exchange } from "../sessions/exchanges.ts";
import { count, truncate } from "../text.ts";
import { defuseStrayMarkup } from "./strayMarkup.ts";

const MAX_EXCHANGE_CHARS = 1200;
// Where you left off is a glance at the last few messages; the whole run belongs in a file.
const MAX_RECENT = 4;

export type ClockStyle = "discord" | "plain";

// Discord renders <t:...:t> in the reader's own zone; a file gets a clock that says whose it is.
function clock(at: Date, style: ClockStyle): string {
  if (style === "plain") return `${at.toISOString().slice(11, 16)} UTC`;
  return `<t:${Math.floor(at.getTime() / 1000)}:t>`;
}

function formatExchange(exchange: Exchange, style: ClockStyle): string {
  const who = exchange.role === "user" ? "You" : "Claude";
  // Several exchanges share one message, so each is sealed on its own.
  return `**${who}** · terminal · ${clock(exchange.at, style)}\n${defuseStrayMarkup(truncate(exchange.text, MAX_EXCHANGE_CHARS))}`;
}

export function formatExchanges(exchanges: Exchange[], style: ClockStyle = "discord"): string {
  return exchanges.map((exchange) => formatExchange(exchange, style)).join("\n\n");
}

// Newest last, as many of the latest as fit the budget together; the newest one always fits on its own.
export function latestThatFit(exchanges: Exchange[], budget: number): Exchange[] {
  const recent: Exchange[] = [];
  for (let index = exchanges.length - 1; index >= 0 && recent.length < MAX_RECENT; index -= 1) {
    const exchange = exchanges[index]!;
    if (recent.length > 0 && formatExchanges([exchange, ...recent]).length > budget) break;
    recent.unshift(exchange);
  }
  return recent;
}

export function describeDrift(exchanges: Exchange[]): string {
  const last = exchanges.at(-1);
  const when = last ? ` The last was at ${clock(last.at, "discord")}.` : "";
  return (
    `${count(exchanges.length, "message")} happened in this conversation outside Discord since you were last here.` +
    `${when} Run \`/sync\` to see them.`
  );
}
