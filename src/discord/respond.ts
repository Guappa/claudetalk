import { MessageFlags } from "discord.js";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  InteractionEditReplyOptions,
  InteractionUpdateOptions,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";

export type Respondable = ChatInputCommandInteraction | ButtonInteraction;
type MenuInteraction = ButtonInteraction | StringSelectMenuInteraction;
type Quiet = Respondable | StringSelectMenuInteraction | ModalSubmitInteraction;

// A button press is not a command, so nothing deferred it; the ack is the reply and only the presser sees it.
export async function respondQuietly(interaction: Quiet, content: string): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

// Discord voids a press unanswered for three seconds, and killing a process tree can take longer.
export async function acknowledgeQuietly(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

// Every command is deferred by the router and every button by its handler, so a reply is always an edit.
export async function respond(
  interaction: Respondable,
  content: string | InteractionEditReplyOptions,
): Promise<void> {
  await interaction.editReply(content);
}

// A menu that has been acted on loses its controls, so nobody presses a stale one twice.
export async function settleMenu(
  interaction: MenuInteraction,
  content: string,
  components: NonNullable<InteractionUpdateOptions["components"]> = [],
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content, components });
    return;
  }
  await interaction.update({ content, components });
}
