import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { conversationOverwrites } from "../channelAccess.ts";
import { displayPath } from "../../displayPath.ts";
import { requireConversation } from "../binding.ts";
import type { Conversation } from "../../conversations.ts";
import { respond } from "../respond.ts";
import type { Say } from "../../i18n/index.ts";
import { errorMessage } from "../../text.ts";
import { NO_MENTIONS } from "../sink.ts";

async function applyChannelAccess(
  say: Say,
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
    return `\n\n${say("members.visibilityFailed", { error: errorMessage(error) })}`;
  }
}

// Membership is who can see the channel; driving the conversation takes operator access.
function describeConversation(say: Say, conversation: Conversation): string {
  const others = conversation.memberIds.length;
  const seen = others === 0 ? say("members.seenByNobody") : say("members.seenBy", { count: others });
  return `${say("members.runs", { cwd: displayPath(conversation.cwd) })} ${seen}`;
}

export async function handleInvite(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const say = bridge.language.say;
  const user = interaction.options.getUser("user", true);
  if (user.bot) {
    await respond(interaction, say("members.inviteBot"));
    return;
  }
  if (user.id === conversation.ownerId || conversation.memberIds.includes(user.id)) {
    await respond(interaction, say("members.alreadyIn", { user: user.username }));
    return;
  }

  const updated = await bridge.store.setMembers(conversation.sessionId, [...conversation.memberIds, user.id]);
  const accessWarning = await applyChannelAccess(say, interaction, updated);
  const invited = `${say("members.invited", { user: user.username })} ${describeConversation(say, updated)}`;

  await respond(interaction, `${invited}\n\n${say("members.inviteWarning")}${accessWarning}`);
}

export async function handleUninvite(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const say = bridge.language.say;
  const user = interaction.options.getUser("user", true);
  if (!conversation.memberIds.includes(user.id)) {
    await respond(interaction, say("members.notMember", { user: user.username }));
    return;
  }

  const updated = await bridge.store.setMembers(
    conversation.sessionId,
    conversation.memberIds.filter((id) => id !== user.id),
  );
  const accessWarning = await applyChannelAccess(say, interaction, updated);
  const removed = say("members.removed", { user: user.username });
  await respond(interaction, `${removed} ${describeConversation(say, updated)}${accessWarning}`);
}

export async function handleMembers(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const say = bridge.language.say;
  const watchers = conversation.memberIds.map((id) => `<@${id}>`).join(", ") || say("common.nobody");
  const summary = say("members.summary", { owner: `<@${conversation.ownerId}>`, watchers });
  await respond(interaction, {
    content: `${summary}\n\n${describeConversation(say, conversation)}`,
    allowedMentions: NO_MENTIONS,
  });
}
