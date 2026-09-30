import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { errorMessage } from "../../text.ts";
import { PURGE_CANCEL, PURGE_CONFIRM } from "../menus.ts";
import { postText } from "../outgoing.ts";
import { describePurge, purgeChannel } from "../purge.ts";
import { respond, settleMenu } from "../respond.ts";

// Only a channel that is a view of a conversation has a host-side history the warning can promise survives.
function isConversationChannel(bridge: Bridge, channelId: string): boolean {
  const conversation = bridge.store.byChannel(channelId);
  return conversation !== undefined && !conversation.mentionOnly;
}

export async function handlePurgeCommand(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const say = bridge.language.say;
  if (!interaction.channel || !("bulkDelete" in interaction.channel)) {
    await respond(interaction, say("purge.notDeletable"));
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PURGE_CONFIRM).setLabel(say("purge.confirm")).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(PURGE_CANCEL).setLabel(say("common.cancel")).setStyle(ButtonStyle.Secondary),
  );

  const lines: string[] = [say("purge.warning")];
  if (isConversationChannel(bridge, interaction.channelId)) lines.push("", say("purge.warningConversation"));

  await respond(interaction, { content: lines.join("\n"), components: [row] });
}

export async function cancelPurge(bridge: Bridge, interaction: ButtonInteraction) {
  await settleMenu(interaction, bridge.language.say("purge.cancelled"));
}

export async function confirmPurge(bridge: Bridge, interaction: ButtonInteraction) {
  const say = bridge.language.say;
  const channel = interaction.channel;
  if (!channel || !("bulkDelete" in channel)) {
    await settleMenu(interaction, say("purge.notDeletable"));
    return;
  }
  await settleMenu(interaction, say("purge.deleting"));
  const outcome = await purgeChannel(channel, interaction.message.id).then(
    (result) => describePurge(say, result, isConversationChannel(bridge, interaction.channelId)),
    (error: unknown) => say("purge.stoppedPartway", { error: errorMessage(error) }),
  );
  // A long purge outlasts the fifteen minutes a press can be answered for, so the result is then said in the channel.
  await settleMenu(interaction, outcome).catch(() => postText(channel, outcome));
}
