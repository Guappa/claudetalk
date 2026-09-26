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
  private writes: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    this.anchors = await readJsonOr<Anchors>(this.filePath, () => ({}));
  }

  record(sessionId: string, anchor: SinkAnchor): Promise<void> {
    this.anchors[sessionId] = anchor;
    return this.save();
  }

  clear(sessionId: string): Promise<void> {
    if (!(sessionId in this.anchors)) return this.writes;
    delete this.anchors[sessionId];
    return this.save();
  }

  // What the previous process was running when it died; taking them is what stops a double report.
  async takeLeftovers(): Promise<SinkAnchor[]> {
    const leftovers = Object.values(this.anchors);
    this.anchors = {};
    if (leftovers.length > 0) await this.save();
    return leftovers;
  }

  // Every session shares the one file, so writes go out one at a time, and a failed one costs a log line, not a turn.
  private save(): Promise<void> {
    const snapshot = { ...this.anchors };
    this.writes = this.writes
      .then(() => writeJsonAtomic(this.filePath, snapshot))
      .catch((error: unknown) => console.error(`could not write ${this.filePath}: ${errorMessage(error)}`));
    return this.writes;
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
