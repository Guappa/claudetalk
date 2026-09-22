import { AttachmentBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { requireConversation } from "../binding.ts";
import { markCaughtUp, pendingDrift } from "../sync.ts";
import { formatExchanges } from "../transcriptView.ts";
import { chunkForDiscord, shouldSpillToFile } from "../renderer.ts";
import { respond } from "../respond.ts";

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
    await respond(interaction, "Nothing new. This channel already shows everything in the conversation.");
    return;
  }

  const chunks = chunkForDiscord(formatExchanges(drift));
  if (shouldSpillToFile(chunks)) {
    const file = new AttachmentBuilder(Buffer.from(formatExchanges(drift, "plain"), "utf8"), {
      name: `catch-up-${drift.length}-messages.md`,
    });
    await respond(interaction, { content: `${drift.length} messages from outside Discord:`, files: [file] });
  } else {
    await respond(interaction, chunks[0] ?? "_(nothing)_");
    if (interaction.channel?.isSendable()) {
      for (const chunk of chunks.slice(1)) await interaction.channel.send(chunk);
    }
  }

  await markCaughtUp(bridge, conversation);
}
