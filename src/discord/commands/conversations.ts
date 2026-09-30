import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type TextChannel,
} from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { displayPath } from "../../displayPath.ts";
import type { Say } from "../../i18n/index.ts";
import { helloToNew } from "../../claude/prompts.ts";
import type { Conversation } from "../../conversations.ts";
import { errorMessage } from "../../text.ts";
import { newestCopy, resolveByFolder, resolveByName, type Resolution } from "../../sessions/resolve.ts";
import { hasWorkingDir, type ResumableRecord, type SessionRecord } from "../../sessions/index.ts";
import { lastExchanges } from "../../sessions/exchanges.ts";
import { forkName, runFork } from "./fork.ts";
import { displayName } from "../../sessions/displayName.ts";
import { humanAge } from "./sessionList.ts";
import { CREATE_CANCEL, CREATE_NEW, createResumeId } from "../menus.ts";
import type { PendingCreate } from "../pendingCreate.ts";
import { requireConversation, requireGuild } from "../binding.ts";
import { channelSink } from "../sink.ts";
import { toChannelName } from "../channelName.ts";
import { categoryIsFull, describeCategoryFull, resolveCategory } from "../category.ts";
import { conversationOverwrites } from "../channelAccess.ts";
import { tierOf, workingDirFor } from "../policy.ts";
import { runConversationTurn } from "../turn.ts";
import { markCaughtUp } from "../sync.ts";
import { formatExchanges } from "../transcriptView.ts";
import { respond } from "../respond.ts";
import { nameForDiscord, postText, splitForDiscord } from "../outgoing.ts";

const RECAP_EXCHANGES = 2;
// Enough to pick from, and few enough that the question fits in the reply however many conversations share the start of a name.
const MAX_NAMED = 10;

async function createConversationChannel(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  name: string,
  cwd: string,
  categoryId?: string,
): Promise<TextChannel | null> {
  const guild = await requireGuild(bridge, interaction);
  if (!guild) return null;

  const say = bridge.language.say;
  const parent = interaction.channel && "parentId" in interaction.channel ? interaction.channel.parentId : null;
  const target = categoryId ?? bridge.config.categoryId ?? parent;
  // Discord refuses a fifty-first channel in words that read as a permissions problem, so the count is looked at first.
  if (target && categoryIsFull(guild, target)) {
    await respond(interaction, describeCategoryFull(say, guild.channels.cache.get(target)?.name ?? target));
    return null;
  }

  try {
    return await guild.channels.create({
      name: toChannelName(name),
      type: ChannelType.GuildText,
      parent: target,
      topic: say("create.topic", { name, cwd: displayPath(cwd) }),
      permissionOverwrites: conversationOverwrites({
        everyoneRoleId: guild.roles.everyone.id,
        botUserId: interaction.client.user.id,
        ownerId: interaction.user.id,
        memberIds: [],
      }),
    });
  } catch (error) {
    await respond(interaction, say("create.channelFailed", { error: errorMessage(error) }));
    return null;
  }
}

// Claude Code is spawned with this as its cwd, and a missing one fails as a bare spawn ENOENT.
async function resolveWorkingDir(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
  project: string | undefined,
): Promise<string | null> {
  const say = bridge.language.say;
  const cwd = workingDirFor(bridge, tierOf(bridge, interaction.user.id), interaction.user.id, project);
  if (!cwd) {
    await respond(interaction, say("create.ownersOnlyHere"));
    return null;
  }

  try {
    await fs.mkdir(cwd, { recursive: true });
    return cwd;
  } catch (error) {
    await respond(interaction, say("create.folderFailed", { cwd: displayPath(cwd), error: errorMessage(error) }));
    return null;
  }
}

