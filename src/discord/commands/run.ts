import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Bridge } from "../../bridge.ts";
import type { SessionCommand } from "../../claude/events.ts";
import { truncate } from "../../text.ts";
import { requireConversation } from "../binding.ts";
import { RUN_CANCEL, RUN_CONFIRM } from "../menus.ts";
import { respond, settleMenu } from "../respond.ts";
import { channelSink } from "../sink.ts";
import { runConversationTurn } from "../turn.ts";
import { classifyPrompt } from "./settings.ts";

// Discord's limits: twenty-five choices to an autocomplete, a hundred characters to a choice's label and value.
const CHOICE_LIMIT = 25;
const CHOICE_CHARS = 100;
const SHOWN_PROMPT_CHARS = 300;
const SHOWN_DESCRIPTION_CHARS = 300;
// Offered when no list is known yet; never a command name, so picking it explains itself.
const NO_LIST = "-";
const NO_LIST_YET =
  "This conversation's commands are not known yet: they are learned the first time a turn runs in its folder. " +
  "Send a message here first, then `/run` will list them as you type.";
const NAME = /^[a-z][a-z0-9-]*(?::[a-z0-9-]+)*$/i;

export interface CommandChoice {
  name: string;
  value: string;
}

// What was asked for, held until its Run button is pressed; a button's own id has no room for arguments.
export interface PendingRun {
  prompt: string;
}

function label(command: SessionCommand): string {
  const usage = command.argumentHint ? `${command.name} ${command.argumentHint}` : command.name;
  return truncate(command.description ? `${usage} · ${command.description}` : usage, CHOICE_CHARS - 3);
}

// A name that starts with what was typed beats one that contains it, which beats a match in the description.
function rank(command: SessionCommand, typed: string): number {
  const name = command.name.toLowerCase();
  if (name.startsWith(typed)) return 0;
  if (name.includes(typed) || command.aliases.some((alias) => alias.toLowerCase().startsWith(typed))) return 1;
  return command.description.toLowerCase().includes(typed) ? 2 : -1;
}

