import type { Client } from "discord.js";
import type { Bridge } from "../bridge.ts";
import type { Conversation } from "../conversations.ts";
import { errorMessage } from "../text.ts";
import { SETTLE_MS } from "./outbox.ts";
import { channelSink } from "./sink.ts";

const SWEEP_MS = 20_000;

async function sweepOne(bridge: Bridge, client: Client, conversation: Conversation): Promise<void> {
  if (!(await bridge.outbox.hasFiles(conversation.cwd, conversation.sessionId))) return;

  const channel = await client.channels.fetch(conversation.channels.text).catch(() => null);
  // The files stay put when the channel is gone, so a rebind still finds them.
  if (!channel?.isSendable()) return;

  const sink = channelSink(channel, { latestPosts: bridge.latestPosts });
  await bridge.outbox.deliver(bridge.language.say, conversation.cwd, conversation.sessionId, sink, SETTLE_MS);
}

// Delivers whenever a file appears: mid-turn for a long one, and after it for work that outlives it. One conversation whose delivery fails is said once and does not keep the rest from theirs.
export async function sweepOutboxes(bridge: Bridge, client: Client, failing: Set<string>): Promise<void> {
  for (const conversation of bridge.store.all()) {
    try {
      await sweepOne(bridge, client, conversation);
      failing.delete(conversation.sessionId);
    } catch (error) {
      if (failing.has(conversation.sessionId)) continue;
      failing.add(conversation.sessionId);
      console.error(
        `Files left by ${conversation.sessionId} could not be delivered and stay in its outbox: ${errorMessage(error)}`,
      );
    }
  }
}

export function watchOutboxes(bridge: Bridge, client: Client): NodeJS.Timeout {
  const failing = new Set<string>();
  const timer = setInterval(() => {
    void sweepOutboxes(bridge, client, failing);
  }, SWEEP_MS);
  timer.unref();
  return timer;
}
