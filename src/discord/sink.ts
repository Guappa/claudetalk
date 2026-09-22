import type { Message, MessageCreateOptions, SendableChannels } from "discord.js";
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { AskHandle, MessageSink, SinkAction, SinkFile } from "./messageSink.ts";
import { redactHome } from "../displayPath.ts";
import { sendNotice } from "./notice.ts";

// Only users from the supplied context may be pinged, so channel text cannot cause a mass-notify.
function mentionPolicy(allowedUserIds: string[]): MessageCreateOptions["allowedMentions"] {
  return { parse: [], users: allowedUserIds, roles: [], repliedUser: false };
}

export const NO_MENTIONS: MessageCreateOptions["allowedMentions"] = { parse: [], users: [], roles: [] };

export interface SinkOptions {
  allowedUserIds?: string[];
  replyToMessageId?: string;
}

// Discord allows five buttons to a row, and nothing here offers more than three.
function buttonRow(actions: SinkAction[]): ActionRowBuilder<ButtonBuilder>[] {
  if (actions.length === 0) return [];
  const buttons = actions.slice(0, 5).map((action) =>
    new ButtonBuilder()
      .setCustomId(action.id)
      .setLabel(action.label)
      .setStyle(action.tone === "danger" ? ButtonStyle.Danger : ButtonStyle.Secondary),
  );
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)];
}

export function channelSink(channel: SendableChannels, options: SinkOptions = {}): MessageSink {
  const allowedMentions = mentionPolicy(options.allowedUserIds ?? []);
  let owned: Message | null = null;

  // The first message of a turn threads to what prompted it; a ping would be redundant on top.
  const firstSendOptions = (content: string): MessageCreateOptions =>
    options.replyToMessageId
      ? {
          content,
          allowedMentions,
          reply: { messageReference: options.replyToMessageId, failIfNotExists: false },
        }
      : { content, allowedMentions };

  return {
    async send(text: string): Promise<void> {
      const shown = redactHome(text);
      const sent = await channel.send(owned ? { content: shown, allowedMentions } : firstSendOptions(shown));
      owned ??= sent;
    },
    async edit(text: string, actions: SinkAction[] = []): Promise<void> {
      const shown = redactHome(text);
      if (!owned) {
        owned = await channel.send(firstSendOptions(shown));
        return;
      }
      await owned.edit({ content: shown, allowedMentions, components: buttonRow(actions) });
    },
    async notice(text: string): Promise<void> {
      await sendNotice(channel, redactHome(text));
    },
    typing(): void {
      // A failed keepalive is cosmetic; it must never take a turn down.
      if ("sendTyping" in channel) void channel.sendTyping().catch(() => undefined);
    },
    // An ask owns its own message, so it never fights the status message for the one this sink edits.
    async ask(text: string, actions: SinkAction[]): Promise<AskHandle> {
      const shown = redactHome(text);
      const sent = await channel.send({ content: shown, allowedMentions, components: buttonRow(actions) });
      return {
        async close(outcome: string): Promise<void> {
          await sent.edit({ content: `${shown}\n\n**${outcome}**`, components: [] }).catch(() => undefined);
        },
      };
    },
    async sendFiles(text: string, files: SinkFile[]): Promise<void> {
      const attachments = files.map((file) => new AttachmentBuilder(file.data, { name: file.name }));
      await channel.send({ content: redactHome(text), allowedMentions, files: attachments });
    },
  };
}
