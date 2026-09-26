import type { Message, MessageCreateOptions, SendableChannels } from "discord.js";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import type { AskHandle, MessageSink, SinkAction, SinkAnchor, SinkFile, SinkMenu } from "./messageSink.ts";
import { redactHome } from "../displayPath.ts";
import { truncate } from "../text.ts";
import { sendNotice } from "./notice.ts";

// Discord's limits for a select menu: 100 characters for a label, value or description, 150 for the placeholder.
const MENU_TEXT_LIMIT = 100;
const PLACEHOLDER_LIMIT = 150;

// Only users from the supplied context may be pinged, so channel text cannot cause a mass-notify.
function mentionPolicy(allowedUserIds: string[]): MessageCreateOptions["allowedMentions"] {
  return { parse: [], users: allowedUserIds, roles: [], repliedUser: false };
}

export const NO_MENTIONS: MessageCreateOptions["allowedMentions"] = { parse: [], users: [], roles: [] };

export interface SinkOptions {
  allowedUserIds?: string[];
  replyToMessageId?: string;
  // Shared across sinks, keyed by channel, so a message posted by another sink still counts as beneath the trail.
  latestPosts?: Map<string, string>;
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

function menuRow(menu: SinkMenu): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = menu.options.map((option) => {
    const built = new StringSelectMenuOptionBuilder()
      .setValue(truncate(option.value, MENU_TEXT_LIMIT))
      .setLabel(truncate(option.label, MENU_TEXT_LIMIT) || "(blank)");
    if (option.description) built.setDescription(truncate(option.description, MENU_TEXT_LIMIT));
    return built;
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(menu.id)
    .setPlaceholder(truncate(menu.placeholder, PLACEHOLDER_LIMIT))
    .setMinValues(1)
    .setMaxValues(menu.multiple ? options.length : 1)
    .addOptions(options);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

type AnyRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

function closable(sent: Message, shown: string): AskHandle {
  return {
    async close(outcome: string): Promise<void> {
      await sent.edit({ content: `${shown}\n\n**${outcome}**`, components: [] }).catch(() => undefined);
    },
  };
}

// The channel reads in time order: the trail message is edited only while nothing lasting sits beneath it.
export function channelSink(channel: SendableChannels, options: SinkOptions = {}): MessageSink {
  const allowedMentions = mentionPolicy(options.allowedUserIds ?? []);
  let owned: Message | null = null;
  const latestPosts = options.latestPosts ?? new Map<string, string>();

  // The first message of a turn threads to what prompted it; a ping would be redundant on top.
  const firstSendOptions = (content: string): MessageCreateOptions =>
    options.replyToMessageId
      ? {
          content,
          allowedMentions,
          reply: { messageReference: options.replyToMessageId, failIfNotExists: false },
        }
      : { content, allowedMentions };

  const post = async (payload: MessageCreateOptions): Promise<Message> => {
    const sent = await channel.send(payload);
    latestPosts.set(channel.id, sent.id);
    return sent;
  };

  return {
    async send(text: string): Promise<void> {
      const shown = redactHome(text);
      const sent = await post(owned ? { content: shown, allowedMentions } : firstSendOptions(shown));
      owned ??= sent;
    },
    async edit(text: string, actions: SinkAction[] = []): Promise<void> {
      const shown = redactHome(text);
      if (!owned) {
        owned = await post(firstSendOptions(shown));
        return;
      }
      await owned.edit({ content: shown, allowedMentions, components: buttonRow(actions) });
    },
    async continueIn(text: string, actions: SinkAction[] = []): Promise<void> {
      owned = await post({ content: redactHome(text), allowedMentions, components: buttonRow(actions) });
    },
    isLatest(): boolean {
      return owned !== null && owned.id === latestPosts.get(channel.id);
    },
    // A notice deletes itself after a minute, so it never counts as something lasting beneath the trail.
    async notice(text: string): Promise<void> {
      await sendNotice(channel, redactHome(text));
    },
    typing(): void {
      // A failed keepalive is cosmetic; it must never take a turn down.
      if ("sendTyping" in channel) void channel.sendTyping().catch(() => undefined);
    },
    anchor(): SinkAnchor | null {
      return owned ? { channelId: owned.channelId, messageId: owned.id } : null;
    },
    async ask(text: string, actions: SinkAction[]): Promise<AskHandle> {
      const shown = redactHome(text);
      const sent = await post({ content: shown, allowedMentions, components: buttonRow(actions) });
      return closable(sent, shown);
    },
    // Five rows to a message: the tool asks at most four questions, and the buttons take the fifth.
    async askWithMenus(text: string, menus: SinkMenu[], actions: SinkAction[]): Promise<AskHandle> {
      const shown = redactHome(text);
      const components: AnyRow[] = [...menus.slice(0, 4).map(menuRow), ...buttonRow(actions)];
      const sent = await post({ content: shown, allowedMentions, components });
      return closable(sent, shown);
    },
    async sendFiles(text: string, files: SinkFile[]): Promise<void> {
      const attachments = files.map((file) => new AttachmentBuilder(file.data, { name: file.name }));
      await post({ content: redactHome(text), allowedMentions, files: attachments });
    },
  };
}
