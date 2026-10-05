import { SlashCommandBuilder } from "discord.js";
import { LANGUAGES } from "../../i18n/index.ts";
import { BACK_TO_DEFAULT, EFFORT_CHOICES } from "./settings.ts";
import { TRAIL_KINDS } from "../toolTrail.ts";
import { EVERY_KIND } from "../trailChoice.ts";

// What each kind covers, said in the menu itself, since the bare names leave a reader guessing which tools fall under each.
const TRAIL_LABELS: Record<(typeof TRAIL_KINDS)[number] | typeof EVERY_KIND, string> = {
  edits: "edits: file edits and written files, with their diffs",
  commands: "commands: shell commands (bash, PowerShell)",
  reads: "reads: file reads and searches",
  web: "web: web fetches and web searches",
  agents: "agents: agents and skills being started",
  todos: "todos: to-do list updates",
  other: "other: every other tool, MCP tools included",
  all: "all: every kind at once",
};
const TRAIL_CHOICES = [...TRAIL_KINDS, EVERY_KIND].map((kind) => ({ name: TRAIL_LABELS[kind], value: kind }));

export function bridgeCommandDefinitions() {
  return [
    new SlashCommandBuilder()
      .setName("create")
      .setDescription("Start a new conversation in a channel of its own")
      .addStringOption((option) => option.setName("name").setDescription("Conversation name").setRequired(true))
      .addStringOption((option) =>
        option.setName("project").setDescription("Folder name or absolute path, created if it does not exist"),
      )
      .addStringOption((option) =>
        option.setName("category").setDescription("Discord category to put the channel in, created if new"),
      ),

    new SlashCommandBuilder()
      .setName("resume")
      .setDescription("Open an existing conversation in a channel of its own")
      .addStringOption((option) =>
        option.setName("name").setDescription("Conversation name").setRequired(true).setAutocomplete(true),
      ),

    new SlashCommandBuilder()
      .setName("fork")
      .setDescription("Branch this conversation into a new one, leaving this one untouched")
      .addStringOption((option) => option.setName("name").setDescription("Name for the branch (default: this one plus -fork)")),

    new SlashCommandBuilder()
      .setName("sessions")
      .setDescription("List conversations on the host")
      .addStringOption((option) => option.setName("filter").setDescription("Filter by name")),

    new SlashCommandBuilder().setName("whoami").setDescription("Show what this channel is bound to"),

    new SlashCommandBuilder().setName("spend").setDescription("Show plan usage, and turns and tokens since the bridge started"),

    new SlashCommandBuilder()
      .setName("model")
      .setDescription("Show or set the model for this conversation")
      .addStringOption((option) =>
        option.setName("value").setDescription("Model, from the ones Claude Code offers on the host").setAutocomplete(true),
      ),

    new SlashCommandBuilder()
      .setName("effort")
      .setDescription("Show or set the effort level for this conversation")
      .addStringOption((option) =>
        option
          .setName("value")
          .setDescription("Effort")
          .addChoices(...[...EFFORT_CHOICES, BACK_TO_DEFAULT].map((effort) => ({ name: effort, value: effort }))),
      ),

    new SlashCommandBuilder()
      .setName("trail")
      .setDescription("Choose which tool calls the live trail shows. Alone, it says what is shown now")
      .addStringOption((option) =>
        option
          .setName("hide")
          .setDescription("Stop showing this kind of tool call in the trail")
          .addChoices(...TRAIL_CHOICES),
      )
      .addStringOption((option) =>
        option
          .setName("show")
          .setDescription("Show this kind again. Given with hide, it applies after it: hide all, show agents")
          .addChoices(...TRAIL_CHOICES),
      )
      .addBooleanOption((option) =>
        option
          .setName("everywhere")
          .setDescription("True: apply to the default for all conversations (owners). Omit: this one only"),
      )
      .addBooleanOption((option) =>
        option.setName("reset").setDescription("True: drop this conversation's own choice and follow the default again"),
      ),

    new SlashCommandBuilder()
      .setName("language")
      .setDescription("Show or set the language the bridge itself speaks; Claude's answers are not affected")
      .addStringOption((option) =>
        option
          .setName("value")
          .setDescription("Language")
          .addChoices(...Object.entries(LANGUAGES).map(([code, name]) => ({ name, value: code }))),
      ),

    new SlashCommandBuilder()
      .setName("category")
      .setDescription("Show or set the Discord category this conversation's channel sits in")
      .addStringOption((option) => option.setName("name").setDescription("Category name, created if it does not exist")),

    new SlashCommandBuilder().setName("unbind").setDescription("Unbind this channel; the conversation is kept on the host"),

    new SlashCommandBuilder()
      .setName("invite")
      .setDescription("Let someone see this conversation's channel; it does not let them use the bot")
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
      .setDescription("Stop someone seeing this conversation's channel")
      .addUserOption((option) => option.setName("user").setDescription("Who to remove").setRequired(true)),

    new SlashCommandBuilder().setName("members").setDescription("Who owns this conversation, who can see it, and where it runs"),

    new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Ask with a chosen amount of this channel's recent history as context")
      .addStringOption((option) => option.setName("prompt").setDescription("What to ask").setRequired(true))
      .addIntegerOption((option) =>
        option
          .setName("context")
          .setDescription("How many recent channel messages to include (1-50)")
          .setMinValue(1)
          .setMaxValue(50),
      ),

    new SlashCommandBuilder().setName("sync").setDescription("Show what happened in this conversation outside Discord"),

    new SlashCommandBuilder().setName("plugins").setDescription("List Claude Code plugins and toggle one"),

    new SlashCommandBuilder()
      .setName("mcp")
      .setDescription("List this conversation's MCP servers, and switch one off or on or reconnect it"),

    new SlashCommandBuilder()
      .setName("restart")
      .setDescription("Restart the bridge as soon as nothing is running, after checking that it would start"),

    new SlashCommandBuilder().setName("skills").setDescription("List the skills this conversation has and run one"),

    new SlashCommandBuilder()
      .setName("run")
      .setDescription("Run one of this conversation's commands, skills or plugin commands")
      .addStringOption((option) =>
        option
          .setName("command")
          .setDescription("Start typing to search what this conversation has")
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option.setName("args").setDescription("What to pass to the command, as you would type after it"),
      ),

    new SlashCommandBuilder().setName("purge").setDescription("Delete every message in this channel; the conversation is kept"),

    new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Start this channel over with a fresh conversation; the old one stays on the host"),

    new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Stop the in-flight turn; what is queued behind it runs next")
      .addBooleanOption((option) => option.setName("all").setDescription("Also drop everything queued behind it")),

    new SlashCommandBuilder().setName("queue").setDescription("Show what is running and queued in this conversation"),

    new SlashCommandBuilder().setName("takeover").setDescription("Stop a background agent holding this conversation"),
  ].map((builder) => {
    builder.setDefaultMemberPermissions(0n);
    return builder.toJSON();
  });
}
