import type { GuildTextBasedChannel } from "discord.js";
import { count } from "../text.ts";

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
export function describePurge(result: PurgeResult, isConversationChannel: boolean): string {
  const total = result.bulkDeleted + result.slowDeleted;
  if (total === 0 && result.failed === 0) return "Nothing to delete; the channel is already empty.";

  const parts = [`Deleted ${count(total, "message")}`];
  if (result.slowDeleted > 0) {
    parts.push(`${result.slowDeleted} of them older than ${BULK_DELETE_MAX_AGE_DAYS} days, one at a time`);
  }
  if (result.failed > 0) parts.push(`${result.failed} could not be deleted`);

  const tail = isConversationChannel
    ? " The conversation itself is untouched; `/sync` repopulates the channel."
    : "";
  return `${parts.join(", ")}.${tail}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function purgeChannel(
  channel: GuildTextBasedChannel,
  keepMessageId?: string,
): Promise<PurgeResult> {
  const result: PurgeResult = { bulkDeleted: 0, slowDeleted: 0, failed: 0 };

  for (;;) {
    const page = await channel.messages.fetch({ limit: FETCH_PAGE });
    const targets = [...page.values()].filter((message) => message.id !== keepMessageId);
    if (targets.length === 0) break;

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

    if (result.failed >= targets.length) break;
  }

  return result;
}
