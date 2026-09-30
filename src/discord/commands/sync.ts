import { AttachmentBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { requireConversation } from "../binding.ts";
import { pendingDrift } from "../sync.ts";
import { describeUnread, formatExchanges, latestThatFit } from "../transcriptView.ts";
import { DISCORD_MESSAGE_LIMIT } from "../renderer.ts";
import { respond } from "../respond.ts";
import { nameForDiscord } from "../outgoing.ts";

// The blank line between the header and the exchanges, and what the gate may add to either.
const HEADER_SLACK = 20;

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
  const read = await pendingDrift(conversation, record);
  const drift = read.exchanges;
  const counted = (key: "sync.all" | "sync.latest"): string =>
    [say(key, { count: drift.length }), describeUnread(say, read)].filter(Boolean).join(" ");

  if (drift.length === 0) {
    await respond(interaction, say("sync.nothingNew"));
    return;
  }

  // Measured, not assumed: the header's length depends on the language and on whether it has to say the count is partial.
  const header = Math.max(counted("sync.all").length, counted("sync.latest").length);
  const recent = latestThatFit(say, drift, DISCORD_MESSAGE_LIMIT - header - HEADER_SLACK);
  const view = formatExchanges(say, recent);
  if (recent.length === drift.length) {
    await respond(interaction, `${counted("sync.all")}\n\n${view}`);
  } else {
    // The file is as public as the message it hangs on, and nothing else passes it through the gate.
    const file = new AttachmentBuilder(Buffer.from(nameForDiscord(formatExchanges(say, drift, "plain")), "utf8"), {
      name: `catch-up-${drift.length}-messages.md`,
    });
    await respond(interaction, { content: `${counted("sync.latest")}\n\n${view}`, files: [file] });
  }

  // Marked through what was shown, not through the transcript's end as it is by now: a terminal may have written to it since it was read.
  await bridge.store.markShown(conversation.sessionId, drift.at(-1)!.at.toISOString());
}
