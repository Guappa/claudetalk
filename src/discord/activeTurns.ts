import type { Client } from "discord.js";
import { readJsonOr, writeJsonAtomic } from "../jsonFile.ts";
import type { SinkAnchor } from "./messageSink.ts";
import { errorMessage } from "../text.ts";

export const INTERRUPTED =
  "**Interrupted: the bridge stopped while this was running. Send a message to continue.**";

type Anchors = Record<string, SinkAnchor>;

// Written while a turn runs and cleared when it ends, so a bridge that died mid-turn knows what it left behind.
export class ActiveTurns {
  private readonly filePath: string;
  private anchors: Anchors = {};

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    this.anchors = await readJsonOr<Anchors>(this.filePath, () => ({}));
  }

  async record(sessionId: string, anchor: SinkAnchor): Promise<void> {
    this.anchors[sessionId] = anchor;
    await writeJsonAtomic(this.filePath, this.anchors);
  }

  async clear(sessionId: string): Promise<void> {
    if (!(sessionId in this.anchors)) return;
    delete this.anchors[sessionId];
    await writeJsonAtomic(this.filePath, this.anchors);
  }

  // What the previous process was running when it died; taking them is what stops a double report.
  async takeLeftovers(): Promise<SinkAnchor[]> {
    const leftovers = Object.values(this.anchors);
    this.anchors = {};
    if (leftovers.length > 0) await writeJsonAtomic(this.filePath, this.anchors);
    return leftovers;
  }
}

async function markOne(client: Client, anchor: SinkAnchor): Promise<void> {
  const channel = await client.channels.fetch(anchor.channelId);
  if (!channel?.isTextBased() || !("messages" in channel)) return;
  const message = await channel.messages.fetch(anchor.messageId);
  if (message.content.includes(INTERRUPTED)) return;
  await message.edit({ content: `${message.content}\n\n${INTERRUPTED}`, components: [] });
}

// A progress message the previous process never finished would otherwise read as working forever.
export async function markInterrupted(client: Client, anchors: SinkAnchor[]): Promise<void> {
  for (const anchor of anchors) {
    await markOne(client, anchor).catch((error: unknown) => {
      console.error(`could not mark an interrupted turn in channel ${anchor.channelId}: ${errorMessage(error)}`);
    });
  }
}
