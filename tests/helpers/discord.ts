import { Collection } from "discord.js";
import type { ButtonInteraction, ChatInputCommandInteraction, Guild, Message, TextChannel } from "discord.js";
import { GUILD } from "./bridge.ts";

const BOT = "300000000000000001";

interface Payload {
  content?: string;
  components?: unknown[];
}

function textOf(payload: string | Payload): string {
  return typeof payload === "string" ? payload : (payload.content ?? "");
}

// The custom ids of whatever buttons and menus a reply carries, in order.
function controlsOf(payload: string | Payload): string[] {
  if (typeof payload === "string") return [];
  return (payload.components ?? []).flatMap((row) =>
    (row as { components: Array<{ data: { custom_id?: string } }> }).components.map((control) => control.data.custom_id ?? ""),
  );
}

export interface FakeChannel {
  channel: TextChannel;
  // What the channel holds, one entry per message; an edit replaces the entry it edits.
  posted: string[];
  // What people said here before, newest first, for a command that reads the channel back.
  earlier: Message[];
  wasDeleted: () => boolean;
  // Each time the channel's permissions were replaced, the ids the new set names, in order.
  permissions: string[][];
}

export function fakeChannel(id: string, name = "general"): FakeChannel {
  const posted: string[] = [];
  const earlier: Message[] = [];
  const permissions: string[][] = [];
  let deleted = false;
  const channel = {
    id,
    name,
    parentId: null,
    permissionOverwrites: {
      set: async (overwrites: Array<{ id: string }>) => void permissions.push(overwrites.map((overwrite) => overwrite.id)),
    },
    messages: { fetch: async ({ limit }: { limit: number }) => new Map(earlier.slice(0, limit).map((said) => [said.id, said])) },
    isSendable: () => true,
    isThread: () => false,
    isDMBased: () => false,
    sendTyping: async () => undefined,
    bulkDelete: async () => new Map(),
    send: async (payload: string | Payload) => {
      const at = posted.push(textOf(payload)) - 1;
      return {
        id: `${id}-${at}`,
        channelId: id,
        edit: async (edited: Payload) => {
          if (edited.content !== undefined) posted[at] = edited.content;
        },
        delete: async () => undefined,
        startThread: async () => {
          throw new Error("this channel has no threads");
        },
      };
    },
    delete: async () => {
      deleted = true;
    },
  };
  return { channel: channel as unknown as TextChannel, posted, earlier, wasDeleted: () => deleted, permissions };
}

export interface FakeGuild {
  guild: Guild;
  // Every channel the guild was asked to make, in order.
  made: FakeChannel[];
  // Channels the guild already holds, as far as a category's count goes.
  standing: Collection<string, { id: string; name: string; parentId: string | null }>;
}

// What a test passes in runs while a channel is being made, which is where it puts whatever happens meanwhile.
export function fakeGuild(whileMaking: () => void = () => undefined): FakeGuild {
  const made: FakeChannel[] = [];
  const standing = new Collection<string, { id: string; name: string; parentId: string | null }>();
  const guild = {
    roles: { everyone: { id: "400000000000000002" } },
    channels: {
      cache: standing,
      create: async ({ name }: { name: string }) => {
        const channel = fakeChannel(`made-${made.length + 1}`, name);
        made.push(channel);
        await Promise.resolve();
        whileMaking();
        return channel.channel;
      },
    },
  };
  return { guild: guild as unknown as Guild, made, standing };
}

export interface FakeCommand {
  interaction: ChatInputCommandInteraction;
  replies: string[];
  // The controls on the latest reply.
  controls: () => string[];
}

interface FakeUser {
  id: string;
  username: string;
  bot: boolean;
}

type OptionValue = string | number | boolean | FakeUser;

