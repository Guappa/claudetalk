import type { SendableChannels } from "discord.js";
import { postText } from "./outgoing.ts";

const NOTICE_LIFETIME_MS = 60_000;

// Only an interaction reply can be ephemeral, so a notice in a channel gets a lifetime instead.
export async function sendNotice(
  channel: SendableChannels,
  text: string,
  lifetimeMs: number = NOTICE_LIFETIME_MS,
): Promise<void> {
  const sent = await postText(channel, text);
  const timer = setTimeout(() => void sent.delete().catch(() => undefined), lifetimeMs);
  timer.unref();
}
