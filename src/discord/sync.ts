import type { Bridge } from "../bridge.ts";
import type { Conversation } from "../conversations.ts";
import type { SessionRecord } from "../sessions/index.ts";
import { readExchanges, type Exchange } from "../sessions/exchanges.ts";

export async function pendingDrift(
  conversation: Conversation,
  record: SessionRecord | null,
): Promise<Exchange[]> {
  if (!record) return [];
  const since = conversation.syncedThrough ? new Date(conversation.syncedThrough) : undefined;
  return await readExchanges(record.transcriptPath, since);
}

// The index is rebuilt rather than reused: a turn has just written to the transcript being read.
export async function markCaughtUp(bridge: Bridge, conversation: Conversation): Promise<void> {
  const record = await bridge.sessions.find(conversation.sessionId);
  if (!record) return;
  const exchanges = await readExchanges(record.transcriptPath);
  const last = exchanges.at(-1);
  await bridge.store.markSynced(conversation.sessionId, (last?.at ?? new Date()).toISOString());
}
