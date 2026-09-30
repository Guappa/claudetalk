import { AttachmentBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { requireConversation } from "../binding.ts";
import { markCaughtUp, pendingDrift } from "../sync.ts";
import { formatExchanges, latestThatFit } from "../transcriptView.ts";
import { DISCORD_MESSAGE_LIMIT } from "../renderer.ts";
import { respond } from "../respond.ts";

const HEADER_ROOM = 120;

export async function handleSync(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const say = bridge.language.say;
  // A running turn's own lines are not drift; they are on their way to this channel already.
  if (bridge.flow.isRunning(conversation.sessionId)) {
    await respond(interaction, say("sync.running"));
    return;
  }

  const record = await bridge.sessions.find(conversation.sessionId);
  const drift = await pendingDrift(conversation, record);

  if (drift.length === 0) {
    await respond(interaction, say("sync.nothingNew"));
    return;
  }

  const recent = latestThatFit(say, drift, DISCORD_MESSAGE_LIMIT - HEADER_ROOM);
  const view = formatExchanges(say, recent);
  if (recent.length === drift.length) {
    await respond(interaction, `${say("sync.all", { count: drift.length })}\n\n${view}`);
  } else {
    const file = new AttachmentBuilder(Buffer.from(formatExchanges(say, drift, "plain"), "utf8"), {
      name: `catch-up-${drift.length}-messages.md`,
    });
    await respond(interaction, { content: `${say("sync.latest", { count: drift.length })}\n\n${view}`, files: [file] });
  }

  await markCaughtUp(bridge, conversation);
}
