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
import { count, errorMessage } from "../../text.ts";
import { resolveByFolder, resolveByName, type Resolution } from "../../sessions/resolve.ts";
import { hasWorkingDir, type ResumableRecord, type SessionRecord } from "../../sessions/index.ts";
import { lastExchanges } from "../../sessions/exchanges.ts";
import { forkName, runFork } from "./fork.ts";
import { displayName } from "../../sessions/displayName.ts";
import { humanAge } from "./sessionList.ts";
import { CREATE_CANCEL, CREATE_NEW, createResumeId } from "../menus.ts";
import type { PendingCreate } from "../pendingCreate.ts";
import { describeAlreadyOpen, requireConversation, requireGuild } from "../binding.ts";
import { channelSink } from "../sink.ts";
import { toChannelName } from "../channelName.ts";
import { categoryIsFull, describeCategoryFull, resolveCategory } from "../category.ts";
import { conversationOverwrites } from "../channelAccess.ts";
import { tierOf, workingDirFor } from "../policy.ts";
import { runConversationTurn } from "../turn.ts";
import { markCaughtUp } from "../sync.ts";
import { formatExchanges } from "../transcriptView.ts";
import { chunkForDiscord } from "../renderer.ts";
import { respond } from "../respond.ts";

const RECAP_EXCHANGES = 2;

async function createConversationChannel(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  name: string,
  cwd: string,
  categoryId?: string,
): Promise<TextChannel | null> {
  const guild = await requireGuild(interaction);
  if (!guild) return null;

  const parent =
    interaction.channel && "parentId" in interaction.channel ? interaction.channel.parentId : null;
  const target = categoryId ?? bridge.config.categoryId ?? parent;

  try {
    return await guild.channels.create({
      name: toChannelName(name),
      type: ChannelType.GuildText,
      parent: target,
      topic: `Claude Code conversation "${name}" in ${displayPath(cwd)}`,
      permissionOverwrites: conversationOverwrites({
        everyoneRoleId: guild.roles.everyone.id,
        botUserId: interaction.client.user.id,
        ownerId: interaction.user.id,
        memberIds: [],
      }),
    });
  } catch (error) {
    await respond(
      interaction,
      `Could not create the channel: ${errorMessage(error)}. ` +
        `The bot needs Manage Channels and Manage Roles in this server; ` +
        `Manage Roles is what lets it make the channel private to you.`,
    );
    return null;
  }
}

// Claude Code is spawned with this as its cwd, and a missing one fails as a bare spawn ENOENT.
async function resolveWorkingDir(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
  project: string | undefined,
): Promise<string | null> {
  let cwd: string;
  try {
    cwd = workingDirFor(bridge, tierOf(bridge, interaction.user.id), interaction.user.id, project);
  } catch (error) {
    await respond(interaction, errorMessage(error));
    return null;
  }

  try {
    await fs.mkdir(cwd, { recursive: true });
    return cwd;
  } catch (error) {
    await respond(
      interaction,
      `Could not use \`${displayPath(cwd)}\` as the working directory: ${errorMessage(error)}. ` +
        `Check the path is somewhere the bridge may write, or pass an existing folder as \`project\`.`,
    );
    return null;
  }
}

// Undefined means no category was asked for; null means one was and could not be used.
async function resolveWantedCategory(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  wanted: string | null,
): Promise<string | undefined | null> {
  if (!wanted) return undefined;
  try {
    const category = await resolveCategory(guild, wanted);
    if (categoryIsFull(guild, category.id)) {
      await respond(interaction, describeCategoryFull(category.name));
      return null;
    }
    return category.id;
  } catch (error) {
    await respond(
      interaction,
      `Could not use the category **${wanted}**: ${errorMessage(error)}. The bot needs Manage Channels to make one.`,
    );
    return null;
  }
}