// Undefined means no category was asked for; null means one was and could not be used.
async function resolveWantedCategory(
  say: Say,
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  wanted: string | null,
): Promise<string | undefined | null> {
  if (!wanted) return undefined;
  try {
    const category = await resolveCategory(guild, wanted);
    if (categoryIsFull(guild, category.id)) {
      await respond(interaction, describeCategoryFull(say, category.name));
      return null;
    }
    return category.id;
  } catch (error) {
    await respond(interaction, say("create.categoryFailed", { name: wanted, error: errorMessage(error) }));
    return null;
  }
}

export async function handleCreate(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString("name", true);

  const guild = await requireGuild(bridge, interaction);
  if (!guild) return;

  const cwd = await resolveWorkingDir(bridge, interaction, interaction.options.getString("project") ?? undefined);
  if (!cwd) return;

  const wantedCategory = interaction.options.getString("category");
  const categoryId = await resolveWantedCategory(bridge.language.say, interaction, guild, wantedCategory);
  if (categoryId === null) return;

  const existing = resolveByFolder(await bridge.sessions.build(), cwd);
  if (existing.length > 0) {
    await askWhichConversation(bridge, interaction, { name, cwd, categoryId }, existing);
    return;
  }

  await startConversation(bridge, interaction, { name, cwd, categoryId });
}

export async function startConversation(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  request: PendingCreate,
): Promise<void> {
  const channel = await createConversationChannel(bridge, interaction, request.name, request.cwd, request.categoryId);
  if (!channel) return;

  const conversation = await bridge.store.bindNew({
    sessionId: randomUUID(),
    cwd: request.cwd,
    channelId: channel.id,
    ownerId: interaction.user.id,
    fresh: true,
  });
  await respond(interaction, {
    content: bridge.language.say("create.done", {
      channel: String(channel),
      name: request.name,
      cwd: displayPath(request.cwd),
    }),
    components: [],
  });

  await runConversationTurn(bridge, conversation, {
    prompt: helloToNew(request.name),
    sink: channelSink(channel, { latestPosts: bridge.latestPosts }),
    name: request.name,
  });
}

const MAX_OFFERED = 3;

// A folder usually already holds the conversation you meant, so starting a second one is a choice.
async function askWhichConversation(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
  request: PendingCreate,
  existing: SessionRecord[],
): Promise<void> {
  const say = bridge.language.say;
  const offered = existing.slice(0, MAX_OFFERED);
  const buttons = offered.map((record) =>
    new ButtonBuilder()
      .setCustomId(createResumeId(record.sessionId))
      .setLabel(
        nameForDiscord(say("create.resumeButton", { name: displayName(record), age: humanAge(say, record.lastActivity) })).slice(
          0,
          80,
        ),
      )
      .setStyle(ButtonStyle.Primary),
  );
  buttons.push(
    new ButtonBuilder().setCustomId(CREATE_NEW).setLabel(say("create.startNew")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CREATE_CANCEL).setLabel(say("common.cancel")).setStyle(ButtonStyle.Secondary),
  );

  const found = { cwd: displayPath(request.cwd), count: existing.length };
  const hidden = existing.length - offered.length;
  await respond(interaction, {
    content: hidden > 0 ? say("create.existingMore", { ...found, hidden }) : say("create.existing", found),
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
  });

  const reply = await interaction.fetchReply();
  bridge.pendingCreates.remember(reply.id, request);
}

// A turn can outlast Discord's fifteen minute interaction token, so the report needs a fallback.
async function reportBack(interaction: ChatInputCommandInteraction, text: string): Promise<void> {
  try {
    await respond(interaction, { content: text, components: [] });
  } catch {
    if (interaction.channel?.isSendable()) await postText(interaction.channel, text);
  }
}

