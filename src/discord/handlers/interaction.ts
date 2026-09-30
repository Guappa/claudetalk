import {
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { canRunCommand } from "../../access.ts";
import { shownError } from "../../text.ts";
import { forDiscord } from "../outgoing.ts";
import { respondQuietly } from "../respond.ts";
import { isFromGuild } from "../gate.ts";
import { tierOf } from "../policy.ts";
import { handleAsk } from "../commands/ask.ts";
import { handleCategory } from "../commands/category.ts";
import { handleQueue, handleStop, handleTakeover, handleUnbind } from "../commands/control.ts";
import { handleClear } from "../commands/clear.ts";
import { handleCreate, handleFork, handleResume } from "../commands/conversations.ts";
import { handleLanguage } from "../commands/language.ts";
import { handleInvite, handleMembers, handleUninvite } from "../commands/membership.ts";
import { handleOperator } from "../commands/operators.ts";
import { handleAutocomplete, handleSessions } from "../commands/sessions.ts";
import { handleRun, suggestCommands } from "../commands/run.ts";
import { handleSetting, handleWhoami } from "../commands/settings.ts";
import { handleSync } from "../commands/sync.ts";
import { handleSpend } from "../commands/spend.ts";
import { handlePluginsCommand } from "../commands/plugins.ts";
import { handlePurgeCommand } from "../commands/purge.ts";
import { handleSkillsCommand } from "../commands/skills.ts";
import { handleButton, handleModal, handleSelect } from "./components.ts";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

// An acknowledgement is for whoever asked; only what a conversation produces belongs to the channel.
function replyIsContent(commandName: string): boolean {
  return commandName === "sync";
}

type CommandHandler = (bridge: Bridge, interaction: ChatInputCommandInteraction) => Promise<void>;

// Keyed by the names registry.ts registers; a test fails the build if the two ever disagree.
const COMMANDS: Record<string, CommandHandler> = {
  create: handleCreate,
  resume: handleResume,
  fork: handleFork,
  sessions: handleSessions,
  whoami: handleWhoami,
  spend: handleSpend,
  model: (bridge, interaction) => handleSetting(bridge, interaction, "model"),
  effort: (bridge, interaction) => handleSetting(bridge, interaction, "effort"),
  category: handleCategory,
  unbind: handleUnbind,
  stop: handleStop,
  queue: handleQueue,
  ask: handleAsk,
  sync: handleSync,
  purge: handlePurgeCommand,
  clear: handleClear,
  plugins: handlePluginsCommand,
  skills: handleSkillsCommand,
  run: handleRun,
  operator: handleOperator,
  invite: handleInvite,
  uninvite: handleUninvite,
  members: handleMembers,
  takeover: handleTakeover,
  language: handleLanguage,
};

type Suggester = (bridge: Bridge, interaction: AutocompleteInteraction) => Promise<void>;

// Which command is asking decides what is suggested; one that offers nothing gets an empty list.
const SUGGESTERS: Record<string, Suggester> = {
  resume: handleAutocomplete,
  run: suggestCommands,
};

export async function handleInteraction(bridge: Bridge, interaction: Interaction): Promise<void> {
  if (!isFromGuild(bridge.config, interaction.guildId, interaction.user.bot)) return;
  if (!interaction.channelId) return;

  const say = bridge.language.say;
  const tier = tierOf(bridge, interaction.user.id);
  if (tier === "none") {
    // A deliberate click deserves an answer; a message does not, or a stranger could make it post.
    if (interaction.isRepliable()) {
      await interaction.reply({ content: forDiscord(say("access.none")), ...EPHEMERAL });
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    const suggest = SUGGESTERS[interaction.commandName];
    return suggest ? await suggest(bridge, interaction) : await interaction.respond([]);
  }
  if (interaction.isStringSelectMenu() || interaction.isModalSubmit() || interaction.isButton()) {
    return await pressed(bridge, interaction);
  }
  if (!interaction.isChatInputCommand()) return;

  if (!canRunCommand(tier, interaction.commandName)) {
    await interaction.reply({
      content: forDiscord(say("access.ownersOnly", { command: interaction.commandName })),
      ...EPHEMERAL,
    });
    return;
  }

  const handler = COMMANDS[interaction.commandName];
  if (!handler) {
    await interaction.reply({
      content: forDiscord(say("command.noHandler", { command: interaction.commandName })),
      ...EPHEMERAL,
    });
    return;
  }
  // Discord voids an interaction unanswered for three seconds; reading the index can take longer.
  await interaction.deferReply(replyIsContent(interaction.commandName) ? {} : EPHEMERAL);
  try {
    await handler(bridge, interaction);
  } catch (error) {
    // Once deferred, an unanswered command sits on "thinking" until Discord gives up on it.
    console.error(`/${interaction.commandName} failed`, error);
    await interaction
      .editReply(forDiscord(say("command.failed", { command: interaction.commandName, error: shownError(error) })))
      .catch(() => undefined);
  }
}

type Press = StringSelectMenuInteraction | ModalSubmitInteraction | ButtonInteraction;

// A press that fails is answered as a command that fails is: left to reject, its control stays live over work half done and nobody is told.
async function pressed(bridge: Bridge, interaction: Press): Promise<void> {
  try {
    if (interaction.isStringSelectMenu()) await handleSelect(bridge, interaction);
    else if (interaction.isModalSubmit()) await handleModal(bridge, interaction);
    else await handleButton(bridge, interaction);
  } catch (error) {
    console.error(`the press on ${interaction.customId} failed`, error);
    await respondQuietly(interaction, bridge.language.say("command.pressFailed", { error: shownError(error) })).catch(
      () => undefined,
    );
  }
}
