import { EmbedBuilder } from "discord.js";
import { forDiscord, nameForDiscord } from "./outgoing.ts";

// An embed's description holds 4096 characters where a message holds 2000.
export const EMBED_DESCRIPTION_LIMIT = 4096;
export const EMBED_FIELD_LIMIT = 1024;

const BRIDGE_COLOUR = 0x5865f2;

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

// The only place an embed is built, so that everything in one has been through the gate a message's text goes through.
export function detail(title: string, description?: string, fields: EmbedField[] = []): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(BRIDGE_COLOUR).setTitle(nameForDiscord(title));
  if (description) embed.setDescription(forDiscord(description).slice(0, EMBED_DESCRIPTION_LIMIT));

  const usable = fields
    .filter((field) => field.value.trim())
    .map((field) => ({ ...field, name: nameForDiscord(field.name), value: forDiscord(field.value).slice(0, EMBED_FIELD_LIMIT) }));
  if (usable.length > 0) embed.addFields(usable);

  return embed;
}