// What a plugin or a skill adds comes before what Claude Code ships with, since that is what nobody knows by heart.
export function commandChoices(commands: SessionCommand[], typed: string, runnable: (name: string) => boolean): CommandChoice[] {
  const wanted = typed.trim().toLowerCase().replace(/^\//, "");
  return commands
    .filter((command) => command.name.length <= CHOICE_CHARS && runnable(command.name))
    .map((command) => ({ command, rank: rank(command, wanted) }))
    .filter((entry) => entry.rank >= 0)
    .sort(
      (first, second) =>
        first.rank - second.rank ||
        Number(first.command.builtin) - Number(second.command.builtin) ||
        first.command.name.localeCompare(second.command.name),
    )
    .slice(0, CHOICE_LIMIT)
    .map(({ command }) => ({ name: label(command), value: command.name }));
}

// Anything the bridge would let through is offered, a command that asks first included: /run is where it gets asked.
function runnableIn(bridge: Bridge, sessionId: string): (name: string) => boolean {
  const terminalOnly = bridge.capabilities.terminalOnly(sessionId);
  return (name) => ["passthrough", "asks-first"].includes(classifyPrompt(`/${name}`, terminalOnly).kind);
}

export async function suggestCommands(bridge: Bridge, interaction: AutocompleteInteraction): Promise<void> {
  const conversation = bridge.store.byChannel(interaction.channelId);
  if (!conversation) {
    await interaction.respond([]);
    return;
  }
  const commands = bridge.capabilities.commands(conversation.cwd);
  if (commands.length === 0) {
    await interaction.respond([{ name: "No command list yet: send a message here first, then try again", value: NO_LIST }]);
    return;
  }
  await interaction.respond(
    commandChoices(commands, interaction.options.getFocused(), runnableIn(bridge, conversation.sessionId)),
  );
}

const named = (command: string) => (entry: SessionCommand) => entry.name === command || entry.aliases.includes(command);

// Null when it may run; otherwise what to tell whoever asked.
export function refusal(command: string, prompt: string, known: SessionCommand[], terminalOnly: string[]): string | null {
  if (command === NO_LIST) return NO_LIST_YET;
  if (!NAME.test(command)) {
    return `\`${truncate(command, 60)}\` is not a command name. Pick one from the list \`/run\` offers as you type.`;
  }
  const classified = classifyPrompt(prompt, terminalOnly);
  if (classified.kind === "terminal-only" || classified.kind === "bridge-owned" || classified.kind === "ambiguous") {
    return classified.message;
  }
  if (known.length > 0 && !known.some(named(command))) {
    return (
      `\`/${command}\` is not a command this conversation has. Pick one from the list \`/run\` offers as you type; ` +
      "a plugin installed since the last turn here shows up after the next one."
    );
  }
  return null;
}

// Everything someone needs to decide: the exact line, what it does, what it takes, and what it will cost if that is known.
export function describeRun(prompt: string, command: SessionCommand | undefined, caution: string | null): string {
  const lines = ["Run this in the conversation?", `\`\`\`\n${truncate(prompt, SHOWN_PROMPT_CHARS)}\n\`\`\``];
  if (command?.description) lines.push(truncate(command.description, SHOWN_DESCRIPTION_CHARS));
  if (command?.argumentHint) lines.push(`Takes: \`${command.argumentHint}\``);
  if (caution) lines.push(`**${caution}**`);
  lines.push("Nothing starts until you press Run.");
  return lines.join("\n");
}

export async function handleRun(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const conversation = await requireConversation(
    bridge,
    interaction,
    "This channel isn't bound to a conversation, so there is nothing to run a command in.",
  );
  if (!conversation) return;

  const command = interaction.options.getString("command", true).trim().replace(/^\//, "");
  const args = interaction.options.getString("args")?.trim() ?? "";
  const prompt = args ? `/${command} ${args}` : `/${command}`;
  const known = bridge.capabilities.commands(conversation.cwd);
  const terminalOnly = bridge.capabilities.terminalOnly(conversation.sessionId);

  const refused = refusal(command, prompt, known, terminalOnly);
  if (refused) {
    await respond(interaction, refused);
    return;
  }

  const classified = classifyPrompt(prompt, terminalOnly);
  const caution = classified.kind === "asks-first" ? classified.caution : null;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(RUN_CONFIRM).setLabel("Run").setStyle(caution ? ButtonStyle.Danger : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(RUN_CANCEL).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await respond(interaction, { content: describeRun(prompt, known.find(named(command)), caution), components: [row] });
  const reply = await interaction.fetchReply();
  bridge.pendingRuns.remember(reply.id, { prompt });
}

export async function cancelRun(bridge: Bridge, interaction: ButtonInteraction): Promise<void> {
  bridge.pendingRuns.take(interaction.message.id);
  await settleMenu(interaction, "Left it alone. Nothing was run.");
}

export async function confirmRun(bridge: Bridge, interaction: ButtonInteraction): Promise<void> {
  const pending = bridge.pendingRuns.take(interaction.message.id);
  if (!pending) {
    await settleMenu(interaction, "That `/run` is too old to act on now. Run it again.");
    return;
  }
  const conversation = bridge.store.byChannel(interaction.channelId);
  if (!conversation || !interaction.channel?.isSendable()) {
    await settleMenu(
      interaction,
      "This channel is no longer bound to a conversation, so there is nothing to run this in. `/resume` opens a conversation in a channel of its own.",
    );
    return;
  }
  await settleMenu(interaction, `Sent \`${truncate(pending.prompt, 200)}\` to the conversation.`);
  await runConversationTurn(bridge, conversation, {
    actorId: interaction.user.id,
    prompt: pending.prompt,
    sink: channelSink(interaction.channel, { latestPosts: bridge.latestPosts }),
    resume: true,
  });
}
