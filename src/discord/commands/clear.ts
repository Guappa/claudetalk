import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Bridge } from "../../bridge.ts";
import type { Conversation } from "../../conversations.ts";
import { displayPath } from "../../displayPath.ts";
import { displayName } from "../../sessions/displayName.ts";
import { requireConversation } from "../binding.ts";
import { CLEAR_CANCEL, CLEAR_CONFIRM } from "../menus.ts";
import { respond, settleMenu } from "../respond.ts";
import { channelSink } from "../sink.ts";
import { runConversationTurn } from "../turn.ts";

const RUNNING = "A turn is running here. Let it finish or `/stop` it, then `/clear`.";

export function describeClear(cwd: string): string {
  return (
    `This starts this channel over with a fresh conversation in \`${displayPath(cwd)}\`: the same folder, ` +
    "model, effort and members, but nothing remembered. The current conversation stays on the host, listed by " +
    "`/sessions`, and `/resume` with its session id reopens it. The channel's messages stay; `/purge` removes them."
  );
}

export async function handleClear(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const conversation = await requireConversation(
    bridge,
    interaction,
    "This channel isn't bound to a conversation, so there is nothing to clear.",
  );
  if (!conversation) return;

  if (bridge.flow.isRunning(conversation.sessionId)) {
    await respond(interaction, RUNNING);
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CLEAR_CONFIRM).setLabel("Start over").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CLEAR_CANCEL).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await respond(interaction, { content: describeClear(conversation.cwd), components: [row] });
}

// The same channel, settings and members, wrapped around a conversation that remembers nothing.
export async function clearConversation(bridge: Bridge, interaction: ButtonInteraction): Promise<void> {
  const previous = bridge.store.byChannel(interaction.channelId);
  if (!previous) {
    await settleMenu(interaction, "This channel is no longer bound to a conversation, so there is nothing to clear.");
    return;
  }
  if (bridge.flow.isRunning(previous.sessionId)) {
    await settleMenu(interaction, RUNNING);
    return;
  }

  const record = await bridge.sessions.find(previous.sessionId);
  const fresh = await rebindFresh(bridge, previous);
  await settleMenu(
    interaction,
    `Started over. This channel now holds a fresh conversation in \`${displayPath(fresh.cwd)}\`; ` +
      `the previous one is still on the host as \`${previous.sessionId}\`.`,
  );

  const channel = interaction.channel;
  if (!channel?.isSendable()) return;
  await runConversationTurn(bridge, fresh, {
    actorId: interaction.user.id,
    prompt:
      "This conversation was just started over from Discord in place of an earlier one in the same folder. " +
      "Say hello in one short line, naming the folder you are working in but not its full path.",
    sink: channelSink(channel, { latestPosts: bridge.latestPosts }),
    resume: false,
    name: record ? displayName(record) : undefined,
  });
}

async function rebindFresh(bridge: Bridge, previous: Conversation): Promise<Conversation> {
  await bridge.store.unbind(previous.channels.text);
  const fresh = await bridge.store.bindNew({
    sessionId: randomUUID(),
    cwd: previous.cwd,
    channelId: previous.channels.text,
    ownerId: previous.ownerId,
    settings: { ...previous.settings },
    mentionOnly: previous.mentionOnly,
  });
  if (previous.memberIds.length > 0) await bridge.store.setMembers(fresh.sessionId, previous.memberIds);
  if (previous.channels.voice) await bridge.store.attachChannel(fresh.sessionId, previous.channels.voice, "voice");
  return fresh;
}
