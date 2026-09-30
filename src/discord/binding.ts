import type { ButtonInteraction, ChatInputCommandInteraction, Guild } from "discord.js";
import type { Bridge } from "../bridge.ts";
import type { Conversation } from "../conversations.ts";
import { respond } from "./respond.ts";

export async function requireConversation(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
  unbound: string = bridge.language.say("binding.unbound"),
): Promise<Conversation | null> {
  const conversation = bridge.store.byChannel(interaction.channelId);
  if (conversation) return conversation;
  await respond(interaction, unbound);
  return null;
}

export async function requireGuild(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<Guild | null> {
  if (interaction.guild) return interaction.guild;
  await respond(interaction, bridge.language.say("binding.notInServer"));
  return null;
}
