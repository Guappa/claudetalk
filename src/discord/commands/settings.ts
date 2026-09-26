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
const COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)(?:\s|$)/i;

export type PromptKind =
  | { kind: "turn" }
  | { kind: "passthrough"; command: string }
  | { kind: "terminal-only"; message: string }
  | { kind: "bridge-owned"; message: string }
  | { kind: "ambiguous"; message: string };

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

  return { kind: "passthrough", command };
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
