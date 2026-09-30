import type { ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { helloToBranch } from "../../claude/prompts.ts";
import type { Conversation } from "../../conversations.ts";
import { channelSink } from "../sink.ts";
import { runConversationTurn } from "../turn.ts";

export function forkName(originalName: string, requested?: string | null): string {
  return requested?.trim() || `${originalName}-fork`;
}

// A branch that never started and one that ran without yielding a session are different failures, with different things to do about them.
export type ForkOutcome = { kind: "bound" } | { kind: "not-started" } | { kind: "no-session" };

export async function runFork(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
  source: Conversation,
  channel: TextChannel,
  name: string,
): Promise<ForkOutcome> {
  let forkedId: string | undefined;

  const ran = await runConversationTurn(bridge, source, {
    actorId: interaction.user.id,
    prompt: helloToBranch(name),
    sink: channelSink(channel, { latestPosts: bridge.latestPosts }),
    fork: true,
    onSessionId: (id) => {
      forkedId = id;
    },
  });

  if (!ran) return { kind: "not-started" };
  if (!forkedId || forkedId === source.sessionId) return { kind: "no-session" };

  await bridge.store.bindNew({
    sessionId: forkedId,
    cwd: source.cwd,
    channelId: channel.id,
    ownerId: interaction.user.id,
    settings: { ...source.settings },
  });
  return { kind: "bound" };
}
