import { ChannelType, type CategoryChannel, type Guild } from "discord.js";

export const MAX_CATEGORY_NAME = 100;
// Discord refuses a 51st channel in a category, and the error it gives says nothing useful.
export const CHANNELS_PER_CATEGORY = 50;

export interface NamedCategory {
  id: string;
  name: string;
}

// Categories keep their case and spaces, unlike channel names, so only surrounding space is trimmed.
export function normaliseCategoryName(input: string): string {
  return input.trim().slice(0, MAX_CATEGORY_NAME);
}

export function findCategory(categories: NamedCategory[], name: string): NamedCategory | null {
  const wanted = normaliseCategoryName(name).toLowerCase();
  if (!wanted) return null;
  return categories.find((category) => category.name.toLowerCase() === wanted) ?? null;
}

export function describeCategoryFull(name: string): string {
  return (
    `**${name}** already holds ${CHANNELS_PER_CATEGORY} channels, which is all Discord allows. ` +
    `Use another category, or move something out of that one first.`
  );
}

export async function resolveCategory(guild: Guild, name: string): Promise<CategoryChannel> {
  const wanted = normaliseCategoryName(name);
  const existing = guild.channels.cache.filter(
    (channel) => channel.type === ChannelType.GuildCategory,
  );

  const match = findCategory(
    existing.map((channel) => ({ id: channel.id, name: channel.name })),
    wanted,
  );
  if (match) return (await guild.channels.fetch(match.id)) as CategoryChannel;

  return await guild.channels.create({ name: wanted, type: ChannelType.GuildCategory });
}

export function categoryIsFull(guild: Guild, categoryId: string): boolean {
  const used = guild.channels.cache.filter((channel) => channel.parentId === categoryId).size;
  return used >= CHANNELS_PER_CATEGORY;
}
