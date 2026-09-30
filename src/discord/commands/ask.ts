import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { requireConversation } from "../binding.ts";
import { channelSink } from "../sink.ts";
import { runConversationTurn } from "../turn.ts";
import { buildContext, composePrompt, toContextMessage, type ContextMessage } from "../context.ts";
import { respond } from "../respond.ts";
import { classifyTyped, describeNotRun, isNotRun } from "./typed.ts";

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
    const typed = classifyTyped(bridge, prompt, conversation);
    if (isNotRun(typed)) {
      await respond(interaction, describeNotRun(say, typed));
      return;
    }
  }
  await respond(interaction, context.carried > 0 ? say("ask.withContext", { count: context.carried }) : say("ask.noContext"));

  await runConversationTurn(bridge, conversation, {
    prompt: composePrompt(context, prompt),
    sink: channelSink(interaction.channel, {
      allowedUserIds: [...new Set([interaction.user.id, ...context.mentionableUserIds])],
      latestPosts: bridge.latestPosts,
    }),
  });
}
