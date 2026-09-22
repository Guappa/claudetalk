import type { ChannelSettings } from "./claude/runner.ts";
import { readJsonOr, writeJsonAtomic } from "./jsonFile.ts";

export type ChannelRole = "text" | "voice";

export interface Conversation {
  sessionId: string;
  cwd: string;
  boundAt: string;
  settings: ChannelSettings;
  channels: { text: string; voice?: string };
  ownerId: string;
  memberIds: string[];
  // Ad-hoc channels answer only when tagged, so shared channels stay usable.
  mentionOnly?: boolean;
  syncedThrough?: string;
}

export interface NewConversation {
  sessionId: string;
  cwd: string;
  channelId: string;
  ownerId: string;
  settings?: ChannelSettings;
  mentionOnly?: boolean;
}

function newConversation(input: NewConversation): Conversation {
  return {
    sessionId: input.sessionId,
    cwd: input.cwd,
    boundAt: new Date().toISOString(),
    settings: input.settings ?? {},
    channels: { text: input.channelId },
    ownerId: input.ownerId,
    memberIds: [],
    mentionOnly: input.mentionOnly,
  };
}

interface StoreFile {
  conversations: Record<string, Conversation>;
  channelIndex: Record<string, string>;
}

function emptyStore(): StoreFile {
  return { conversations: {}, channelIndex: {} };
}

export class ConversationStore {
  private data: StoreFile = emptyStore();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    const file = await readJsonOr<Partial<StoreFile>>(this.filePath, emptyStore);
    const conversations = file.conversations ?? {};
    // A store written before members and owners existed loads with them empty rather than undefined.
    for (const conversation of Object.values(conversations)) {
      conversation.memberIds ??= [];
      conversation.ownerId ??= "";
    }
    this.data = { conversations, channelIndex: file.channelIndex ?? {} };
  }

  byChannel(channelId: string): Conversation | undefined {
    const sessionId = this.data.channelIndex[channelId];
    return sessionId ? this.data.conversations[sessionId] : undefined;
  }

  bySession(sessionId: string): Conversation | undefined {
    return this.data.conversations[sessionId];
  }

  all(): Conversation[] {
    return Object.values(this.data.conversations);
  }

  async bindNew(input: NewConversation): Promise<Conversation> {
    const conversation = newConversation(input);
    await this.bind(input.channelId, conversation);
    return conversation;
  }

  async bind(channelId: string, conversation: Conversation): Promise<void> {
    this.data.conversations[conversation.sessionId] = conversation;
    this.data.channelIndex[channelId] = conversation.sessionId;
    await this.flush();
  }

  async attachChannel(sessionId: string, channelId: string, role: ChannelRole): Promise<void> {
    const conversation = this.require(sessionId, "attach a channel to");
    conversation.channels[role] = channelId;
    this.data.channelIndex[channelId] = sessionId;
    await this.flush();
  }

  async setMembers(sessionId: string, memberIds: string[]): Promise<Conversation> {
    const conversation = this.require(sessionId, "give members to");
    conversation.memberIds = [...new Set(memberIds)];
    await this.flush();
    return conversation;
  }

  async markSynced(sessionId: string, through: string): Promise<void> {
    const conversation = this.data.conversations[sessionId];
    if (!conversation) return;
    conversation.syncedThrough = through;
    await this.flush();
  }

  async updateSettings(sessionId: string, settings: ChannelSettings): Promise<void> {
    const conversation = this.require(sessionId, "update");
    conversation.settings = { ...conversation.settings, ...settings };
    await this.flush();
  }

  async unbind(channelId: string): Promise<void> {
    const sessionId = this.data.channelIndex[channelId];
    delete this.data.channelIndex[channelId];
    if (!sessionId) return await this.flush();

    const conversation = this.data.conversations[sessionId];
    if (conversation) {
      if (conversation.channels.text === channelId) delete this.data.conversations[sessionId];
      else if (conversation.channels.voice === channelId) delete conversation.channels.voice;
    }
    await this.flush();
  }

  private require(sessionId: string, action: string): Conversation {
    const conversation = this.data.conversations[sessionId];
    if (!conversation) throw new Error(`No conversation with session ${sessionId} to ${action}.`);
    return conversation;
  }

  private async flush(): Promise<void> {
    await writeJsonAtomic(this.filePath, this.data);
  }
}
