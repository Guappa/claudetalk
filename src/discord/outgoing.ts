import type { Message, SendableChannels } from "discord.js";
import { redactHome } from "../displayPath.ts";
import { DISCORD_MESSAGE_LIMIT } from "./limits.ts";
import { chunkForDiscord } from "./renderer.ts";
import { defuseStrayMarkup } from "./strayMarkup.ts";

const TIGHTEN_BY = 100;

// The one gate between the bridge and Discord: no account's path and no stray markup gets past it.
export function forDiscord(text: string): string {
  return defuseStrayMarkup(redactHome(text));
}

// The gate escapes stray markers, which lengthens a text, so the split is tightened until every piece still fits after it; a piece over the limit is refused by Discord and nothing is posted.
export function splitForDiscord(text: string, room: number = DISCORD_MESSAGE_LIMIT): string[] {
  // Escaping every character doubles a text at most, so a piece half as long as the room always fits once it is through the gate.
  const alwaysFits = Math.floor(room / 2);
  // Redacted before it is cut: a path that a cut falls inside is no longer a path to the gate, and its tail would be posted.
  const whole = redactHome(text);
  for (let limit = room; limit > alwaysFits; limit -= TIGHTEN_BY) {
    const pieces = chunkForDiscord(whole, limit);
    if (pieces.every((piece) => forDiscord(piece).length <= room)) return pieces;
  }
  return chunkForDiscord(whole, alwaysFits);
}

// The start of a text, cut where one message ends and no further: code blocks are closed, so what follows the cut is not drawn as code, and the gate's escapes are counted.
export function fitForDiscord(text: string, room: number): string {
  const whole = redactHome(text);
  const alwaysFits = Math.floor(room / 2);
  let first = whole;
  let cut = false;
  for (let limit = room; limit > alwaysFits; limit -= TIGHTEN_BY) {
    const pieces = chunkForDiscord(whole, limit);
    first = pieces[0] ?? "";
    cut = pieces.length > 1;
    if (forDiscord(first).length <= room) break;
  }
  return cut ? `${first}\n…` : first;
}

// A name is not drawn as Markdown, so only the path redaction applies to it.
export function nameForDiscord(text: string): string {
  return redactHome(text);
}

// What a menu shows for an option is as public as a message; its value only ever comes back to the bridge.
export function optionForDiscord<Option extends { label: string; description?: string }>(option: Option): Option {
  const shown = { ...option, label: nameForDiscord(option.label) };
  return option.description === undefined ? shown : { ...shown, description: nameForDiscord(option.description) };
}

export function choicesForDiscord<Choice extends { name: string }>(choices: Choice[]): Choice[] {
  return choices.map((choice) => ({ ...choice, name: nameForDiscord(choice.name) }));
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
