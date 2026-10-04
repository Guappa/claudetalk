import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { UNBIND_DELETE, UNBIND_KEEP } from "../menus.ts";
import { stopBackgroundSession } from "../../sessions/activeSessions.ts";
import { requireConversation } from "../binding.ts";
import { describeStop, describeStopTurn, preflight } from "../turnFlow.ts";
import { describeDepth } from "../turnQueue.ts";
import { respond } from "../respond.ts";
import { isProcessAlive, lockPathBeside } from "../../instanceLock.ts";
import { killTree } from "../../platform.ts";
import { setTimeout as wait } from "node:timers/promises";
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

// Ending a process takes a moment to show, and a conversation is only free once its holder is gone.
const CLOSE_WAIT_MS = 5000;
const CLOSE_POLL_MS = 100;

async function goneWithin(pid: number, waitMs: number): Promise<boolean> {
  for (let waited = 0; waited < waitMs; waited += CLOSE_POLL_MS) {
    if (!isProcessAlive(pid)) return true;
    await wait(CLOSE_POLL_MS);
  }
  return !isProcessAlive(pid);
}

// The message that was refused over what has just been freed runs now, and the reply says which of the two it is.
function afterTakeover(bridge: Bridge, channelId: string): string {
  const held = bridge.heldMessages.take(channelId);
  if (!held) return bridge.language.say("takeover.free");
  // Not waited for: the turn it starts can run for an hour, and the command is answered now.
  void held().catch((error: unknown) => console.error(`the message held for a takeover in ${channelId} could not be run`, error));
  return bridge.language.say("takeover.heldRuns");
}

export async function handleTakeover(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const say = bridge.language.say;
  if (bridge.flow.isRunning(conversation.sessionId)) {
    await respond(interaction, say("takeover.running"));
    return;
  }

  // Asked afresh: what was listed a moment ago may name a terminal that has since started a turn, or a pid that is someone else's by now.
  bridge.sessions.forgetLive();
  const check = preflight(say, await bridge.sessions.find(conversation.sessionId));

  if (check.kind === "ok") {
    await respond(interaction, say("takeover.nothingHolding"));
    return;
  }
  if (check.kind === "refused") {
    await respond(interaction, check.message);
    return;
  }
  if (check.kind === "terminal-idle") {
    killTree(check.pid);
    const closed = await goneWithin(check.pid, CLOSE_WAIT_MS);
    bridge.sessions.forgetLive();
    if (!closed) {
      await respond(interaction, say("takeover.notClosed", { pid: check.pid }));
      return;
    }
    const closedThere = say("takeover.closedTerminal", { pid: check.pid, sessionId: conversation.sessionId });
    await respond(interaction, `${closedThere} ${afterTakeover(bridge, interaction.channelId)}`);
    return;
  }

  const output = await stopBackgroundSession(check.shortId);
  bridge.sessions.forgetLive();
  const stopped = `${say("takeover.stopped", { shortId: check.shortId })} ${output}`.trim();
  await respond(interaction, `${stopped} ${afterTakeover(bridge, interaction.channelId)}`);
}
