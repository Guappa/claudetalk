import { ChannelType, type ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import { requireConversation } from "../binding.ts";
import {
  CHANNELS_PER_CATEGORY,
  categoryIsFull,
  describeCategoryFull,
  normaliseCategoryName,
  resolveCategory,
} from "../category.ts";
import { respond } from "../respond.ts";
import { errorMessage } from "../../text.ts";

export async function handleCategory(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const channel = interaction.channel;
  if (!interaction.guild || !channel || channel.type !== ChannelType.GuildText) {
    await respond(
      interaction,
      "Only a text channel inside a server can be moved. Run `/category` in the conversation's own channel.",
    );
    return;
  }

  const wanted = interaction.options.getString("name");
  if (!wanted) {
    const current = channel.parent?.name;
    await respond(
      interaction,
      current
        ? `This conversation sits in **${current}**.`
        : "This conversation is not in any category. Pass a name to put it in one.",
    );
    return;
  }

  try {
    const category = await resolveCategory(interaction.guild, wanted);
    if (category.id !== channel.parentId && categoryIsFull(interaction.guild, category.id)) {
      await respond(interaction, describeCategoryFull(category.name));
      return;
    }

    // Syncing to the category would replace the overwrites that keep this channel private.
    await channel.setParent(category.id, { lockPermissions: false });
    await respond(interaction, `Moved to **${category.name}**.`);
  } catch (error) {
    await respond(
      interaction,
      `Could not move it to **${normaliseCategoryName(wanted)}**: ${errorMessage(error)}. ` +
        `The bot needs Manage Channels, and a category can hold ${CHANNELS_PER_CATEGORY} channels.`,
    );
  }
}
