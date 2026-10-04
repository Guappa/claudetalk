import fs from "node:fs/promises";
import type { Client, MessageCreateOptions } from "discord.js";
import type { Bridge } from "../bridge.ts";
import type { Say } from "../i18n/index.ts";
import { orderedWriter, readJsonOr } from "../jsonFile.ts";
import { errorMessage } from "../text.ts";
import { forDiscord } from "./outgoing.ts";
import { NO_MENTIONS } from "./sink.ts";

// Who asked for a restart: the channel to say so in, and either the message to reply to or the person to name.
export interface Asker {
  channelId: string;
  replyTo?: string;
  userId?: string;
}

// Left on the way down and read on the way up, so the bridge that comes back can tell whoever asked that it has.
export class RestartNote {
  private readonly filePath: string;
  private readonly write: (value: unknown) => Promise<void>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.write = orderedWriter(filePath);
  }

  async add(asker: Asker): Promise<void> {
    await this.write([...(await this.read()), asker]);
  }

  // Taking them is what keeps a second start from saying it again.
  async take(): Promise<Asker[]> {
    const askers = await this.read();
    await this.clear();
    return askers;
  }

  // A restart that became a plain stop has nobody to come back to.
  async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }

  private read(): Promise<Asker[]> {
    return readJsonOr<Asker[]>(this.filePath, () => []);
  }
}

// A restart asked for from inside a turn is answered where that turn ran, as a reply to the message that started it.
export function askerFor(bridge: Bridge, sessionId: string): Asker | null {
  const conversation = bridge.store.bySession(sessionId);
  if (!conversation) return null;
  const promptId = bridge.activeTurns.anchorOf(sessionId)?.promptId;
  return promptId ? { channelId: conversation.channels.text, replyTo: promptId } : { channelId: conversation.channels.text };
}

// A reply with the ping on reaches whoever sent the message; with no message to reply to, the person is named.
export function announcement(asker: Asker, content: string): MessageCreateOptions {
  if (asker.replyTo) {
    return {
      content,
      allowedMentions: { ...NO_MENTIONS, repliedUser: true },
      reply: { messageReference: asker.replyTo, failIfNotExists: false },
    };
  }
  if (asker.userId) {
    return { content: `<@${asker.userId}> ${content}`, allowedMentions: { ...NO_MENTIONS, users: [asker.userId] } };
  }
  return { content, allowedMentions: NO_MENTIONS };
}

async function tell(client: Client, asker: Asker, text: string): Promise<void> {
  const channel = await client.channels.fetch(asker.channelId);
  if (!channel?.isSendable()) return;
  await channel.send(announcement(asker, forDiscord(text)));
}

export async function announceRestart(client: Client, askers: Asker[], build: string, say: Say): Promise<void> {
  const text = say("restart.back", { version: build });
  for (const asker of askers) {
    await tell(client, asker, text).catch((error: unknown) => {
      console.error(`could not say in channel ${asker.channelId} that the bridge is back: ${errorMessage(error)}`);
    });
  }
}