export async function handleFork(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const say = bridge.language.say;
  const source = await requireConversation(bridge, interaction, say("fork.unbound"));
  if (!source) return;

  const record = await bridge.sessions.find(source.sessionId);
  const check = bridge.flow.available(source.sessionId, record);
  if (check.kind !== "ok") {
    await respond(interaction, check.message);
    return;
  }

  const sourceName = record ? displayName(record) : say("fork.unnamed");
  const name = forkName(sourceName, interaction.options.getString("name"));

  const channel = await createConversationChannel(bridge, interaction, name, source.cwd);
  if (!channel) return;

  await respond(interaction, say("fork.branching", { channel: String(channel) }));
  const forked = await runFork(bridge, interaction, source, channel, name);

  if (forked.kind === "not-started") {
    // The channel holds nothing but the notice that refused the turn, so it goes again.
    await channel.delete().catch(() => undefined);
    await reportBack(interaction, say("fork.notStarted"));
    return;
  }
  if (forked.kind === "no-session") {
    await reportBack(interaction, say("fork.notBound", { channel: String(channel) }));
    return;
  }

  await reportBack(interaction, say("fork.done", { source: sourceName, channel: String(channel), name }));
}

export async function handleResume(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const say = bridge.language.say;
  const name = interaction.options.getString("name", true);
  const index = await bridge.sessions.build();

  // Autocomplete sends a session id, which is unambiguous; typed text falls back to the name.
  const picked = newestCopy(index, name);
  const resolution: Resolution = picked ? { match: picked, shadowed: [] } : resolveByName(index, name);

  if (!resolution.match) {
    const names = resolution.candidates.map(displayName);
    const shown = names.slice(0, MAX_NAMED).join(", ");
    const candidates =
      names.length > MAX_NAMED ? say("resume.andMore", { candidates: shown, count: names.length - MAX_NAMED }) : shown;
    await respond(interaction, candidates ? say("resume.ambiguous", { name, candidates }) : say("resume.notFound", { name }));
    return;
  }

  const match = resolution.match;
  if (!hasWorkingDir(match)) {
    await respond(interaction, say("resume.noFolder", { name: displayName(match) }));
    return;
  }

  await openConversation(bridge, interaction, match, resolution.shadowed.length);
}

// A second channel on one conversation would overwrite the first one's members and settings.
async function pointAtOpenChannel(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  match: ResumableRecord,
  open: Conversation,
): Promise<void> {
  await respond(interaction, {
    content: bridge.language.say("binding.alreadyOpen", { name: displayName(match), channelId: open.channels.text }),
    components: [],
  });
}

export async function openConversation(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  match: ResumableRecord,
  olderSkipped = 0,
): Promise<void> {
  const say = bridge.language.say;
  const open = bridge.store.bySession(match.sessionId);
  if (open) return await pointAtOpenChannel(bridge, interaction, match, open);

  const channel = await createConversationChannel(bridge, interaction, displayName(match), match.cwd);
  if (!channel) return;
  // Making a channel takes a moment, in which the same conversation can be opened from somewhere else; nothing is awaited between this look and the binding.
  const openedMeanwhile = bridge.store.bySession(match.sessionId);
  if (openedMeanwhile) {
    await channel.delete().catch(() => undefined);
    return await pointAtOpenChannel(bridge, interaction, match, openedMeanwhile);
  }

  const conversation = await bridge.store.bindNew({
    sessionId: match.sessionId,
    cwd: match.cwd,
    channelId: channel.id,
    ownerId: interaction.user.id,
  });

  const opened = { channel: String(channel), name: displayName(match), cwd: displayPath(match.cwd) };
  await respond(interaction, {
    content: olderSkipped > 0 ? say("resume.openedPastOlder", { ...opened, count: olderSkipped }) : say("resume.opened", opened),
    components: [],
  });

  const recent = await lastExchanges(match.transcriptPath, RECAP_EXCHANGES);
  if (recent.length > 0) {
    for (const chunk of splitForDiscord(`${say("sync.leftOff")}\n\n${formatExchanges(say, recent)}`)) {
      await postText(channel, chunk);
    }
  }
  await markCaughtUp(bridge, conversation);
}
