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
  keepAttachmentsAwhile,
  screenAttachments,
  sweepAttachments,
  type RemoteAttachment,
  type SavedAttachment,
} from "../../attachments.ts";
import { classifyTyped, describeNotRun, isNotRun } from "../commands/typed.ts";
import { channelSink } from "../sink.ts";
import { sendNotice } from "../notice.ts";
import { tellOwnerOfUpdate } from "../updateNotice.ts";
import { runConversationTurn } from "../turn.ts";
import { reactionMarker } from "../reactions.ts";
import { isFromGuild } from "../gate.ts";
import { toChannelName } from "../../channelName.ts";
import { addressesBot, isForBot, shouldQuoteReplied, type Addressing } from "../addressing.ts";
import { adHocWorkingDir, makeWorkingDir, tierOf } from "../policy.ts";
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
  const records = await bridge.sessions.build();
  // Looked at again once the index is read: another message for the bot can have bound this channel while it was.
  const meanwhile = bridge.store.byChannel(message.channelId);
  if (meanwhile) return meanwhile;
  const match = resolveByChannelName(records, channelNameOf(message)).match;
  if (!match?.cwd) return null;

  const say = bridge.language.say;
  const open = bridge.store.bySession(match.sessionId);
  // A conversation the bridge started from a tag belongs to the channel it was tagged in, and is not found from another while it is open there.
  const startedByTag = bridge.store.startedByTag(match.sessionId);
  if (startedByTag && open) return null;
  if (open) {
    await sendNotice(channel, say("binding.alreadyOpen", { name: displayName(match), channelId: open.channels.text }));
    return "already-open";
  }

  // Bound before anything is awaited, so a /resume of the same conversation that lands meanwhile finds it open.
  const bound = await bridge.store.bindNew({
    sessionId: match.sessionId,
    cwd: match.cwd,
    channelId: message.channelId,
    ownerId: message.author.id,
    // Found again, it goes on answering tags only: the channel is a shared one, and its chatter is not for the session.
    mentionOnly: startedByTag || undefined,
    adopted: true,
  });
  await sendNotice(channel, say("binding.bound", { channel: channelNameOf(message) }));
  return bound;
}

// Mention-only so follow-up tags keep context while ordinary chatter stays ignored.
async function startMentionOnly(bridge: Bridge, message: Message, channel: SendableChannels): Promise<Target | null> {
  const say = bridge.language.say;
  const cwd = adHocWorkingDir(bridge, tierOf(bridge, message.author.id), message.author.id);
  if (!cwd) {
    await sendNotice(channel, say("binding.noWorkspace"));
    return null;
  }
  const failure = await makeWorkingDir(say, cwd);
  if (failure !== undefined) {
    await sendNotice(channel, failure);
    return null;
  }
  // Nothing is awaited between this look and the binding, so two tags that overlap end up in one conversation.
  const meanwhile = bridge.store.byChannel(message.channelId);
  if (meanwhile) return { conversation: meanwhile, isFirstTurn: false };

  const conversation = await bridge.store.bindNew({
    sessionId: randomUUID(),
    cwd,
    channelId: message.channelId,
    ownerId: message.author.id,
    mentionOnly: true,
    adopted: true,
    fresh: true,
  });
  return { conversation, isFirstTurn: true };
}

