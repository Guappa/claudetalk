import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import type { Conversation } from "../../conversations.ts";
import { requireConversation } from "../binding.ts";
import { describeDefault, readHostDefaults, type HostDefaults } from "../../claude/hostSettings.ts";
import { displayPath } from "../../displayPath.ts";
import type { Say } from "../../i18n/index.ts";
import { detail } from "../embeds.ts";
import { bridgeVersion } from "../../version.ts";
import { respond } from "../respond.ts";

export const MODEL_CHOICES = ["fable", "opus", "sonnet", "haiku"] as const;
export const EFFORT_CHOICES = ["low", "medium", "high", "xhigh", "max"] as const;

const BRIDGE_OWNED = new Set(["model", "effort", "fallback-model", "autocompact", "agent"]);
// What each would do typed as a message differs from what it does in a terminal, so each has its own explanation.
const AMBIGUOUS = { clear: "typed.clear" } as const;
type Ambiguous = keyof typeof AMBIGUOUS;
type Caution = "typed.billedReview";
// In a terminal these ask before they act; typed here they would act on their flags alone.
const ASKS_FIRST: ReadonlyArray<{ commands: string[]; when: RegExp; caution: Caution }> = [
  { commands: ["code-review", "review"], when: /(?:^|\s)ultra(?:\s|$)/i, caution: "typed.billedReview" },
  { commands: ["ultrareview"], when: /^/, caution: "typed.billedReview" },
];
const COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)(?:\s|$)/i;

export type PromptKind =
  | { kind: "turn" }
  | { kind: "passthrough"; command: string }
  | { kind: "terminal-only"; command: string }
  | { kind: "bridge-owned"; command: string }
  | { kind: "ambiguous"; command: Ambiguous }
  | { kind: "asks-first"; command: string; args: string; caution: Caution };

export type NotRunAsTyped = Exclude<PromptKind, { kind: "turn" | "passthrough" }>;

export function classifyPrompt(content: string, terminalOnly: string[]): PromptKind {
  const command = COMMAND_PATTERN.exec(content.trim())?.[1]?.toLowerCase();
  if (!command) return { kind: "turn" };

  if (Object.hasOwn(AMBIGUOUS, command)) return { kind: "ambiguous", command: command as Ambiguous };
  if (BRIDGE_OWNED.has(command)) return { kind: "bridge-owned", command };
  if (terminalOnly.includes(command)) return { kind: "terminal-only", command };

  const args = content.trim().slice(command.length + 1).trim();
  const guarded = ASKS_FIRST.find((entry) => entry.commands.includes(command) && entry.when.test(args));
  if (guarded) return { kind: "asks-first", command, args, caution: guarded.caution };

  return { kind: "passthrough", command };
}

// Why a command typed as a message was not passed on, and what to use in its place.
export function describeNotRun(say: Say, typed: NotRunAsTyped): string {
  switch (typed.kind) {
    case "ambiguous":
      return say(AMBIGUOUS[typed.command]);
    case "bridge-owned":
      return say("typed.bridgeOwned", { command: typed.command });
    case "terminal-only":
      return say("typed.terminalOnly", { command: typed.command });
    case "asks-first":
      return describeAsksFirst(say, typed);
  }
}

// Written for someone used to the terminal, where typing the command is the whole of it.
function describeAsksFirst(say: Say, asked: Extract<PromptKind, { kind: "asks-first" }>): string {
  const { command, args } = asked;
  return say("typed.asksFirst", {
    typed: args ? `/${command} ${args}` : `/${command}`,
    caution: say(asked.caution),
    viaRun: args ? `/run command:${command} args:${args}` : `/run command:${command}`,
  });
}

function bindingEmbed(say: Say, conversation: Conversation, defaults: HostDefaults) {
  return detail(
    say("whoami.title"),
    `${say("whoami.resumeHint")}
\`\`\`
claude --resume ${conversation.sessionId}
\`\`\``,
    [
      { name: say("whoami.directory"), value: `\`${displayPath(conversation.cwd)}\`` },
      { name: say("whoami.model"), value: describeDefault(say, conversation.settings.model, defaults.model), inline: true },
      { name: say("whoami.effort"), value: describeDefault(say, conversation.settings.effort, defaults.effort), inline: true },
    ],
  ).setFooter({ text: `bridge v${bridgeVersion()}` });
}

export async function handleWhoami(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;
  await respond(interaction, { embeds: [bindingEmbed(bridge.language.say, conversation, await readHostDefaults())] });
}

export async function handleSetting(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
  key: "model" | "effort",
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const say = bridge.language.say;
  const value = interaction.options.getString("value");
  if (!value) {
    const current = conversation.settings[key];
    await respond(
      interaction,
      current
        ? say("settings.current", { setting: key, value: current })
        : say("settings.notOverridden", {
            setting: key,
            fallback: describeDefault(say, undefined, (await readHostDefaults())[key]),
          }),
    );
    return;
  }

  await bridge.store.updateSettings(conversation.sessionId, { [key]: value });
  await respond(interaction, say("settings.changed", { setting: key, value }));
}
