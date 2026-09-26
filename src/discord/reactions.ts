import type { Message, MessageReaction } from "discord.js";

export type TurnState = "queued" | "running" | "waiting" | "done" | "stopped" | "failed";

// Standard Unicode only, so every client draws the same thing and no server needs a custom emoji.
export const STATE_EMOJI: Record<TurnState, string> = {
  queued: "\u{1F552}",
  running: "\u{1F440}",
  waiting: "❓",
  done: "✅",
  stopped: "⏹️",
  failed: "❌",
};

export type StateMarker = (state: TurnState) => Promise<void>;

// One reaction at a time on the message that started the turn; a reaction that fails is cosmetic, never the turn's problem.
export function reactionMarker(message: Message, botId: string): StateMarker {
  let current: MessageReaction | null = null;
  return async (state) => {
    const next = STATE_EMOJI[state];
    if (current?.emoji.name === next) return;
    try {
      // The client keeps no reaction cache, so the one to remove is the one react() handed back.
      if (current) await current.users.remove(botId);
      current = await message.react(next);
    } catch {
      current = null;
    }
  };
}
