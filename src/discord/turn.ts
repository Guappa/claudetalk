import type { Bridge } from "../bridge.ts";
import type { Conversation } from "../conversations.ts";
import type { MessageSink } from "./messageSink.ts";
import { markCaughtUp, pendingDrift } from "./sync.ts";
import { describeDrift } from "./transcriptView.ts";

export interface ConversationTurn {
  actorId: string;
  prompt: string;
  sink: MessageSink;
  resume: boolean;
  quoted?: boolean;
  name?: string;
  fork?: boolean;
  onSessionId?: (sessionId: string) => void;
}

// The only door into spending a turn, so none can skip the preflight or the catch-up that follows.
export async function runConversationTurn(
  bridge: Bridge,
  conversation: Conversation,
  turn: ConversationTurn,
): Promise<boolean> {
  const record = await bridge.sessions.find(conversation.sessionId);

  const check = bridge.flow.available(conversation.sessionId, record);
  if (check.kind !== "ok") {
    await turn.sink.notice(check.message);
    return false;
  }

  if (record) await bridge.flow.ensureCeiling(conversation.sessionId, record.transcriptPath);

  return await bridge.flow.run(
    conversation.sessionId,
    conversation.cwd,
    turn.prompt,
    conversation.settings,
    turn.sink,
    {
      resume: turn.resume,
      name: turn.name,
      fork: turn.fork,
      onSessionId: turn.onSessionId,
      // Judged once the turn ahead has ended and been marked seen, or its own lines would count as drift.
      beforeTurn: async () => {
        const drift = await pendingDrift(conversation, await bridge.sessions.find(conversation.sessionId));
        if (drift.length > 0) await turn.sink.notice(describeDrift(drift));
      },
      afterTurn: () => markCaughtUp(bridge, conversation),
    },
  );
}
