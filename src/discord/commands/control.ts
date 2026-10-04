import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { UNBIND_DELETE, UNBIND_KEEP } from "../menus.ts";
import { stopBackgroundSession } from "../../sessions/activeSessions.ts";
import { requireConversation } from "../binding.ts";
import { describeStop, describeStopTurn, preflight } from "../turnFlow.ts";
import { describeDepth } from "../turnQueue.ts";
import { respond } from "../respond.ts";
import { lockPathBeside } from "../../instanceLock.ts";
import { requestStop } from "../../stopSignal.ts";

export async function handleStop(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const say = bridge.language.say;
  const conversation = bridge.store.byChannel(interaction.channelId);
  if (interaction.options.getBoolean("all")) {
    const outcome = conversation ? bridge.flow.stop(conversation.sessionId) : { stopped: false, dropped: 0 };
    await respond(interaction, describeStop(say, outcome));
    return;
  }
  const outcome = conversation ? bridge.flow.stopTurn(conversation.sessionId) : { stopped: false, queued: 0 };
  await respond(interaction, describeStopTurn(say, outcome));
}

// Checked before anything is asked of the bridge: a restart onto code that will not start is a bridge that is gone, and whoever asked may be nowhere near the host.
export async function handleRestart(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const say = bridge.language.say;
  if (!bridge.supervised) {
    await respond(interaction, say("restart.unsupervised"));
    return;
  }
  const check = await bridge.checkBoot();
  if (!check.ok) {
    const refusal = check.timedOut
      ? say("restart.checkTimedOut")
      : say("restart.broken", { error: check.output || say("common.unknown") });
    await respond(interaction, refusal);
    return;
  }
  await bridge.restartNote.add({ channelId: interaction.channelId, userId: interaction.user.id });
  const turns = bridge.flow.activeCount();
  // Answered before it is asked for: with nothing running the bridge is gone within the second, and a reply sent after that never arrives.
  await respond(interaction, turns === 0 ? say("restart.now") : say("restart.afterTurns", { count: turns }));
  await requestStop(lockPathBeside(bridge.config.bindingsPath), "restart");
}

export async function handleQueue(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const conversation = bridge.store.byChannel(interaction.channelId);
  const depth = conversation ? bridge.flow.queueDepth(conversation.sessionId) : 0;
  await respond(interaction, describeDepth(bridge.language.say, depth));
}

// Unbinding is safe and immediate; deleting the channel is not, so that part waits for a press.
export async function handleUnbind(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const say = bridge.language.say;
  const conversation = await requireConversation(bridge, interaction, say("unbind.unbound"));
  if (!conversation) return;
  if (bridge.flow.isRunning(conversation.sessionId)) {
    await respond(interaction, say("unbind.running"));
    return;
  }

  await bridge.store.unbind(interaction.channelId);
  // A channel that only answered when tagged was never the conversation's own, so deleting it is not offered.
  if (conversation.mentionOnly) {
    await respond(interaction, say("unbind.doneShared"));
    return;
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(UNBIND_DELETE).setLabel(say("unbind.deleteChannel")).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(UNBIND_KEEP).setLabel(say("unbind.keep")).setStyle(ButtonStyle.Secondary),
  );
  await respond(interaction, { content: say("unbind.done"), components: [row] });
}

export async function handleTakeover(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const say = bridge.language.say;
  if (bridge.flow.isRunning(conversation.sessionId)) {
    await respond(interaction, say("takeover.running"));
    return;
  }

  const check = preflight(say, await bridge.sessions.find(conversation.sessionId));

  if (check.kind === "ok") {
    await respond(interaction, say("takeover.nothingHolding"));
    return;
  }
  if (check.kind === "refused") {
    await respond(interaction, check.message);
    return;
  }

  const output = await stopBackgroundSession(check.shortId);
  bridge.sessions.forgetLive();
  await respond(interaction, `${say("takeover.stopped", { shortId: check.shortId })} ${output}`.trim());
}
