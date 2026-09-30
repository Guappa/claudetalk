import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Bridge } from "../../bridge.ts";
import type { Say } from "../../i18n/index.ts";
import { requireConversation } from "../binding.ts";
import { MENU_OPTION_CHARS, MENU_OPTIONS, MENU_PLACEHOLDER_CHARS, MENUS_PER_MESSAGE } from "../limits.ts";
import { skillSelectId, type Action } from "../menus.ts";
import { nameForDiscord, optionForDiscord } from "../outgoing.ts";
import { respond } from "../respond.ts";
import { runPressed } from "./run.ts";

export interface SelectOption {
  label: string;
  value: string;
  description: string;
}

export interface SkillMenus {
  pages: SelectOption[][];
  omitted: number;
}

function skillOption(say: Say, skill: string): SelectOption {
  return {
    label: skill.slice(0, MENU_OPTION_CHARS),
    value: skill.slice(0, MENU_OPTION_CHARS),
    description: say("skills.option", { skill }).slice(0, MENU_OPTION_CHARS),
  };
}

// Sorted so the page a skill lands on is predictable, and cut where Discord stops accepting menus.
export function skillSelectMenus(say: Say, skills: string[]): SkillMenus {
  const sorted = [...skills].sort((left, right) => left.localeCompare(right));
  const pages: SelectOption[][] = [];
  for (let start = 0; start < sorted.length && pages.length < MENUS_PER_MESSAGE; start += MENU_OPTIONS) {
    pages.push(sorted.slice(start, start + MENU_OPTIONS).map((skill) => skillOption(say, skill)));
  }
  const shown = pages.reduce((total, page) => total + page.length, 0);
  return { pages, omitted: sorted.length - shown };
}

export function menuPlaceholder(say: Say, page: SelectOption[]): string {
  const first = page[0]?.label ?? "";
  const last = page.at(-1)?.label ?? "";
  return (page.length > 1 ? say("skills.range", { first, last }) : first).slice(0, MENU_PLACEHOLDER_CHARS);
}

export function describeSkillMenus(say: Say, total: number, menus: SkillMenus): string {
  const available =
    menus.pages.length > 1
      ? say("skills.availableAcross", { count: total, menus: menus.pages.length })
      : say("skills.available", { count: total });
  return menus.omitted === 0 ? available : `${available} ${say("skills.omitted", { count: menus.omitted })}`;
}

export async function handleSkillsCommand(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const say = bridge.language.say;
  const skills = bridge.capabilities.skills(conversation.sessionId);
  if (skills.length === 0) {
    await respond(interaction, say("skills.none"));
    return;
  }

  const menus = skillSelectMenus(say, skills);
  const rows = menus.pages.map((page, index) =>
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(skillSelectId(index))
        .setPlaceholder(nameForDiscord(menuPlaceholder(say, page)))
        .addOptions(page.map(optionForDiscord)),
    ),
  );

  await respond(interaction, { content: describeSkillMenus(say, skills.length, menus), components: rows });
}

export async function runSkill(bridge: Bridge, interaction: StringSelectMenuInteraction, action: Action<"skill-chosen">) {
  await runPressed(bridge, interaction, `/${action.skill}`);
}
