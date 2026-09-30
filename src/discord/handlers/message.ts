import { randomUUID } from "node:crypto";
import type { Message, SendableChannels } from "discord.js";
import { replyText } from "../outgoing.ts";
import type { Bridge } from "../../bridge.ts";
import type { Conversation } from "../../conversations.ts";
import { resolveByChannelName } from "../../sessions/resolve.ts";
import { displayName } from "../../sessions/displayName.ts";
import {
  appendAttachmentPaths,
  describeRefused,
  describeUnfetched,
  downloadAttachments,
  screenAttachments,
  sweepAttachments,
} from "../../attachments.ts";
import { classifyPrompt, describeNotRun } from "../commands/settings.ts";
import { channelSink } from "../sink.ts";
import { sendNotice } from "../notice.ts";
import { runConversationTurn } from "../turn.ts";
import { reactionMarker } from "../reactions.ts";
import { isFromGuild, isMessageInScope } from "../gate.ts";
import { toChannelName } from "../channelName.ts";
import {
  addressesBot,
  addressesSomeoneElse,
  shouldQuoteReplied,
  type Addressing,
} from "../addressing.ts";
import { adHocWorkingDir, tierOf } from "../policy.ts";
import {
  attributionOnly,
  buildContext,
  composePrompt,
  noContext,
  stripBotMention,
  toContextMessage,
  type BuiltContext,
} from "../context.ts";

interface Target {
  conversation: Conversation;
  isFirstTurn: boolean;
}

async function repliedTo(message: Message): Promise<Message | null> {
  if (!message.reference?.messageId) return null;
  try {
    return await message.fetchReference();
  } catch {
    return null;
  }
}

// Context is tiered by cost, because anything included here is re-sent on every later turn.
function contextFor(message: Message, replied: Message | null, addressing: Addressing): BuiltContext {
  if (replied && shouldQuoteReplied(addressing)) {
    return buildContext([toContextMessage(replied), toContextMessage(message)]);
  }
  if (addressesBot(addressing)) return attributionOnly(toContextMessage(message));
  return noContext();
}

function channelNameOf(message: Message): string {
  return ("name" in message.channel ? message.channel.name : null) ?? message.channelId;
}

async function reply(message: Message, content: string): Promise<void> {
  await replyText(message, content);
}

// Binding a second channel to a conversation would overwrite the first one's members and settings.
async function bindExisting(
  bridge: Bridge,
  message: Message,
  channel: SendableChannels,
): Promise<Conversation | "already-open" | null> {
  const resolution = resolveByChannelName(await bridge.sessions.build(), channelNameOf(message));
  if (!resolution.match?.cwd) return null;

  const say = bridge.language.say;
  const open = bridge.store.bySession(resolution.match.sessionId);
  if (open) {
    const alreadyOpen = { name: displayName(resolution.match), channelId: open.channels.text };
    await sendNotice(channel, say("binding.alreadyOpen", alreadyOpen));
    return "already-open";
  }

  await sendNotice(channel, say("binding.bound", { channel: channelNameOf(message) }));
  return await bridge.store.bindNew({
    sessionId: resolution.match.sessionId,
    cwd: resolution.match.cwd,
    channelId: message.channelId,
    ownerId: message.author.id,
  });
}

// Mention-only so follow-up tags keep context while ordinary chatter stays ignored.
async function startMentionOnly(bridge: Bridge, message: Message, channel: SendableChannels): Promise<Conversation | null> {
  const cwd = adHocWorkingDir(bridge, tierOf(bridge, message.author.id), message.author.id);
  if (!cwd) {
    await sendNotice(channel, bridge.language.say("binding.noWorkspace"));
    return null;
  }

  return await bridge.store.bindNew({
    sessionId: randomUUID(),
    cwd,
    channelId: message.channelId,
    ownerId: message.author.id,
    mentionOnly: true,
  });
}

