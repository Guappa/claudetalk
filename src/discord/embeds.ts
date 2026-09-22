import { EmbedBuilder } from "discord.js";

// An embed's description holds 4096 characters where a message holds 2000.
export const EMBED_DESCRIPTION_LIMIT = 4096;
export const EMBED_FIELD_LIMIT = 1024;

const BRIDGE_COLOUR = 0x5865f2;

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export function detail(title: string, description?: string, fields: EmbedField[] = []): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(BRIDGE_COLOUR).setTitle(title);
  if (description) embed.setDescription(description.slice(0, EMBED_DESCRIPTION_LIMIT));

  const usable = fields
    .filter((field) => field.value.trim())
    .map((field) => ({ ...field, value: field.value.slice(0, EMBED_FIELD_LIMIT) }));
  if (usable.length > 0) embed.addFields(usable);

  return embed;
}
