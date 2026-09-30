import type { Say } from "../i18n/index.ts";
import type { Exchange } from "../sessions/exchanges.ts";
import { truncate } from "../text.ts";
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

function formatExchange(say: Say, exchange: Exchange, style: ClockStyle): string {
  const heading = say(exchange.role === "user" ? "sync.fromYou" : "sync.fromClaude", { clock: clock(exchange.at, style) });
  // Several exchanges share one message, so each is sealed on its own.
  return `${heading}\n${defuseStrayMarkup(truncate(exchange.text, MAX_EXCHANGE_CHARS))}`;
}

export function formatExchanges(say: Say, exchanges: Exchange[], style: ClockStyle = "discord"): string {
  return exchanges.map((exchange) => formatExchange(say, exchange, style)).join("\n\n");
}

// Newest last, as many of the latest as fit the budget together; the newest one always fits on its own.
export function latestThatFit(say: Say, exchanges: Exchange[], budget: number): Exchange[] {
  const recent: Exchange[] = [];
  for (let index = exchanges.length - 1; index >= 0 && recent.length < MAX_RECENT; index -= 1) {
    const exchange = exchanges[index]!;
    if (recent.length > 0 && formatExchanges(say, [exchange, ...recent]).length > budget) break;
    recent.unshift(exchange);
  }
  return recent;
}

// Only ever asked about drift that exists, so there is always a last exchange to give the time of.
export function describeDrift(say: Say, exchanges: Exchange[]): string {
  return say("sync.drift", { count: exchanges.length, clock: clock(exchanges.at(-1)!.at, "discord") });
}
