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
import { HELLO_AFTER_CLEAR } from "../../claude/prompts.ts";
import { displayPath } from "../../displayPath.ts";
import type { Say } from "../../i18n/index.ts";
import { displayName } from "../../sessions/displayName.ts";
import { requireConversation } from "../binding.ts";
import { CLEAR_CANCEL, CLEAR_CONFIRM } from "../menus.ts";
import { respond, settleMenu } from "../respond.ts";
import { channelSink } from "../sink.ts";
import { runConversationTurn } from "../turn.ts";

export function describeClear(say: Say, cwd: string): string {
  return say("clear.confirm", { cwd: displayPath(cwd) });
}

export async function handleClear(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const say = bridge.language.say;
  const conversation = await requireConversation(bridge, interaction, say("clear.unbound"));
  if (!conversation) return;

  if (bridge.flow.isRunning(conversation.sessionId)) {
    await respond(interaction, say("clear.running"));
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CLEAR_CONFIRM).setLabel(say("clear.startOver")).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CLEAR_CANCEL).setLabel(say("common.cancel")).setStyle(ButtonStyle.Secondary),
  );
  await respond(interaction, { content: describeClear(say, conversation.cwd), components: [row] });
}

// The same channel, settings and members, wrapped around a conversation that remembers nothing.
export async function clearConversation(bridge: Bridge, interaction: ButtonInteraction): Promise<void> {
  const say = bridge.language.say;
  const previous = bridge.store.byChannel(interaction.channelId);
  if (!previous) {
    await settleMenu(interaction, say("clear.noLongerBound"));
    return;
  }
  if (bridge.flow.isRunning(previous.sessionId)) {
    await settleMenu(interaction, say("clear.running"));
    return;
  }

  const record = await bridge.sessions.find(previous.sessionId);
  const fresh = await rebindFresh(bridge, previous);
  await settleMenu(interaction, say("clear.done", { cwd: displayPath(fresh.cwd), sessionId: previous.sessionId }));

  const channel = interaction.channel;
  if (!channel?.isSendable()) return;
  await runConversationTurn(bridge, fresh, {
    actorId: interaction.user.id,
    prompt: HELLO_AFTER_CLEAR,
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
