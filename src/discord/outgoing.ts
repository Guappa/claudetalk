import type { Message, SendableChannels } from "discord.js";
import { redactHome } from "../displayPath.ts";
import { defuseStrayMarkup } from "./strayMarkup.ts";

// The one gate between the bridge and Discord: no account's path and no stray markup gets past it.
export function forDiscord(text: string): string {
  return defuseStrayMarkup(redactHome(text));
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
