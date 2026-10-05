import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import type { ModelChoice } from "../../claude/models.ts";
import { CHOICES, CHOICE_CHARS } from "../limits.ts";
import { choicesForDiscord } from "../outgoing.ts";
import { truncate } from "../../text.ts";
import type { Conversation } from "../../conversations.ts";
import { requireConversation } from "../binding.ts";
import type { ContextStanding } from "../../claude/contextTracker.ts";
import { describeDefault, readHostDefaults, type HostDefaults } from "../../claude/hostSettings.ts";
import { displayPath } from "../../displayPath.ts";
import type { Say } from "../../i18n/index.ts";
import { detail } from "../embeds.ts";
import type { ClaudeVersions } from "../../claude/versions.ts";
import { respond } from "../respond.ts";

export const EFFORT_CHOICES = ["low", "medium", "high", "xhigh", "max"] as const;

// The footer names the Claude Code turns run on, and the host's when that is another build; a newer bridge that has been tagged is named beside the running one.
export function versionsFooter(say: Say, build: string, versions: ClaudeVersions, newer: string | null): string {
  const running = say("whoami.version", { version: build });
  const bridge = newer ? `${running} · ${say("whoami.newerVersion", { version: newer })}` : running;
  if (!versions.bundled) return bridge;
  const claude =
    versions.host && versions.host !== versions.bundled
      ? say("whoami.claudeDiffers", { bundled: versions.bundled, host: versions.host })
      : say("whoami.claude", { bundled: versions.bundled });
  return `${bridge} · ${claude}`;
}

export function describeContext(say: Say, standing: ContextStanding | null): string {
  if (!standing) return say("whoami.contextUnmeasured");
  const ceiling = say("units.kiloTokens", { thousands: String(Math.round(standing.ceilingTokens / 1000)) });
  return say("whoami.contextStanding", { percent: standing.percent, ceiling });
}

function bindingEmbed(
  say: Say,
  conversation: Conversation,
  defaults: HostDefaults,
  context: ContextStanding | null,
  build: string,
  versions: ClaudeVersions,
  newer: string | null,
) {
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
      { name: say("whoami.context"), value: describeContext(say, context) },
    ],
  ).setFooter({ text: versionsFooter(say, build, versions, newer) });
}

export async function handleWhoami(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;
  const defaults = await readHostDefaults(conversation.cwd);
  const context = bridge.contextOf(conversation.sessionId);
  const embed = bindingEmbed(
    bridge.language.say,
    conversation,
    defaults,
    context,
    bridge.build,
    bridge.claude,
    bridge.updates.newer(),
  );
  await respond(interaction, { embeds: [embed] });
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
        ? say("settings.current", { setting: say(`whoami.${key}`), value: current })
        : say("settings.notOverridden", {
            setting: say(`whoami.${key}`),
            fallback: describeDefault(say, undefined, (await readHostDefaults(conversation.cwd))[key]),
          }),
    );
    return;
  }

  // A suggestion is only that: whatever was typed arrives here, and a name Claude Code does not know would fail every turn after it.
  if (key === "model" && !bridge.models.offers(value)) {
    const offered = bridge.models.choices().map((model) => `\`${model.value}\``);
    await respond(interaction, say("settings.unknownModel", { value, offered: offered.join(", ") }));
    return;
  }

  await bridge.store.updateSettings(conversation.sessionId, { [key]: value });
  await respond(interaction, say("settings.changed", { setting: say(`whoami.${key}`), value }));
}

const describedChoice = (model: ModelChoice): string => (model.description ? `${model.name} · ${model.description}` : model.name);

// The list is Claude Code's own, so a model it gains or drops shows here without a release of the bridge.
export async function suggestModels(bridge: Bridge, interaction: AutocompleteInteraction): Promise<void> {
  const typed = interaction.options.getFocused().toLowerCase();
  const matching = bridge.models.choices().filter((model) => `${model.value} ${model.name}`.toLowerCase().includes(typed));
  const choices = matching
    .slice(0, CHOICES)
    .map((model) => ({ name: truncate(describedChoice(model), CHOICE_CHARS), value: model.value }));
  await interaction.respond(choicesForDiscord(choices));
}
