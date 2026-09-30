import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { LANGUAGES, isLanguage } from "../../i18n/index.ts";
import { respond } from "../respond.ts";

// The answer comes in the language just picked, which is the quickest proof that it took.
export async function handleLanguage(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const wanted = interaction.options.getString("value");
  if (!wanted || !isLanguage(wanted)) {
    await respond(interaction, bridge.language.say("language.current", { name: LANGUAGES[bridge.language.current()] }));
    return;
  }

  await bridge.language.choose(wanted);
  await respond(interaction, bridge.language.say("language.changed", { name: LANGUAGES[wanted] }));
}
