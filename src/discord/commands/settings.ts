import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import type { Conversation } from "../../conversations.ts";
import { requireConversation } from "../binding.ts";
import { describeDefault, readHostDefaults, type HostDefaults } from "../../claude/hostSettings.ts";
import { displayPath } from "../../displayPath.ts";
import type { Say } from "../../i18n/index.ts";
import { detail } from "../embeds.ts";
import type { ClaudeVersions } from "../../claude/versions.ts";
import { respond } from "../respond.ts";

export const MODEL_CHOICES = ["fable", "opus", "sonnet", "haiku"] as const;
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

function bindingEmbed(
  say: Say,
  conversation: Conversation,
  defaults: HostDefaults,
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
    ],
  ).setFooter({ text: versionsFooter(say, build, versions, newer) });
}

export async function handleWhoami(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;
  const defaults = await readHostDefaults(conversation.cwd);
  const embed = bindingEmbed(bridge.language.say, conversation, defaults, bridge.build, bridge.claude, bridge.updates.newer());
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

  await bridge.store.updateSettings(conversation.sessionId, { [key]: value });
  await respond(interaction, say("settings.changed", { setting: say(`whoami.${key}`), value }));
}
