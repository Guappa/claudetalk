import type { ChannelSettings } from "./claude/runner.ts";
import { orderedWriter, readStore } from "./jsonFile.ts";

export type ChannelRole = "text" | "voice";

// A stretch of what happened outside Discord: everything after one moment, up to and including another.
export interface UnseenStretch {
  after: string | null;
  through: string;
}

// Ten is more turns than anyone lets pass between two looks at /sync, and keeps a record nobody reads from growing without end.
const MAX_UNSEEN_STRETCHES = 10;

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
  // The channel was there before the conversation was bound to it, so who can see it is its server's to decide.
  adopted?: boolean;
  // Set while Claude Code holds no session under this id yet, so the first turn that finds none starts it instead of resuming it.
  unstarted?: boolean;
  syncedThrough?: string;
  // What a turn announced as having happened outside Discord and nobody has been shown. The turn marks itself seen when it ends, and would take these with it.
  unseen?: UnseenStretch[];
}

export interface NewConversation {
  sessionId: string;
  cwd: string;
  channelId: string;
  ownerId: string;
  settings?: ChannelSettings;
  mentionOnly?: boolean;
  adopted?: boolean;
  // True for an id minted here, which Claude Code has never seen.
  fresh?: boolean;
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
    adopted: input.adopted,
    unstarted: input.fresh ? true : undefined,
  };
}

// A record written before adoption was noted has only its tag-only mode to show that the channel was not made for it.
export function channelWasThereFirst(conversation: Conversation): boolean {
  return Boolean(conversation.adopted || conversation.mentionOnly);
}

interface StoreFile {
  conversations: Record<string, Conversation>;
  channelIndex: Record<string, string>;
  // Sessions the bridge started from a tag. It outlives the binding, so one found again by its name is bound the way it was started.
  tagStarted: string[];
}

function emptyStore(): StoreFile {
  return { conversations: {}, channelIndex: {}, tagStarted: [] };
}

export class ConversationStore {
  private data: StoreFile = emptyStore();
  private readonly filePath: string;
  private readonly write: (value: unknown) => Promise<void>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.write = orderedWriter(filePath);
  }

  async load(): Promise<void> {
    const file = await readStore<Partial<StoreFile>>(this.filePath, emptyStore);
    const conversations = file.conversations ?? {};
    // A store written before members and owners existed loads with them empty rather than undefined.
    for (const conversation of Object.values(conversations)) {
      conversation.memberIds ??= [];
      conversation.ownerId ??= "";
    }
    this.data = { conversations, channelIndex: file.channelIndex ?? {}, tagStarted: file.tagStarted ?? [] };
  }

  startedByTag(sessionId: string): boolean {
    return this.data.tagStarted.includes(sessionId);
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
    // A channel holds one conversation. The one it held before would otherwise stay in the store with nothing pointing at it, and count as open for good.
    const held = this.byChannel(channelId);
    if (held && held.sessionId !== conversation.sessionId) this.forget(held);
    this.data.conversations[conversation.sessionId] = conversation;
    this.data.channelIndex[channelId] = conversation.sessionId;
    this.rememberTagStarted(conversation);
    await this.flush();
  }

  private rememberTagStarted(conversation: Conversation): void {
    if (conversation.mentionOnly && !this.startedByTag(conversation.sessionId)) this.data.tagStarted.push(conversation.sessionId);
  }

  async markStarted(sessionId: string): Promise<void> {
    const conversation = this.data.conversations[sessionId];
    if (!conversation?.unstarted) return;
    conversation.unstarted = undefined;
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

  async noteUnseen(sessionId: string, stretch: UnseenStretch): Promise<void> {
    const conversation = this.data.conversations[sessionId];
    if (!conversation) return;
    conversation.unseen = [...(conversation.unseen ?? []), stretch].slice(-MAX_UNSEEN_STRETCHES);
    await this.flush();
  }

  // Everything up to that moment has been put in front of somebody, the stretches still owed included.
  async markShown(sessionId: string, through: string): Promise<void> {
    const conversation = this.data.conversations[sessionId];
    if (!conversation) return;
    conversation.unseen = undefined;
    if (!conversation.syncedThrough || conversation.syncedThrough < through) conversation.syncedThrough = through;
    await this.flush();
  }

  // Changed in place: a turn already queued holds this same object and reads it when it starts.
  async updateSettings(sessionId: string, settings: ChannelSettings): Promise<void> {
    const conversation = this.require(sessionId, "update");
    Object.assign(conversation.settings, settings);
    await this.flush();
  }

  // One write for the whole exchange, so a failure part-way cannot leave the channel bound to nothing, or the new conversation without its members.
  async startOver(previous: Conversation, sessionId: string): Promise<Conversation> {
    const fresh: Conversation = {
      sessionId,
      cwd: previous.cwd,
      boundAt: new Date().toISOString(),
      settings: { ...previous.settings },
      channels: { ...previous.channels },
      ownerId: previous.ownerId,
      memberIds: [...previous.memberIds],
      mentionOnly: previous.mentionOnly,
      adopted: previous.adopted,
      unstarted: true,
    };
    this.forget(previous);
    this.data.conversations[sessionId] = fresh;
    this.rememberTagStarted(fresh);
    this.data.channelIndex[fresh.channels.text] = sessionId;
    if (fresh.channels.voice) this.data.channelIndex[fresh.channels.voice] = sessionId;
    await this.flush();
    return fresh;
  }

  async unbind(channelId: string): Promise<void> {
    const sessionId = this.data.channelIndex[channelId];
    delete this.data.channelIndex[channelId];
    if (!sessionId) return await this.flush();

    const conversation = this.data.conversations[sessionId];
    if (conversation) {
      if (conversation.channels.text === channelId) this.forget(conversation);
      else if (conversation.channels.voice === channelId) delete conversation.channels.voice;
    }
    await this.flush();
  }

  // Every channel that pointed at it goes with it, or one left behind would route into whatever is bound under the same session next.
  private forget(conversation: Conversation): void {
    delete this.data.conversations[conversation.sessionId];
    for (const [channelId, sessionId] of Object.entries(this.data.channelIndex)) {
      if (sessionId === conversation.sessionId) delete this.data.channelIndex[channelId];
    }
  }

  private require(sessionId: string, action: string): Conversation {
    const conversation = this.data.conversations[sessionId];
    if (!conversation) throw new Error(`No conversation with session ${sessionId} to ${action}.`);
    return conversation;
  }

  private async flush(): Promise<void> {
    await this.write(this.data);
  }
}
