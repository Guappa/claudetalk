import type { ButtonInteraction, ChatInputCommandInteraction, Guild } from "discord.js";
import type { Bridge } from "../bridge.ts";
import type { Conversation } from "../conversations.ts";
import { respond } from "./respond.ts";

const UNBOUND = "This channel isn't bound to a conversation yet.";

export async function requireConversation(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
  unbound = UNBOUND,
): Promise<Conversation | null> {
  const conversation = bridge.store.byChannel(interaction.channelId);
  if (conversation) return conversation;
  await respond(interaction, unbound);
  return null;
}

export async function requireGuild(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<Guild | null> {
  if (interaction.guild) return interaction.guild;
  await respond(
    interaction,
    "Conversations only exist inside a server, not in a DM. Run this in a channel of the server the bridge is configured for.",
  );
  return null;
}

export function describeAlreadyOpen(name: string, channelId: string): string {
  return `**${name}** is already open in <#${channelId}>.`;
}
