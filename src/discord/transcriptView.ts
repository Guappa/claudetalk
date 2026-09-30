import type { Say } from "../i18n/index.ts";
import type { Exchange, ExchangesRead } from "../sessions/exchanges.ts";
import { TAIL_BYTES } from "../sessions/transcriptTail.ts";
import { truncate, utcDateAndTime } from "../text.ts";
import { defuseStrayMarkup } from "./strayMarkup.ts";
import { dateAndTime, howLongAgo } from "./timestamps.ts";

const MAX_EXCHANGE_CHARS = 1200;
// Where you left off is a glance at the last few messages; the whole run belongs in a file.
const MAX_RECENT = 4;

export type ClockStyle = "discord" | "plain";

// Always with its date: a time alone reads as today, and what is being caught up on can be weeks old.
function clock(at: Date, style: ClockStyle): string {
  return style === "plain" ? utcDateAndTime(at) : dateAndTime(at);
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

// Said beside any count of what happened outside Discord that could not be read all the way back, so the count is never taken for the whole.
export function describeUnread(say: Say, read: ExchangesRead): string {
  return read.reachesBack ? "" : say("sync.countedRecent", { megabytes: TAIL_BYTES / 1024 / 1024 });
}

// Only ever asked about drift that exists, so there is always a last exchange to give the time of.
export function describeDrift(say: Say, drift: ExchangesRead): string {
  const last = drift.exchanges.at(-1)!.at;
  const notice = say("sync.drift", { count: drift.exchanges.length, ago: howLongAgo(last), when: dateAndTime(last) });
  return [notice, describeUnread(say, drift)].filter(Boolean).join(" ");
}
