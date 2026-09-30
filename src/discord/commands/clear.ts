import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { HELLO_AFTER_CLEAR } from "../../claude/prompts.ts";
import { displayPath } from "../../displayPath.ts";
import type { Say } from "../../i18n/index.ts";
import { displayName } from "../../sessions/displayName.ts";
import { requireConversation } from "../binding.ts";
import { CLEAR_CANCEL, clearConfirmId } from "../menus.ts";
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
    new ButtonBuilder()
      .setCustomId(clearConfirmId(conversation.sessionId))
      .setLabel(say("clear.startOver"))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CLEAR_CANCEL).setLabel(say("common.cancel")).setStyle(ButtonStyle.Secondary),
  );
  await respond(interaction, { content: describeClear(say, conversation.cwd), components: [row] });
}

// The same channel, settings and members, wrapped around a conversation that remembers nothing.
export async function clearConversation(bridge: Bridge, interaction: ButtonInteraction, sessionId: string): Promise<void> {
  const say = bridge.language.say;
  // Answered before any work: reading the index can outlast the three seconds Discord gives a press.
  await interaction.deferUpdate();
  const record = await bridge.sessions.find(sessionId);

  // Nothing is awaited between these checks and the exchange, so a second press or a message cannot slip in between them.
  const previous = bridge.store.byChannel(interaction.channelId);
  if (previous?.sessionId !== sessionId) {
    await settleMenu(interaction, say("clear.stale"));
    return;
  }
  if (bridge.flow.isRunning(sessionId)) {
    await settleMenu(interaction, say("clear.running"));
    return;
  }

  const fresh = await bridge.store.startOver(previous, randomUUID());
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
