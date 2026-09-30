import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { requireConversation } from "../binding.ts";
import { channelSink } from "../sink.ts";
import { runConversationTurn } from "../turn.ts";
import { buildContext, composePrompt, toContextMessage, type ContextMessage } from "../context.ts";
import { respond } from "../respond.ts";
import { classifyPrompt, describeNotRun } from "./settings.ts";

export async function handleAsk(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;
  if (!interaction.channel?.isSendable()) return;

  const prompt = interaction.options.getString("prompt", true);
  const wanted = interaction.options.getInteger("context") ?? 0;

  let messages: ContextMessage[] = [];
  if (wanted > 0) {
    const fetched = await interaction.channel.messages.fetch({ limit: wanted });
    messages = [...fetched.values()].reverse().map(toContextMessage);
  }

  const context = buildContext(messages);
  const say = bridge.language.say;
  // With no context in front of it the prompt is the first thing Claude Code reads, so a command in it is held to what a typed one is.
  if (!context.text) {
    const typed = classifyPrompt(
      prompt,
      bridge.capabilities.terminalOnly(conversation.sessionId),
      bridge.capabilities.commands(conversation.cwd),
    );
    if (typed.kind !== "turn" && typed.kind !== "passthrough") {
      await respond(interaction, describeNotRun(say, typed));
      return;
    }
  }
  await respond(interaction, wanted > 0 ? say("ask.withContext", { count: messages.length }) : say("ask.noContext"));

  await runConversationTurn(bridge, conversation, {
    actorId: interaction.user.id,
    prompt: composePrompt(context, prompt),
    sink: channelSink(interaction.channel, {
      allowedUserIds: [...new Set([interaction.user.id, ...context.mentionableUserIds])],
      latestPosts: bridge.latestPosts,
    }),
    resume: true,
    quoted: context.quoted,
  });
}