export async function handleCreate(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const name = interaction.options.getString("name", true);

  const guild = await requireGuild(interaction);
  if (!guild) return;

  const cwd = await resolveWorkingDir(bridge, interaction, interaction.options.getString("project") ?? undefined);
  if (!cwd) return;

  const categoryId = await resolveWantedCategory(interaction, guild, interaction.options.getString("category"));
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
  const channel = await createConversationChannel(
    bridge,
    interaction,
    request.name,
    request.cwd,
    request.categoryId,
  );
  if (!channel) return;

  const conversation = await bridge.store.bindNew({
    sessionId: randomUUID(),
    cwd: request.cwd,
    channelId: channel.id,
    ownerId: interaction.user.id,
  });
  await respond(interaction, {
    content: `Created ${channel} for **${request.name}** in \`${displayPath(request.cwd)}\`.`,
    components: [],
  });

  await runConversationTurn(bridge, conversation, {
    actorId: interaction.user.id,
    prompt:
      `This conversation was created from Discord and is named "${request.name}". ` +
      `Say hello in one short line, naming the folder you are working in but not its full path.`,
    sink: channelSink(channel, { latestPosts: bridge.latestPosts }),
    resume: false,
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
  const offered = existing.slice(0, MAX_OFFERED);
  const buttons = offered.map((record) =>
    new ButtonBuilder()
      .setCustomId(createResumeId(record.sessionId))
      .setLabel(`Resume ${displayName(record)} (${humanAge(record.lastActivity)})`.slice(0, 80))
      .setStyle(ButtonStyle.Primary),
  );
  buttons.push(
    new ButtonBuilder().setCustomId(CREATE_NEW).setLabel("Start a new one").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CREATE_CANCEL).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

  const more = existing.length > offered.length ? ` (${existing.length - offered.length} older not shown)` : "";
  await respond(interaction, {
    content:
      `\`${displayPath(request.cwd)}\` already has ${count(existing.length, "conversation")}${more}. ` +
      "Resume one, or start another alongside it?",
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
    if (interaction.channel?.isSendable()) await interaction.channel.send(text);
  }
}

export async function handleFork(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const source = await requireConversation(
    bridge,
    interaction,
    "This channel isn't bound to a conversation, so there is nothing to branch.",
  );
  if (!source) return;

  const record = await bridge.sessions.find(source.sessionId);
  const check = bridge.flow.available(source.sessionId, record);
  if (check.kind !== "ok") {
    await respond(interaction, check.message);
    return;
  }

  const sourceName = record ? displayName(record) : "conversation";
  const name = forkName(sourceName, interaction.options.getString("name"));

  const channel = await createConversationChannel(bridge, interaction, name, source.cwd);
  if (!channel) return;

  await respond(interaction, `Branching into ${channel}...`);
  const forked = await runFork(bridge, interaction, source, channel, name);

  if (!forked) {
    await reportBack(
      interaction,
      `Created ${channel}, but Claude Code did not report a new session id, so it is not bound. ` +
        `Use \`/resume\` there once the branch appears in \`/sessions\`.`,
    );
    return;
  }

  await reportBack(
    interaction,
    `Branched **${sourceName}** into ${channel} as **${name}**. This channel is untouched.`,
  );
}

export async function handleResume(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const name = interaction.options.getString("name", true);
  const index = await bridge.sessions.build();

  // Autocomplete sends a session id, which is unambiguous; typed text falls back to the name.
  const picked = index.find((record) => record.sessionId === name) ?? null;
  const resolution: Resolution = picked ? { match: picked, shadowed: [] } : resolveByName(index, name);

  if (!resolution.match) {
    const candidates = resolution.candidates.map(displayName).join(", ");
    await respond(
      interaction,
      candidates
        ? `"${name}" is ambiguous. Did you mean: ${candidates}?`
        : `No conversation named "${name}". Use \`/sessions\` to see what exists.`,
    );
    return;
  }

  const match = resolution.match;
  if (!hasWorkingDir(match)) {
    await respond(
      interaction,
      `Found "${displayName(match)}" but could not read its working directory from the transcript, so it cannot be resumed.`,
    );
    return;
  }

  const shadowed =
    resolution.shadowed.length > 0
      ? ` (${resolution.shadowed.length} older conversation with the same name was skipped)`
      : "";

  await openConversation(bridge, interaction, match, shadowed);
}

export async function openConversation(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  match: ResumableRecord,
  shadowed = "",
): Promise<void> {
  // A second channel on one conversation would overwrite the first one's members and settings.
  const open = bridge.store.bySession(match.sessionId);
  if (open) {
    await respond(interaction, { content: describeAlreadyOpen(displayName(match), open.channels.text), components: [] });
    return;
  }

  const channel = await createConversationChannel(bridge, interaction, displayName(match), match.cwd);
  if (!channel) return;

  const conversation = await bridge.store.bindNew({
    sessionId: match.sessionId,
    cwd: match.cwd,
    channelId: channel.id,
    ownerId: interaction.user.id,
  });

  await respond(interaction, {
    content: `Opened ${channel} for **${displayName(match)}** in \`${displayPath(match.cwd)}\`${shadowed}.`,
    components: [],
  });

  const recent = await lastExchanges(match.transcriptPath, RECAP_EXCHANGES);
  if (recent.length > 0) {
    for (const chunk of chunkForDiscord(`Where you left off:\n\n${formatExchanges(recent)}`)) {
      await channel.send(chunk);
    }
  }
  await markCaughtUp(bridge, conversation);
}
