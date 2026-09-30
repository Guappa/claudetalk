import type { Message, SendableChannels } from "discord.js";
import { redactHome } from "../displayPath.ts";
import { DISCORD_MESSAGE_LIMIT, chunkForDiscord } from "./renderer.ts";
import { defuseStrayMarkup } from "./strayMarkup.ts";

// Escaping every character doubles a text at most, so a piece this long always fits once it is through the gate.
const ALWAYS_FITS = DISCORD_MESSAGE_LIMIT / 2;
const TIGHTEN_BY = 100;

// The one gate between the bridge and Discord: no account's path and no stray markup gets past it.
export function forDiscord(text: string): string {
  return defuseStrayMarkup(redactHome(text));
}

// The gate escapes stray markers, which lengthens a text, so the split is tightened until every piece still fits after it; a piece over the limit is refused by Discord and nothing is posted.
export function splitForDiscord(text: string): string[] {
  for (let limit = DISCORD_MESSAGE_LIMIT; limit > ALWAYS_FITS; limit -= TIGHTEN_BY) {
    const pieces = chunkForDiscord(text, limit);
    if (pieces.every((piece) => forDiscord(piece).length <= DISCORD_MESSAGE_LIMIT)) return pieces;
  }
  return chunkForDiscord(text, ALWAYS_FITS);
}

// A name is not drawn as Markdown, so only the path redaction applies to it.
export function nameForDiscord(text: string): string {
  return redactHome(text);
}

export async function postText(channel: SendableChannels, text: string): Promise<Message> {
  return await channel.send(forDiscord(text));
}

export async function replyText(message: Message, text: string): Promise<void> {
  await message.reply({ content: forDiscord(text), allowedMentions: { repliedUser: false } });
}

export async function replaceText(message: Message, text: string): Promise<void> {
  await message.edit({ content: forDiscord(text), components: [] });
}
