import type { Client } from "discord.js";
import { orderedWriter, readJsonOr } from "../jsonFile.ts";
import type { Say } from "../i18n/index.ts";
import type { SinkAnchor } from "./messageSink.ts";
import { errorMessage } from "../text.ts";
import { replaceText } from "./outgoing.ts";

type Anchors = Record<string, SinkAnchor>;

// Written while a turn runs and cleared when it ends, so a bridge that died mid-turn knows what it left behind.
export class ActiveTurns {
  private readonly filePath: string;
  private anchors: Anchors = {};
  private readonly write: (value: unknown) => Promise<void>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.write = orderedWriter(filePath);
  }

  async load(): Promise<void> {
    this.anchors = await readJsonOr<Anchors>(this.filePath, () => ({}));
  }

  record(sessionId: string, anchor: SinkAnchor): Promise<void> {
    this.anchors[sessionId] = anchor;
    return this.save();
  }

  anchorOf(sessionId: string): SinkAnchor | undefined {
    return this.anchors[sessionId];
  }

  async clear(sessionId: string): Promise<void> {
    if (!(sessionId in this.anchors)) return;
    delete this.anchors[sessionId];
    await this.save();
  }

  // What the previous process was running when it died; taking them is what stops a double report.
  async takeLeftovers(): Promise<SinkAnchor[]> {
    const leftovers = Object.values(this.anchors);
    this.anchors = {};
    if (leftovers.length > 0) await this.save();
    return leftovers;
  }

  // A failed write costs a log line, not a turn.
  private async save(): Promise<void> {
    await this.write({ ...this.anchors }).catch((error: unknown) => {
      console.error(`could not write ${this.filePath}: ${errorMessage(error)}`);
    });
  }
}

async function markOne(client: Client, anchor: SinkAnchor, interrupted: string): Promise<void> {
  const channel = await client.channels.fetch(anchor.channelId);
  if (!channel?.isTextBased() || !("messages" in channel)) return;
  const message = await channel.messages.fetch(anchor.messageId);
  if (message.content.includes(interrupted)) return;
  await replaceText(message, `${message.content}\n\n${interrupted}`);
}

// A progress message the previous process never finished would otherwise read as working forever.
export async function markInterrupted(client: Client, anchors: SinkAnchor[], say: Say): Promise<void> {
  for (const anchor of anchors) {
    await markOne(client, anchor, say("trail.interrupted")).catch((error: unknown) => {
      console.error(`could not mark an interrupted turn in channel ${anchor.channelId}: ${errorMessage(error)}`);
    });
  }
}