// Which conversation a message for the bot belongs to: the channel's own, one named like the channel, or a new ad-hoc one.
async function targetFor(
  bridge: Bridge,
  message: Message,
  channel: SendableChannels,
  existing: Conversation | undefined,
): Promise<Target | null> {
  if (existing) return { conversation: existing, isFirstTurn: false };

  const bound = await bindExisting(bridge, message, channel);
  if (bound === "already-open") return null;
  if (bound) return { conversation: bound, isFirstTurn: false };

  return await startMentionOnly(bridge, message, channel);
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
  allowed: RemoteAttachment[],
): Promise<boolean> {
  void sweepAttachments(Date.now(), bridge.heldAttachments);

  const turnId = randomUUID();
  const { saved, failed } = await downloadAttachments(allowed, turnId);
  const unfetched = describeUnfetched(bridge.language.say, failed);
  if (unfetched) await reply(message, unfetched);
  if (nothingToSend(prompt, saved.length)) return false;
  if (saved.length === 0) return await askOf(bridge, message, channel, target, prompt, context, plain, saved);

  bridge.heldAttachments.add(turnId);
  try {
    return await askOf(bridge, message, channel, target, prompt, context, plain, saved);
  } finally {
    bridge.heldAttachments.delete(turnId);
    await keepAttachmentsAwhile(turnId);
  }
}

async function askOf(
  bridge: Bridge,
  message: Message,
  channel: SendableChannels,
  target: Target,
  prompt: string,
  context: BuiltContext,
  plain: boolean,
  saved: SavedAttachment[],
): Promise<boolean> {
  return await runConversationTurn(bridge, target.conversation, {
    prompt: appendAttachmentPaths(composePrompt(context, prompt), saved),
    sink: channelSink(channel, {
      allowedUserIds: context.mentionableUserIds,
      replyToMessageId: message.id,
      latestPosts: bridge.latestPosts,
    }),
    name: toChannelName(channelNameOf(message)),
    onState: reactionMarker(message, message.client.user.id),
    asked: prompt,
    // A command is its own turn; only a plain message joins the one already running.
    foldable: plain,
    // Run again from the top once the holder is gone: by then the channel, the attachments and who may speak are judged as they stand.
    onHeld: () => bridge.heldMessages.remember(message.channelId, () => handleMessage(bridge, message)),
  });
}

export async function handleMessage(bridge: Bridge, message: Message): Promise<void> {
  if (!isFromGuild(bridge.config, message.guildId, message.author.bot)) return;
  // A pin, a thread being made, a member joining: Discord writes these in a person's name, and none of them is something that person asked.
  if (message.system) return;
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

  const replied = await repliedTo(message);
  const addressing: Addressing = {
    mentionsBot: message.mentions.users.has(botUserId),
    repliedAuthorId: replied?.author.id ?? null,
    botUserId,
    authorId: message.author.id,
  };
  const existing = bridge.store.byChannel(message.channelId);
  // Decided before anything is said: a command typed to somebody else, or in a channel the bot is not part of, gets no answer from it.
  if (!isForBot(existing, addressing)) return;

  const classification = classifyTyped(bridge, prompt, existing);
  if (isNotRun(classification)) {
    await sendNotice(channel, describeNotRun(bridge.language.say, classification));
    return;
  }

  // Screened before the channel is bound: a message that was only a refused file spends no turn and leaves no binding behind.
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

  const target = await targetFor(bridge, message, channel, existing);
  if (!target) return;
  // Only an owner can update the bridge, so only an owner is told there is something to update to.
  if (tier === "owner") await tellOwnerOfUpdate(bridge, channel);
  // The channel reads in order, as the terminal does: a trail above this message moves below it, and the answer lands beneath it, never in a message above.
  bridge.latestPosts.set(message.channelId, message.id);
  const plain = classification.kind === "turn";
  // A command is only a command as the first thing the session reads, so nothing is put in front of one.
  const context = plain ? contextFor(message, replied, addressing) : noContext();
  const ran = await runTurn(bridge, message, channel, target, prompt, context, plain, allowed);
  if (!ran && target.isFirstTurn) await dropUnstarted(bridge, message.channelId, target.conversation);
}

// A binding made for a message that started no turn names a session Claude Code never saw, and every later message there would fail to resume it.
async function dropUnstarted(bridge: Bridge, channelId: string, conversation: Conversation): Promise<void> {
  if (bridge.store.byChannel(channelId) !== conversation || bridge.flow.isRunning(conversation.sessionId)) return;
  await bridge.store.unbind(channelId);
}
