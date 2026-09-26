import { MessageFlags, type ChatInputCommandInteraction, type Interaction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { canRunCommand, describeOwnersOnly } from "../../access.ts";
import { errorMessage } from "../../text.ts";
import { isFromGuild } from "../gate.ts";
import { tierOf } from "../policy.ts";
import { handleAsk } from "../commands/ask.ts";
import { handleCategory } from "../commands/category.ts";
import { handleQueue, handleStop, handleTakeover, handleUnbind } from "../commands/control.ts";
import { handleClear } from "../commands/clear.ts";
import { handleCreate, handleFork, handleResume } from "../commands/conversations.ts";
import { handleInvite, handleMembers, handleUninvite } from "../commands/membership.ts";
import { handleOperator } from "../commands/operators.ts";
import { handleAutocomplete, handleSessions } from "../commands/sessions.ts";
import { handleSetting, handleWhoami } from "../commands/settings.ts";
import { handleSync } from "../commands/sync.ts";
import { handleSpend } from "../commands/spend.ts";
import {
  handleButton,
  handleModal,
  handlePluginsCommand,
  handlePurgeCommand,
  handleSelect,
  handleSkillsCommand,
} from "./components.ts";

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
  operator: handleOperator,
  invite: handleInvite,
  uninvite: handleUninvite,
  members: handleMembers,
  takeover: handleTakeover,
};

export async function handleInteraction(bridge: Bridge, interaction: Interaction): Promise<void> {
  if (!isFromGuild(bridge.config, interaction.guildId, interaction.user.bot)) return;
  if (!interaction.channelId) return;

  const tier = tierOf(bridge, interaction.user.id);
  if (tier === "none") {
    // A deliberate click deserves an answer; a message does not, or a stranger could make it post.
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: "You do not have access to this bridge. An owner has to give it to you.",
        ...EPHEMERAL,
      });
    }
    return;
  }

  if (interaction.isAutocomplete()) return await handleAutocomplete(bridge, interaction);
  if (interaction.isStringSelectMenu()) return await handleSelect(bridge, interaction);
  if (interaction.isModalSubmit()) return await handleModal(bridge, interaction);
  if (interaction.isButton()) return await handleButton(bridge, interaction);
  if (!interaction.isChatInputCommand()) return;

  if (!canRunCommand(tier, interaction.commandName)) {
    await interaction.reply(describeOwnersOnly(interaction.commandName));
    return;
  }

  const handler = COMMANDS[interaction.commandName];
  if (!handler) {
    await interaction.reply(
      `\`/${interaction.commandName}\` is registered with Discord but this bridge has no handler ` +
        `for it. Restart the bridge to re-register its commands.`,
    );
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
      .editReply(
        `\`/${interaction.commandName}\` failed: ${errorMessage(error)}. ` +
          "Try it again; if it keeps failing, the bridge log on the host has the details.",
      )
      .catch(() => undefined);
  }
}
