import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { detail } from "../embeds.ts";
import { respond } from "../respond.ts";
import { NO_MENTIONS } from "../sink.ts";

export async function handleOperator(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const say = bridge.language.say;
  const action = interaction.options.getSubcommand();

  if (action === "list") {
    const operators = bridge.operators.all();
    await respond(interaction, {
      embeds: [
        detail(say("operators.title"), say("operators.ownersFixed"), [
          { name: say("operators.owners"), value: bridge.config.ownerIds.map((id) => `<@${id}>`).join("\n") },
          {
            name: say("operators.operators"),
            value: operators.length > 0 ? operators.map((id) => `<@${id}>`).join("\n") : say("common.nobody"),
          },
        ]),
      ],
      allowedMentions: NO_MENTIONS,
    });
    return;
  }

  const user = interaction.options.getUser("user", true);
  if (user.bot) {
    await respond(interaction, say("operators.bot"));
    return;
  }
  if (bridge.config.ownerIds.includes(user.id)) {
    await respond(interaction, say("operators.isOwner", { user: user.username }));
    return;
  }

  if (action === "add") {
    const added = await bridge.operators.add(user.id);
    await respond(interaction, say(added ? "operators.added" : "operators.already", { user: user.username }));
    return;
  }

  const removed = await bridge.operators.remove(user.id);
  await respond(interaction, say(removed ? "operators.removed" : "operators.notOperator", { user: user.username }));
}
