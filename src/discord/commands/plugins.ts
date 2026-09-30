import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { listPlugins, setPluginEnabled, type PluginRecord } from "../../claude/pluginCatalog.ts";
import type { Say } from "../../i18n/index.ts";
import { errorMessage } from "../../text.ts";
import { MENU_OPTION_CHARS, MENU_OPTIONS } from "../limits.ts";
import { PLUGIN_SELECT, pluginToggleId, type Action } from "../menus.ts";
import { optionForDiscord } from "../outgoing.ts";
import { respond, settleMenu } from "../respond.ts";
import type { SelectOption } from "./skills.ts";

export function pluginSelectOptions(say: Say, plugins: PluginRecord[]): SelectOption[] {
  return plugins.slice(0, MENU_OPTIONS).map((plugin) => ({
    label: plugin.id.slice(0, MENU_OPTION_CHARS),
    value: plugin.id.slice(0, MENU_OPTION_CHARS),
    description: say(plugin.enabled ? "plugins.optionEnabled" : "plugins.optionDisabled", {
      version: plugin.version,
    }).slice(0, MENU_OPTION_CHARS),
  }));
}

export async function handlePluginsCommand(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const say = bridge.language.say;
  const plugins = await listPlugins();
  if (plugins.length === 0) {
    await respond(interaction, say("plugins.none"));
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(PLUGIN_SELECT)
    .setPlaceholder(say("plugins.choose"))
    .addOptions(pluginSelectOptions(say, plugins).map(optionForDiscord));

  await respond(interaction, {
    content: say("plugins.summary", {
      count: plugins.length,
      enabled: plugins.filter((plugin) => plugin.enabled).length,
    }),
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

export async function choosePlugin(bridge: Bridge, interaction: StringSelectMenuInteraction, action: Action<"plugin-chosen">) {
  const say = bridge.language.say;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pluginToggleId(action.id, true))
      .setLabel(say("plugins.enable"))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(pluginToggleId(action.id, false))
      .setLabel(say("plugins.disable"))
      .setStyle(ButtonStyle.Danger),
  );
  await settleMenu(interaction, `\`${action.id}\``, [row]);
}

export async function togglePlugin(bridge: Bridge, interaction: ButtonInteraction, action: Action<"plugin-toggle">) {
  const say = bridge.language.say;
  await interaction.deferUpdate();
  try {
    const printed = await setPluginEnabled(action.id, action.enable);
    await settleMenu(interaction, printed || say(action.enable ? "plugins.enabled" : "plugins.disabled", { id: action.id }));
  } catch (error) {
    await settleMenu(
      interaction,
      say(action.enable ? "plugins.enableFailed" : "plugins.disableFailed", { id: action.id, error: errorMessage(error) }),
    );
  }
}