// Which conversation a message belongs to: the channel's own, one named like the channel, or a new ad-hoc one.
async function targetFor(
  bridge: Bridge,
  message: Message,
  channel: SendableChannels,
  addressing: Addressing,
): Promise<Target | null> {
  const existing = bridge.store.byChannel(message.channelId);
  const addressed = addressesBot(addressing);

  if (existing) {
    if (existing.mentionOnly && !addressed) return null;
    if (addressesSomeoneElse(addressing)) return null;
    return { conversation: existing, isFirstTurn: false };
  }

  if (!addressed) return null;

  const parentId = "parentId" in channel ? channel.parentId : null;
  if (isMessageInScope(bridge.config, parentId, false)) {
    const bound = await bindExisting(bridge, message, channel);
    if (bound === "already-open") return null;
    if (bound) return { conversation: bound, isFirstTurn: false };
  }

  const started = await startMentionOnly(bridge, message, channel);
  return started ? { conversation: started, isFirstTurn: true } : null;
}

// A message that was only a refused or unfetchable file has nothing for a turn to answer.
export function nothingToSend(prompt: string, attachmentCount: number): boolean {
  return !prompt.trim() && attachmentCount === 0;
}

async function runTurn(
  bridge: Bridge,
  message: Message,
  channel: SendableChannels,
  target: Target,
  prompt: string,
  context: BuiltContext,
  plain: boolean,
): Promise<void> {
  void sweepAttachments();

  const { allowed, refused } = screenAttachments(
    message.attachments.map((attachment) => ({
      url: attachment.url,
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
    })),
  );
  // A reply, not a notice: it stays under the upload it is about, and a plain message has no ephemeral.
  const refusal = describeRefused(bridge.language.say, refused);
  if (refusal) await reply(message, refusal);
  if (nothingToSend(prompt, allowed.length)) return;

  const { saved, failed } = await downloadAttachments(allowed, randomUUID());
  const unfetched = describeUnfetched(bridge.language.say, failed);
  if (unfetched) await reply(message, unfetched);
  if (nothingToSend(prompt, saved.length)) return;

  await runConversationTurn(bridge, target.conversation, {
    actorId: message.author.id,
    prompt: appendAttachmentPaths(composePrompt(context, prompt), saved),
    sink: channelSink(channel, {
      allowedUserIds: context.mentionableUserIds,
      replyToMessageId: message.id,
      latestPosts: bridge.latestPosts,
    }),
    resume: !target.isFirstTurn,
    quoted: context.quoted,
    name: target.isFirstTurn ? toChannelName(channelNameOf(message)) : undefined,
    onState: reactionMarker(message, message.client.user.id),
    asked: prompt,
    // A command is its own turn; only a plain message joins the one already running.
    foldable: plain && !target.isFirstTurn,
  });
}

export async function handleMessage(bridge: Bridge, message: Message): Promise<void> {
  if (!isFromGuild(bridge.config, message.guildId, message.author.bot)) return;
  if (!message.channel.isSendable()) return;
  // A thread the bridge opened holds a turn's detail; it is not a place to start a conversation.
  if (message.channel.isThread() && message.channel.ownerId === message.client.user.id) return;
  const channel = message.channel;

  // Before anything is fetched: a stranger's reply must cost nothing, not even one API call.
  const tier = tierOf(bridge, message.author.id);
  if (tier === "none") return;

  const botUserId = message.client.user.id;
  const prompt = stripBotMention(message.content, botUserId);
  if (nothingToSend(prompt, message.attachments.size)) return;

  const existing = bridge.store.byChannel(message.channelId);
  const classification = classifyPrompt(prompt, bridge.capabilities.terminalOnly(existing?.sessionId ?? ""));
  if (classification.kind !== "turn" && classification.kind !== "passthrough") {
    await sendNotice(channel, describeNotRun(bridge.language.say, classification));
    return;
  }

  const replied = await repliedTo(message);
  const addressing: Addressing = {
    mentionsBot: message.mentions.users.has(botUserId),
    repliedAuthorId: replied?.author.id ?? null,
    botUserId,
    authorId: message.author.id,
  };

  const target = await targetFor(bridge, message, channel, addressing);
  if (!target) return;
  await runTurn(bridge, message, channel, target, prompt, contextFor(message, replied, addressing), classification.kind === "turn");
}
