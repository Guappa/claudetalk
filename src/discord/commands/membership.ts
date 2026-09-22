import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { conversationOverwrites } from "../channelAccess.ts";
import { displayPath } from "../../displayPath.ts";
import { requireConversation } from "../binding.ts";
import type { Conversation } from "../../conversations.ts";
import { respond } from "../respond.ts";
import { count, errorMessage } from "../../text.ts";
import { NO_MENTIONS } from "../sink.ts";

async function applyChannelAccess(
  interaction: ChatInputCommandInteraction,
  conversation: Conversation,
): Promise<string> {
  const channel = interaction.channel;
  if (!interaction.guild || !channel || !("permissionOverwrites" in channel)) return "";

  try {
    await channel.permissionOverwrites.set(
      conversationOverwrites({
        everyoneRoleId: interaction.guild.roles.everyone.id,
        botUserId: interaction.client.user.id,
        ownerId: conversation.ownerId,
        memberIds: conversation.memberIds,
      }),
    );
    return "";
  } catch (error) {
    return (
      `\n\nAccess was recorded, but the channel's visibility could not be changed: ` +
      `${errorMessage(error)}. The bot needs Manage Roles for that.`
    );
  }
}

// Membership is who can see the channel; driving the conversation takes operator access.
function describeConversation(conversation: Conversation): string {
  const others = conversation.memberIds.length;
  const seen = others === 0 ? "Nobody else can see it." : `${count(others, "other")} can see it.`;
  return `Runs in \`${displayPath(conversation.cwd)}\` as the host user, with full machine access. ${seen}`;
}

export async function handleInvite(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const user = interaction.options.getUser("user", true);
  if (user.bot) {
    await respond(interaction, "Bots cannot be invited to a conversation; pick a person.");
    return;
  }
  if (user.id === conversation.ownerId || conversation.memberIds.includes(user.id)) {
    await respond(interaction, `${user.username} already has access to this conversation.`);
    return;
  }

  const updated = await bridge.store.setMembers(conversation.sessionId, [...conversation.memberIds, user.id]);
  const accessWarning = await applyChannelAccess(interaction, updated);

  const warning =
    "\n\nThis lets them **read** the channel, including everything already said here. It does not " +
    "let them use the bot: messages and commands from anyone who is not an operator are ignored. " +
    "`/operator add` is what hands over the machine.";

  await respond(
    interaction,
    `${user.username} can now see this conversation. ${describeConversation(updated)}${warning}${accessWarning}`,
  );
}

export async function handleUninvite(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const user = interaction.options.getUser("user", true);
  if (!conversation.memberIds.includes(user.id)) {
    await respond(interaction, `${user.username} is not a member of this conversation.`);
    return;
  }

  const updated = await bridge.store.setMembers(
    conversation.sessionId,
    conversation.memberIds.filter((id) => id !== user.id),
  );
  const accessWarning = await applyChannelAccess(interaction, updated);
  await respond(interaction, `${user.username} removed. ${describeConversation(updated)}${accessWarning}`);
}

export async function handleMembers(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const watchers = conversation.memberIds.map((id) => `<@${id}>`).join(", ") || "nobody";
  await respond(interaction, {
    content: `Owner: <@${conversation.ownerId}>\nCan see it: ${watchers}\n\n${describeConversation(conversation)}`,
    allowedMentions: NO_MENTIONS,
  });
}