export function fakeCommand(
  place: FakeChannel,
  userId: string,
  options: Record<string, OptionValue> = {},
  guild: unknown = null,
): FakeCommand {
  const replies: string[] = [];
  let controls: string[] = [];
  const option =
    <Kind extends OptionValue>(kind: string) =>
    (name: string): Kind | null =>
      typeof options[name] === kind ? (options[name] as Kind) : null;
  const interaction = {
    channelId: place.channel.id,
    channel: place.channel,
    guild,
    user: { id: userId },
    client: { user: { id: BOT } },
    options: {
      getString: option<string>("string"),
      getInteger: option<number>("number"),
      getBoolean: option<boolean>("boolean"),
      getUser: option<FakeUser>("object"),
    },
    editReply: async (payload: string | Payload) => {
      replies.push(textOf(payload));
      controls = controlsOf(payload);
    },
    fetchReply: async () => ({ id: `${place.channel.id}-reply` }),
  };
  return { interaction: interaction as unknown as ChatInputCommandInteraction, replies, controls: () => controls };
}

export interface FakePress {
  interaction: ButtonInteraction;
  // What the menu the button sits on was made to say, in order.
  replies: string[];
  // What was said to the presser alone, beside the menu.
  whispers: string[];
  // The controls on the latest message the press wrote.
  controls: () => string[];
}

export function fakePress(place: FakeChannel, userId: string, customId: string, guild: unknown = null): FakePress {
  const replies: string[] = [];
  const whispers: string[] = [];
  let controls: string[] = [];
  const written = (payload: string | Payload): void => {
    if (typeof payload === "string" || payload.content !== undefined) replies.push(textOf(payload));
    controls = controlsOf(payload);
  };
  const interaction = {
    customId,
    channelId: place.channel.id,
    channel: place.channel,
    guild,
    user: { id: userId },
    client: { user: { id: BOT } },
    message: { id: `${place.channel.id}-reply` },
    deferred: false,
    replied: false,
    update: async (payload: Payload) => {
      written(payload);
      interaction.replied = true;
    },
    editReply: async (payload: string | Payload) => written(payload),
    followUp: async (payload: Payload) => void whispers.push(textOf(payload)),
    deferUpdate: async () => {
      interaction.deferred = true;
    },
    deferReply: async () => {
      interaction.deferred = true;
    },
  };
  return { interaction: interaction as unknown as ButtonInteraction, replies, whispers, controls: () => controls };
}

interface FakeUpload {
  name: string;
  size: number;
}

interface FakeMessage {
  message: Message;
  replies: string[];
  reactions: string[];
}

interface Said {
  authorId: string;
  content: string;
  // Set for what Discord writes in a person's name: a pin, a thread being made.
  system?: boolean;
  mentionsBot?: boolean;
  uploads?: FakeUpload[];
  repliedTo?: Message;
}

export function fakeMessage(place: FakeChannel, said: Said): FakeMessage {
  const replies: string[] = [];
  const reactions: string[] = [];
  const uploads = (said.uploads ?? []).map((upload) => ({ ...upload, url: "https://files.invalid/upload", contentType: null }));
  const message = {
    id: `${place.channel.id}-said-${said.content.length}`,
    guildId: GUILD,
    channelId: place.channel.id,
    channel: place.channel,
    content: said.mentionsBot ? `<@${BOT}> ${said.content}` : said.content,
    author: { id: said.authorId, bot: false, username: "someone" },
    system: said.system === true,
    member: null,
    createdAt: new Date(0),
    client: { user: { id: BOT } },
    mentions: { users: { has: (userId: string) => said.mentionsBot === true && userId === BOT } },
    attachments: { size: uploads.length, map: <Out>(each: (upload: (typeof uploads)[number]) => Out) => uploads.map(each) },
    reference: said.repliedTo ? { messageId: said.repliedTo.id } : null,
    fetchReference: async () => said.repliedTo,
    reply: async (payload: Payload) => void replies.push(textOf(payload)),
    react: async (emoji: string) => {
      reactions.push(emoji);
      return { emoji: { name: emoji }, users: { remove: async () => undefined } };
    },
  };
  return { message: message as unknown as Message, replies, reactions };
}
