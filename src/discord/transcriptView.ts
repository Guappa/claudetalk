import type { Exchange } from "../sessions/exchanges.ts";
import { count, truncate } from "../text.ts";

const MAX_EXCHANGE_CHARS = 1200;

export type ClockStyle = "discord" | "plain";

// Discord renders <t:...:t> in the reader's own zone; a file gets a clock that says whose it is.
function clock(at: Date, style: ClockStyle): string {
  if (style === "plain") return `${at.toISOString().slice(11, 16)} UTC`;
  return `<t:${Math.floor(at.getTime() / 1000)}:t>`;
}

function formatExchange(exchange: Exchange, style: ClockStyle): string {
  const who = exchange.role === "user" ? "You" : "Claude";
  return `**${who}** · terminal · ${clock(exchange.at, style)}\n${truncate(exchange.text, MAX_EXCHANGE_CHARS)}`;
}

export function formatExchanges(exchanges: Exchange[], style: ClockStyle = "discord"): string {
  return exchanges.map((exchange) => formatExchange(exchange, style)).join("\n\n");
}

export function describeDrift(exchanges: Exchange[]): string {
  const last = exchanges.at(-1);
  const when = last ? ` The last was at ${clock(last.at, "discord")}.` : "";
  return (
    `${count(exchanges.length, "message")} happened in this conversation outside Discord since you were last here.` +
    `${when} Run \`/sync\` to see them.`
  );
}
