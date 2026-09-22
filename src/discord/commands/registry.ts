import { SlashCommandBuilder } from "discord.js";
import { EFFORT_CHOICES, MODEL_CHOICES } from "./settings.ts";

export function bridgeCommandDefinitions() {
  return [
    new SlashCommandBuilder()
      .setName("create")
      .setDescription("Start a new conversation bound to this channel")
      .addStringOption((option) =>
        option.setName("name").setDescription("Conversation name").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("project").setDescription("Folder name or absolute path, created if it does not exist"),
      )
      .addStringOption((option) =>
        option.setName("category").setDescription("Discord category to put the channel in, created if new"),
      ),

    new SlashCommandBuilder()
      .setName("resume")
      .setDescription("Bind this channel to an existing conversation")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Conversation name")
          .setRequired(true)
          .setAutocomplete(true),
      ),

    new SlashCommandBuilder()
      .setName("fork")
      .setDescription("Branch this conversation into a new one, leaving this one untouched")
      .addStringOption((option) =>
        option.setName("name").setDescription("Name for the branch (default: this one plus -fork)"),
      ),

    new SlashCommandBuilder()
      .setName("sessions")
      .setDescription("List conversations on the host")
      .addStringOption((option) => option.setName("filter").setDescription("Filter by name")),

    new SlashCommandBuilder().setName("whoami").setDescription("Show what this channel is bound to"),

    new SlashCommandBuilder().setName("spend").setDescription("Show turns, tokens and cost since the bridge started"),

    new SlashCommandBuilder()
      .setName("model")
      .setDescription("Show or set the model for this conversation")
      .addStringOption((option) =>
        option
          .setName("value")
          .setDescription("Model")
          .addChoices(...MODEL_CHOICES.map((model) => ({ name: model, value: model }))),
      ),

    new SlashCommandBuilder()
      .setName("effort")
      .setDescription("Show or set the effort level for this conversation")
      .addStringOption((option) =>
        option
          .setName("value")
          .setDescription("Effort")
          .addChoices(...EFFORT_CHOICES.map((effort) => ({ name: effort, value: effort }))),
      ),

    new SlashCommandBuilder()
      .setName("category")
      .setDescription("Show or set the Discord category this conversation's channel sits in")
      .addStringOption((option) =>
        option.setName("name").setDescription("Category name, created if it does not exist"),
      ),

    new SlashCommandBuilder()
      .setName("unbind")
      .setDescription("Unbind this channel; the conversation is kept on the host"),

    new SlashCommandBuilder()
      .setName("invite")
      .setDescription("Give someone access to this conversation (sandboxes it)")
      .addUserOption((option) => option.setName("user").setDescription("Who to invite").setRequired(true)),

    new SlashCommandBuilder()
      .setName("operator")
      .setDescription("Owners only: who may create and drive their own conversations")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Give someone operator access to this bridge")
          .addUserOption((option) => option.setName("user").setDescription("Who").setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Take operator access away")
          .addUserOption((option) => option.setName("user").setDescription("Who").setRequired(true)),
      )
      .addSubcommand((sub) => sub.setName("list").setDescription("Every operator, and where each comes from")),

    new SlashCommandBuilder()
      .setName("uninvite")
      .setDescription("Remove someone's access to this conversation")
      .addUserOption((option) => option.setName("user").setDescription("Who to remove").setRequired(true)),

    new SlashCommandBuilder()
      .setName("members")
      .setDescription("Who can access this conversation, and how it is sandboxed"),

    new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Ask with a chosen amount of this channel's recent history as context")
      .addStringOption((option) =>
        option.setName("prompt").setDescription("What to ask").setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName("context")
          .setDescription("How many recent channel messages to include (1-50)")
          .setMinValue(1)
          .setMaxValue(50),
      ),

    new SlashCommandBuilder()
      .setName("sync")
      .setDescription("Show what happened in this conversation outside Discord"),

    new SlashCommandBuilder()
      .setName("plugins")
      .setDescription("List Claude Code plugins and toggle one"),

    new SlashCommandBuilder()
      .setName("skills")
      .setDescription("List the skills this conversation has and run one"),

    new SlashCommandBuilder()
      .setName("purge")
      .setDescription("Delete every message in this channel; the conversation is kept"),

    new SlashCommandBuilder().setName("stop").setDescription("Stop the in-flight turn"),

    new SlashCommandBuilder()
      .setName("queue")
      .setDescription("Show what is running and queued in this conversation"),

    new SlashCommandBuilder()
      .setName("takeover")
      .setDescription("Stop a background agent holding this conversation"),
  ].map((builder) => {
    builder.setDefaultMemberPermissions(0n);
    return builder.toJSON();
  });
}
