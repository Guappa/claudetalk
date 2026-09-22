import type { Client } from "discord.js";
import type { Bridge } from "../bridge.ts";
import { SETTLE_MS } from "./outbox.ts";
import { channelSink } from "./sink.ts";

const SWEEP_MS = 20_000;

// Delivers whenever a file appears: mid-turn for a long one, and after it for work that outlives it.
async function sweepOutboxes(bridge: Bridge, client: Client): Promise<number> {
  let delivered = 0;

  for (const conversation of bridge.store.all()) {
    if (!(await bridge.outbox.hasFiles(conversation.cwd, conversation.sessionId))) continue;

    const channel = await client.channels.fetch(conversation.channels.text).catch(() => null);
    // The files stay put when the channel is gone, so a rebind still finds them.
    if (!channel?.isSendable()) continue;

    delivered += await bridge.outbox.deliver(conversation.cwd, conversation.sessionId, channelSink(channel), SETTLE_MS);
  }

  return delivered;
}

export function watchOutboxes(bridge: Bridge, client: Client): NodeJS.Timeout {
  const timer = setInterval(() => {
    void sweepOutboxes(bridge, client).catch(() => undefined);
  }, SWEEP_MS);
  timer.unref();
  return timer;
}
