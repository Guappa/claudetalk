import type { GuildTextBasedChannel } from "discord.js";
import type { Say } from "../i18n/index.ts";

const FETCH_PAGE = 100;
// Discord refuses to bulk delete anything older than this, so those go one at a time.
const BULK_DELETE_MAX_AGE_DAYS = 14;
const BULK_DELETE_MAX_AGE_MS = BULK_DELETE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const SLOW_DELETE_PAUSE_MS = 350;

export interface PurgeResult {
  bulkDeleted: number;
  slowDeleted: number;
  failed: number;
}

export function isBulkDeletable(createdAt: Date, now = Date.now()): boolean {
  return now - createdAt.getTime() < BULK_DELETE_MAX_AGE_MS;
}

// /sync only means something where the channel is a view of a conversation.
export function describePurge(say: Say, result: PurgeResult, isConversationChannel: boolean): string {
  const total = result.bulkDeleted + result.slowDeleted;
  if (total === 0 && result.failed === 0) return say("purge.empty");

  const sentences: string[] = [say("purge.deleted", { count: total })];
  if (result.slowDeleted > 0) {
    sentences.push(say("purge.slow", { count: result.slowDeleted, days: BULK_DELETE_MAX_AGE_DAYS }));
  }
  if (result.failed > 0) sentences.push(say("purge.failed", { count: result.failed }));
  if (isConversationChannel) sentences.push(say("purge.conversationKept"));
  return sentences.join(" ");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function purgeChannel(channel: GuildTextBasedChannel, keepMessageId?: string): Promise<PurgeResult> {
  const result: PurgeResult = { bulkDeleted: 0, slowDeleted: 0, failed: 0 };
  let before: string | undefined;

  // Discord answers newest first, and each page starts below the last: a message that cannot be deleted is met once, and never holds the purge at the top of the channel.
  for (;;) {
    const page = await channel.messages.fetch(before ? { limit: FETCH_PAGE, before } : { limit: FETCH_PAGE });
    const fetched = [...page.values()];
    if (fetched.length === 0) break;
    before = fetched.at(-1)!.id;
    const targets = fetched.filter((message) => message.id !== keepMessageId);

    const recent = targets.filter((message) => isBulkDeletable(message.createdAt));
    const old = targets.filter((message) => !isBulkDeletable(message.createdAt));

    if (recent.length > 0) {
      try {
        const deleted = await channel.bulkDelete(recent, true);
        result.bulkDeleted += deleted.size;
        result.failed += recent.length - deleted.size;
      } catch {
        // Losing the whole purge to one message that vanished mid-flight is worse than retrying each.
        for (const message of recent) {
          try {
            await message.delete();
            result.bulkDeleted += 1;
          } catch {
            result.failed += 1;
          }
        }
      }
    }

    for (const message of old) {
      try {
        await message.delete();
        result.slowDeleted += 1;
      } catch {
        result.failed += 1;
      }
      await wait(SLOW_DELETE_PAUSE_MS);
    }
  }

  return result;
}
