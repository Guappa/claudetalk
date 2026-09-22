import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { UNBIND_DELETE, UNBIND_KEEP } from "../menus.ts";
import { stopBackgroundSession } from "../../sessions/activeSessions.ts";
import { requireConversation } from "../binding.ts";
import { describeStop, preflight } from "../turnFlow.ts";
import { describeDepth } from "../turnQueue.ts";
import { respond } from "../respond.ts";

export async function handleStop(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = bridge.store.byChannel(interaction.channelId);
  const outcome = conversation ? bridge.flow.stop(conversation.sessionId) : { stopped: false, dropped: 0 };
  await respond(interaction, describeStop(outcome));
}

export async function handleQueue(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = bridge.store.byChannel(interaction.channelId);
  const depth = conversation ? bridge.flow.queueDepth(conversation.sessionId) : 0;
  await respond(interaction, describeDepth(depth));
}

// Unbinding is safe and immediate; deleting the channel is not, so that part waits for a press.
export async function handleUnbind(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await bridge.store.unbind(interaction.channelId);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(UNBIND_DELETE).setLabel("Delete the channel").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(UNBIND_KEEP).setLabel("Keep it").setStyle(ButtonStyle.Secondary),
  );
  await respond(interaction, {
    content:
      "Unbound. The conversation is still on the host and can be resumed with `/resume`. " +
      "The channel is now just a channel; delete it, or keep it for the history?",
    components: [row],
  });
}

export async function handleTakeover(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  if (bridge.flow.isRunning(conversation.sessionId)) {
    await respond(interaction, "A turn is running here right now. Use `/stop` to end it.");
    return;
  }

  const check = preflight(await bridge.sessions.find(conversation.sessionId));

  if (check.kind === "ok") {
    await respond(interaction, "Nothing is holding this conversation. Just send a message.");
    return;
  }
  if (check.kind === "refused") {
    await respond(interaction, check.message);
    return;
  }

  const output = await stopBackgroundSession(check.shortId);
  await respond(interaction, `Stopped background agent \`${check.shortId}\`. ${output}`.trim());
}
