import type { ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import type { Conversation } from "../../conversations.ts";
import { channelSink } from "../sink.ts";
import { runConversationTurn } from "../turn.ts";

export function forkName(originalName: string, requested?: string | null): string {
  return requested?.trim() || `${originalName}-fork`;
}

export async function runFork(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
  source: Conversation,
  channel: TextChannel,
  name: string,
): Promise<Conversation | null> {
  let forkedId: string | undefined;

  await runConversationTurn(bridge, source, {
    actorId: interaction.user.id,
    prompt:
      `This conversation has been branched into a copy named "${name}". ` +
      `Say in one line what it was about, so the branch starts with its bearings.`,
    sink: channelSink(channel),
    resume: true,
    fork: true,
    onSessionId: (id) => {
      forkedId = id;
    },
  });

  if (!forkedId || forkedId === source.sessionId) return null;

  return await bridge.store.bindNew({
    sessionId: forkedId,
    cwd: source.cwd,
    channelId: channel.id,
    ownerId: interaction.user.id,
    settings: { ...source.settings },
  });
}
