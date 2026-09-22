import type { SendableChannels } from "discord.js";

const NOTICE_LIFETIME_MS = 60_000;

// Only an interaction reply can be ephemeral, so a notice in a channel gets a lifetime instead.
export async function sendNotice(
  channel: SendableChannels,
  text: string,
  lifetimeMs: number = NOTICE_LIFETIME_MS,
): Promise<void> {
  const sent = await channel.send(text);
  const timer = setTimeout(() => void sent.delete().catch(() => undefined), lifetimeMs);
  timer.unref();
}
