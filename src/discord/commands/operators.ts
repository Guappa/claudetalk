import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { detail } from "../embeds.ts";
import { respond } from "../respond.ts";
import { NO_MENTIONS } from "../sink.ts";

export async function handleOperator(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const action = interaction.options.getSubcommand();

  if (action === "list") {
    const operators = bridge.operators.all();
    await respond(interaction, {
      embeds: [
        detail("Who may use this bridge", "Owners are set on the host and cannot be changed here.", [
          { name: "Owners", value: bridge.config.ownerIds.map((id) => `<@${id}>`).join("\n") },
          {
            name: "Operators",
            value: operators.length > 0 ? operators.map((id) => `<@${id}>`).join("\n") : "nobody",
          },
        ]),
      ],
      allowedMentions: NO_MENTIONS,
    });
    return;
  }

  const user = interaction.options.getUser("user", true);
  if (user.bot) {
    await respond(interaction, "Bots cannot be operators; pick a person.");
    return;
  }
  if (bridge.config.ownerIds.includes(user.id)) {
    await respond(
      interaction,
      `${user.username} is an owner, set in \`DISCORD_OWNER_IDS\` on the host. That is above ` +
        "operator and cannot be changed from Discord.",
    );
    return;
  }

  if (action === "add") {
    const added = await bridge.operators.add(user.id);
    await respond(
      interaction,
      added
        ? `${user.username} is an operator from now. **They can run anything on this machine**, ` +
            "as the host user, with its credentials and its Claude plan."
        : `${user.username} is already an operator.`,
    );
    return;
  }

  const removed = await bridge.operators.remove(user.id);
  await respond(
    interaction,
    removed
      ? `${user.username} is no longer an operator. Conversations they already started stay bound.`
      : `${user.username} is not an operator.`,
  );
}
