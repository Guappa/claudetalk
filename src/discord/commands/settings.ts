import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import type { Conversation } from "../../conversations.ts";
import { requireConversation } from "../binding.ts";
import { describeDefault, readHostDefaults, type HostDefaults } from "../../claude/hostSettings.ts";
import { displayPath } from "../../displayPath.ts";
import { detail } from "../embeds.ts";
import { bridgeVersion } from "../../version.ts";
import { respond } from "../respond.ts";

export const MODEL_CHOICES = ["fable", "opus", "sonnet", "haiku"] as const;
export const EFFORT_CHOICES = ["low", "medium", "high", "xhigh", "max"] as const;

const BRIDGE_OWNED = new Set(["model", "effort", "fallback-model", "autocompact", "agent"]);
const AMBIGUOUS = new Map([
  [
    "clear",
    "`/clear` typed as a message would start a session this channel cannot see. Use this bot's own " +
      "`/clear` command, which starts the conversation over in this channel, or `/purge` to delete " +
      "the channel's messages.",
  ],
]);
const BILLED_REVIEW = "It starts a cloud review, which is billed.";
// In a terminal these ask before they act; typed here they would act on their flags alone.
const ASKS_FIRST: ReadonlyArray<{ commands: string[]; when: RegExp; caution: string }> = [
  { commands: ["code-review", "review"], when: /(?:^|\s)ultra(?:\s|$)/i, caution: BILLED_REVIEW },
  { commands: ["ultrareview"], when: /^/, caution: BILLED_REVIEW },
];
const COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)(?:\s|$)/i;

export type PromptKind =
  | { kind: "turn" }
  | { kind: "passthrough"; command: string }
  | { kind: "terminal-only"; message: string }
  | { kind: "bridge-owned"; message: string }
  | { kind: "ambiguous"; message: string }
  | { kind: "asks-first"; command: string; caution: string; message: string };

export function classifyPrompt(content: string, terminalOnly: string[]): PromptKind {
  const command = COMMAND_PATTERN.exec(content.trim())?.[1]?.toLowerCase();
  if (!command) return { kind: "turn" };

  const ambiguous = AMBIGUOUS.get(command);
  if (ambiguous) return { kind: "ambiguous", message: ambiguous };

  if (BRIDGE_OWNED.has(command)) {
    return {
      kind: "bridge-owned",
      message:
        `\`/${command}\` applies to one process, and every message here runs a new one, so it would ` +
        `report success and then revert. Use this bot's own \`/${command}\` command instead, which ` +
        `stores the value for this conversation and applies it on every turn.`,
    };
  }

  if (terminalOnly.includes(command)) {
    return {
      kind: "terminal-only",
      message: `\`/${command}\` only runs in an interactive terminal. Run it on the host machine.`,
    };
  }

  const args = content.trim().slice(command.length + 1).trim();
  const guarded = ASKS_FIRST.find((entry) => entry.commands.includes(command) && entry.when.test(args));
  if (guarded) return { kind: "asks-first", command, caution: guarded.caution, message: describeAsksFirst(command, args, guarded.caution) };

  return { kind: "passthrough", command };
}

// Written for someone used to the terminal, where typing the command is the whole of it.
function describeAsksFirst(command: string, args: string, caution: string): string {
  const typed = args ? `/${command} ${args}` : `/${command}`;
  const viaRun = args ? `/run command:${command} args:${args}` : `/run command:${command}`;
  return (
    `\`${typed}\` was not run. ${caution} In a terminal Claude Code asks before it starts, but a command typed ` +
    `as a message here would start at once. Use \`${viaRun}\` instead: it shows exactly what will run and ` +
    "waits for you to press Run."
  );
}

function bindingEmbed(conversation: Conversation, defaults: HostDefaults) {
  return detail(
    "This channel",
    `Resume it on the host without going through the picker:
\`\`\`
claude --resume ${conversation.sessionId}
\`\`\``,
    [
      { name: "Directory", value: `\`${displayPath(conversation.cwd)}\`` },
      { name: "Model", value: describeDefault(conversation.settings.model, defaults.model), inline: true },
      { name: "Effort", value: describeDefault(conversation.settings.effort, defaults.effort), inline: true },
    ],
  ).setFooter({ text: `bridge v${bridgeVersion()}` });
}

export async function handleWhoami(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;
  await respond(interaction, { embeds: [bindingEmbed(conversation, await readHostDefaults())] });
}

export async function handleSetting(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
  key: "model" | "effort",
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const value = interaction.options.getString("value");
  if (!value) {
    const current = conversation.settings[key];
    await respond(
      interaction,
      current
        ? `${key} is set to \`${current}\` for this conversation.`
        : `${key} is not overridden here, so turns run with ${describeDefault(undefined, (await readHostDefaults())[key])}.`,
    );
    return;
  }

  await bridge.store.updateSettings(conversation.sessionId, { [key]: value });
  await respond(interaction, `${key} set to \`${value}\`. It applies from your next message onward.`);
}
