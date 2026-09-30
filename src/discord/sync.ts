import type { Bridge } from "../bridge.ts";
import type { Conversation } from "../conversations.ts";
import type { SessionRecord } from "../sessions/index.ts";
import { readExchanges, readExchangesSince, type ExchangesRead } from "../sessions/exchanges.ts";

// What happened outside Discord since the conversation was last marked seen.
export async function newDrift(conversation: Conversation, record: SessionRecord | null): Promise<ExchangesRead> {
  if (!record) return { exchanges: [], reachesBack: true };
  const since = conversation.syncedThrough ? new Date(conversation.syncedThrough) : undefined;
  return await readExchangesSince(record.transcriptPath, since);
}

// Everything nobody has been shown: the new drift, and the stretches a turn announced and then ran past.
export async function pendingDrift(conversation: Conversation, record: SessionRecord | null): Promise<ExchangesRead> {
  const owed = conversation.unseen ?? [];
  if (!record || owed.length === 0) return await newDrift(conversation, record);

  const synced = conversation.syncedThrough ? new Date(conversation.syncedThrough) : null;
  const earliest = owed[0]!.after ? new Date(owed[0]!.after) : undefined;
  const read = await readExchangesSince(record.transcriptPath, earliest);
  const isOwed = (at: Date): boolean =>
    owed.some((stretch) => (stretch.after === null || at > new Date(stretch.after)) && at <= new Date(stretch.through));
  return {
    ...read,
    exchanges: read.exchanges.filter((exchange) => isOwed(exchange.at) || synced === null || exchange.at > synced),
  };
}

// The index is rebuilt rather than reused: a turn has just written to the transcript being read.
export async function markCaughtUp(bridge: Bridge, conversation: Conversation): Promise<void> {
  const record = await bridge.sessions.find(conversation.sessionId);
  if (!record) return;
  const exchanges = await readExchanges(record.transcriptPath);
  const last = exchanges.at(-1);
  await bridge.store.markSynced(conversation.sessionId, (last?.at ?? new Date()).toISOString());
}
