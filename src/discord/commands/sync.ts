import { AttachmentBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { requireConversation } from "../binding.ts";
import { markCaughtUp, pendingDrift } from "../sync.ts";
import { formatExchanges, latestThatFit } from "../transcriptView.ts";
import { DISCORD_MESSAGE_LIMIT } from "../renderer.ts";
import { respond } from "../respond.ts";
import { count } from "../../text.ts";

const HEADER_ROOM = 120;

export async function handleSync(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  // A running turn's own lines are not drift; they are on their way to this channel already.
  if (bridge.flow.isRunning(conversation.sessionId)) {
    await respond(
      interaction,
      "A turn is running here right now, and what it says is on its way to this channel. Run `/sync` again once it has finished.",
    );
    return;
  }

  const record = await bridge.sessions.find(conversation.sessionId);
  const drift = await pendingDrift(conversation, record);

  if (drift.length === 0) {
    await respond(interaction, "Nothing new: nothing has happened in this conversation outside Discord since you were last here.");
    return;
  }

  const recent = latestThatFit(drift, DISCORD_MESSAGE_LIMIT - HEADER_ROOM);
  const view = formatExchanges(recent);
  const total = count(drift.length, "message");
  if (recent.length === drift.length) {
    await respond(interaction, `${total} from outside Discord:\n\n${view}`);
  } else {
    const file = new AttachmentBuilder(Buffer.from(formatExchanges(drift, "plain"), "utf8"), {
      name: `catch-up-${drift.length}-messages.md`,
    });
    await respond(interaction, {
      content: `${total} from outside Discord. Where you left off, with all of them in the file:\n\n${view}`,
      files: [file],
    });
  }

  await markCaughtUp(bridge, conversation);
}
