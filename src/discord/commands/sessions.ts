import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { describeHidden, formatSessionList, newestPerName, sessionChoice, withoutScratch } from "./sessionList.ts";
import { displayName } from "../../sessions/displayName.ts";
import { detail } from "../embeds.ts";
import { respond } from "../respond.ts";

const AUTOCOMPLETE_LIMIT = 25;

export async function handleAutocomplete(
  bridge: Bridge,
  interaction: AutocompleteInteraction,
): Promise<void> {
  const typed = interaction.options.getFocused().toLowerCase();
  const index = await bridge.sessions.build();
  const pool = typed ? index : withoutScratch(index).shown;
  // An id is how you reach past the newest one, so it is searchable as well as the name.
  const matching = pool.filter(
    (record) =>
      displayName(record).toLowerCase().includes(typed) || record.sessionId.toLowerCase().startsWith(typed),
  );

  const choices = newestPerName(matching)
    .slice(0, AUTOCOMPLETE_LIMIT)
    .map(([record, older]) => sessionChoice(record, older));
  await interaction.respond(choices);
}

export async function handleSessions(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const filter = interaction.options.getString("filter")?.toLowerCase() ?? "";
  const index = await bridge.sessions.build();
  const { shown, hidden } = filter
    ? { shown: index.filter((record) => displayName(record).toLowerCase().includes(filter)), hidden: 0 }
    : withoutScratch(index);
  const title = filter ? `Conversations matching "${filter}"` : "Conversations on the host";
  await respond(interaction, { embeds: [detail(title, formatSessionList(shown) + describeHidden(hidden))] });
}
