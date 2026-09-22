import { claudeCli, parseJsonArray } from "./cli.ts";
import { count } from "../text.ts";

const DISCORD_LABEL_LIMIT = 100;
const DISCORD_PLACEHOLDER_LIMIT = 150;
const DISCORD_OPTION_LIMIT = 25;
// Five rows of one menu each is all a message holds, so 125 skills is where the picker runs out.
export const DISCORD_MENUS_PER_MESSAGE = 5;

export interface PluginRecord {
  id: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
}

export interface SelectOption {
  label: string;
  value: string;
  description: string;
}

export interface SkillMenus {
  pages: SelectOption[][];
  omitted: number;
}

function isPluginRecord(item: unknown): item is PluginRecord {
  const record = item as Partial<PluginRecord> | null;
  return typeof record?.id === "string" && typeof record.enabled === "boolean";
}

export function parsePluginList(raw: string): PluginRecord[] {
  return parseJsonArray(raw, isPluginRecord);
}

export function pluginSelectOptions(plugins: PluginRecord[]): SelectOption[] {
  return plugins.slice(0, DISCORD_OPTION_LIMIT).map((plugin) => ({
    label: plugin.id.slice(0, DISCORD_LABEL_LIMIT),
    value: plugin.id.slice(0, DISCORD_LABEL_LIMIT),
    description: `${plugin.version} · ${plugin.enabled ? "enabled" : "disabled"}`,
  }));
}

function skillOption(skill: string): SelectOption {
  return {
    label: skill.slice(0, DISCORD_LABEL_LIMIT),
    value: skill.slice(0, DISCORD_LABEL_LIMIT),
    description: `Run /${skill}`.slice(0, DISCORD_LABEL_LIMIT),
  };
}

// Sorted so the page a skill lands on is predictable, and cut where Discord stops accepting menus.
export function skillSelectMenus(skills: string[]): SkillMenus {
  const sorted = [...skills].sort((left, right) => left.localeCompare(right));
  const pages: SelectOption[][] = [];
  for (let start = 0; start < sorted.length && pages.length < DISCORD_MENUS_PER_MESSAGE; start += DISCORD_OPTION_LIMIT) {
    pages.push(sorted.slice(start, start + DISCORD_OPTION_LIMIT).map(skillOption));
  }
  const shown = pages.reduce((total, page) => total + page.length, 0);
  return { pages, omitted: sorted.length - shown };
}

export function menuPlaceholder(page: SelectOption[]): string {
  const first = page[0]?.label ?? "";
  const last = page.at(-1)?.label ?? "";
  return (page.length > 1 ? `${first} to ${last}` : first).slice(0, DISCORD_PLACEHOLDER_LIMIT);
}

export function describeSkillMenus(total: number, menus: SkillMenus): string {
  const spread = menus.pages.length > 1 ? `, A to Z across ${menus.pages.length} menus` : "";
  const rest =
    menus.omitted === 0
      ? ""
      : ` The last ${menus.omitted} did not fit; send \`/name\` as a message to run one of those.`;
  return `${count(total, "skill")} available in this conversation${spread}.${rest}`;
}

export async function listPlugins(): Promise<PluginRecord[]> {
  try {
    return parsePluginList((await claudeCli(["plugin", "list", "--json"])).stdout);
  } catch {
    return [];
  }
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<string> {
  const { stdout, stderr } = await claudeCli(["plugin", enabled ? "enable" : "disable", id]);
  return (stdout || stderr).trim() || `${enabled ? "Enabled" : "Disabled"} ${id}.`;
}
