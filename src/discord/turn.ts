import type { Bridge } from "../bridge.ts";
import type { Conversation } from "../conversations.ts";
import type { MessageSink } from "./messageSink.ts";
import type { SessionRecord } from "../sessions/index.ts";
import type { TurnOptions } from "./turnFlow.ts";
import { markCaughtUp, newDrift } from "./sync.ts";
import { describeDrift } from "./transcriptView.ts";

// What a turn is given, and what of it goes to the flow as it is.
export interface ConversationTurn
  extends Pick<TurnOptions, "name" | "fork" | "onSessionId" | "onState" | "asked" | "foldable" | "images"> {
  prompt: string;
  sink: MessageSink;
  // Called when the turn is refused over something `/takeover` can free, so whoever sent it need not send it again.
  onHeld?: () => void;
}

// The only door into spending a turn, so none can skip the preflight or the catch-up that follows.
export async function runConversationTurn(bridge: Bridge, conversation: Conversation, turn: ConversationTurn): Promise<boolean> {
  const record = await bridge.sessions.find(conversation.sessionId);

  const check = bridge.flow.available(conversation.sessionId, record);
  if (check.kind !== "ok") {
    if (check.kind !== "refused") turn.onHeld?.();
    await turn.sink.notice(check.message);
    return false;
  }

  // Settled when the turn's place in the lane comes up: a turn ahead of this one may be what creates the session.
  const session = { exists: true };
  return await bridge.flow.run(conversation.sessionId, conversation.cwd, turn.prompt, conversation.settings, turn.sink, {
    resume: () => session.exists,
    name: turn.name,
    fork: turn.fork,
    onSessionId: turn.onSessionId,
    onState: turn.onState,
    asked: turn.asked,
    foldable: turn.foldable,
    images: turn.images,
    // Judged once the turn ahead has ended and been marked seen, or its own lines would count as drift.
    beforeTurn: async () => {
      // A message can read the channel's conversation and then wait on a download or a lookup while the channel is started over or unbound under it.
      if (bridge.store.bySession(conversation.sessionId) !== conversation) return bridge.language.say("turn.conversationGone");
      const current = await bridge.sessions.find(conversation.sessionId);
      session.exists = current !== null || !conversation.unstarted;
      if (current) await bridge.store.markStarted(conversation.sessionId);
      // A branch's first turn is asked of this conversation and written to another: what this one missed is its own channel's to hear of.
      if (!turn.fork) await announceDrift(bridge, conversation, current, turn.sink);
      return undefined;
    },
    afterTurn: async () => {
      if (!turn.fork) await markCaughtUp(bridge, conversation);
    },
  });
}

// The turn marks the conversation seen when it ends, which would take this drift with it, so it is kept as owed until /sync has shown it.
async function announceDrift(
  bridge: Bridge,
  conversation: Conversation,
  record: SessionRecord | null,
  sink: MessageSink,
): Promise<void> {
  const drift = await newDrift(conversation, record);
  const last = drift.exchanges.at(-1);
  if (!last) return;
  await bridge.store.noteUnseen(conversation.sessionId, {
    after: conversation.syncedThrough ?? null,
    through: last.at.toISOString(),
  });
  // A courtesy that could not be posted is no reason to refuse the turn it came with.
  await sink.notice(describeDrift(bridge.language.say, drift)).catch((error: unknown) => {
    console.error(`the drift notice for ${conversation.sessionId} could not be posted`, error);
  });
}
