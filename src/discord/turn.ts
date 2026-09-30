import type { Bridge } from "../bridge.ts";
import type { Conversation } from "../conversations.ts";
import type { MessageSink } from "./messageSink.ts";
import type { StateMarker } from "./reactions.ts";
import { markCaughtUp, pendingDrift } from "./sync.ts";
import { describeDrift } from "./transcriptView.ts";

export interface ConversationTurn {
  actorId: string;
  prompt: string;
  sink: MessageSink;
  // The title the session takes if this turn turns out to be the one that starts it.
  name?: string;
  fork?: boolean;
  onSessionId?: (sessionId: string) => void;
  onState?: StateMarker;
  asked?: string;
  foldable?: boolean;
}

// The only door into spending a turn, so none can skip the preflight or the catch-up that follows.
export async function runConversationTurn(bridge: Bridge, conversation: Conversation, turn: ConversationTurn): Promise<boolean> {
  const record = await bridge.sessions.find(conversation.sessionId);

  const check = bridge.flow.available(conversation.sessionId, record);
  if (check.kind !== "ok") {
    await turn.sink.notice(check.message);
    return false;
  }

  if (record) await bridge.flow.ensureCeiling(conversation.sessionId, record.transcriptPath);

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
    // Judged once the turn ahead has ended and been marked seen, or its own lines would count as drift.
    beforeTurn: async () => {
      // A message can read the channel's conversation and then wait on a download or a lookup while the channel is started over or unbound under it.
      if (bridge.store.bySession(conversation.sessionId) !== conversation) return bridge.language.say("turn.conversationGone");
      const current = await bridge.sessions.find(conversation.sessionId);
      session.exists = current !== null || !conversation.unstarted;
      if (current) await bridge.store.markStarted(conversation.sessionId);
      const drift = await pendingDrift(conversation, current);
      if (drift.exchanges.length > 0) await turn.sink.notice(describeDrift(bridge.language.say, drift));
      return undefined;
    },
    afterTurn: () => markCaughtUp(bridge, conversation),
  });
}
