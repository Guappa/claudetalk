import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Bridge } from "../../bridge.ts";
import {
  describeSkillMenus,
  listPlugins,
  menuPlaceholder,
  pluginSelectOptions,
  setPluginEnabled,
  skillSelectMenus,
} from "../../claude/pluginCatalog.ts";
import {
  PLUGIN_SELECT,
  PURGE_CANCEL,
  PURGE_CONFIRM,
  parseCustomId,
  pluginToggleId,
  questionOtherId,
  skillSelectId,
  type MenuAction,
} from "../menus.ts";
import { OTHER_VALUE } from "../questions.ts";
import { describePurge, purgeChannel } from "../purge.ts";
import { openConversation, startConversation } from "../commands/conversations.ts";
import { channelSink } from "../sink.ts";
import { runConversationTurn } from "../turn.ts";
import { requireConversation } from "../binding.ts";
import { acknowledgeQuietly, respond, respondQuietly, settleMenu } from "../respond.ts";
import { describeStop } from "../turnFlow.ts";
import { canRunCommand, describeOwnersOnly } from "../../access.ts";
import { tierOf } from "../policy.ts";
import { hasWorkingDir } from "../../sessions/index.ts";
import { count, errorMessage } from "../../text.ts";

type Action<K extends MenuAction["kind"]> = Extract<MenuAction, { kind: K }>;

const OWNERS_ONLY = describeOwnersOnly("plugins");
const NOT_DELETABLE =
  "`/purge` only works in a server text channel where the bot can manage messages. " +
  "Run it in the conversation's channel, or give the bot Manage Messages here.";
const STALE = "That control is from before a restart, so it no longer works. Run the command again for a fresh one.";

export async function handlePluginsCommand(
  _bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const plugins = await listPlugins();
  if (plugins.length === 0) {
    await respond(
      interaction,
      "No plugins reported by `claude plugin list --json`. If you expected some, check that Claude Code is on PATH for this process.",
    );
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(PLUGIN_SELECT)
    .setPlaceholder("Choose a plugin")
    .addOptions(pluginSelectOptions(plugins));

  await respond(interaction, {
    content: `${count(plugins.length, "plugin")} installed, ${plugins.filter((plugin) => plugin.enabled).length} enabled.`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

export async function handleSkillsCommand(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const skills = bridge.capabilities.skills(conversation.sessionId);
  if (skills.length === 0) {
    await respond(
      interaction,
      "No skills known for this conversation yet. Send it a message first, then try again: the list comes from the session itself.",
    );
    return;
  }

  const menus = skillSelectMenus(skills);
  const rows = menus.pages.map((page, index) =>
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(skillSelectId(index))
        .setPlaceholder(menuPlaceholder(page))
        .addOptions(page),
    ),
  );

  await respond(interaction, { content: describeSkillMenus(skills.length, menus), components: rows });
}

// A mention-only or unbound channel is not a view of a conversation, so /sync does not apply.
function isConversationChannel(bridge: Bridge, channelId: string): boolean {
  const conversation = bridge.store.byChannel(channelId);
  return conversation !== undefined && !conversation.mentionOnly;
}

export async function handlePurgeCommand(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.channel || !("bulkDelete" in interaction.channel)) {
    await respond(interaction, NOT_DELETABLE);
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PURGE_CONFIRM).setLabel("Delete them").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(PURGE_CANCEL).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

  const lines = ["This deletes every message in this channel, including yours. It cannot be undone."];
  if (isConversationChannel(bridge, interaction.channelId)) {
    lines.push("", "The conversation on the host is not touched, and `/sync` repopulates the channel afterwards.");
  }

  await respond(interaction, { content: lines.join("\n"), components: [row] });
}

async function choosePlugin(bridge: Bridge, interaction: StringSelectMenuInteraction, action: Action<"plugin-chosen">) {
  if (!canRunCommand(tierOf(bridge, interaction.user.id), "plugins")) {
    await settleMenu(interaction, OWNERS_ONLY);
    return;
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(pluginToggleId(action.id, true)).setLabel("Enable").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(pluginToggleId(action.id, false)).setLabel("Disable").setStyle(ButtonStyle.Danger),
  );
  await settleMenu(interaction, `\`${action.id}\``, [row]);
}

async function runSkill(bridge: Bridge, interaction: StringSelectMenuInteraction, action: Action<"skill-chosen">) {
  const conversation = bridge.store.byChannel(interaction.channelId);
  if (!conversation || !interaction.channel?.isSendable()) {
    await settleMenu(
      interaction,
      "This channel is no longer bound to a conversation. Run `/resume` to bind it again, then `/skills`.",
    );
    return;
  }
  await settleMenu(interaction, `Running \`/${action.skill}\``);
  await runConversationTurn(bridge, conversation, {
    actorId: interaction.user.id,
    prompt: `/${action.skill}`,
    sink: channelSink(interaction.channel, { latestPosts: bridge.latestPosts }),
    resume: true,
  });
}

const OTHER_ANSWER_FIELD = "answer";

function otherAnswerModal(action: Action<"question-pick">): ModalBuilder {
  const field = new TextInputBuilder()
    .setCustomId(OTHER_ANSWER_FIELD)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);
  return new ModalBuilder()
    .setCustomId(questionOtherId(action.askId, action.index))
    .setTitle(`Your own answer to question ${action.index + 1}`)
    .addLabelComponents(new LabelBuilder().setLabel("Answer").setTextInputComponent(field));
}

// A pick is kept, not sent: the message keeps its menus until Submit, so a choice can still change.
async function pickAnswer(bridge: Bridge, interaction: StringSelectMenuInteraction, action: Action<"question-pick">) {
  const complaint = bridge.questions.pick(action.askId, action.index, interaction.values);
  if (complaint) {
    await respondQuietly(interaction, complaint);
    return;
  }
  if (interaction.values.includes(OTHER_VALUE)) {
    await interaction.showModal(otherAnswerModal(action));
    return;
  }
  await interaction.deferUpdate();
}

async function answerInOwnWords(bridge: Bridge, interaction: ModalSubmitInteraction, action: Action<"question-other">) {
  const text = interaction.fields.getTextInputValue(OTHER_ANSWER_FIELD);
  const complaint = bridge.questions.answerFreeText(action.askId, action.index, text);
  if (complaint) {
    await respondQuietly(interaction, complaint);
    return;
  }
  await interaction.deferUpdate();
}

async function submitAnswers(bridge: Bridge, interaction: ButtonInteraction, action: Action<"question-submit">) {
  const complaint = bridge.questions.submit(action.askId);
  if (complaint) {
    await respondQuietly(interaction, complaint);
    return;
  }
  await interaction.deferUpdate();
}

async function skipQuestions(bridge: Bridge, interaction: ButtonInteraction, action: Action<"question-skip">) {
  const complaint = bridge.questions.skip(action.askId);
  if (complaint) {
    await respondQuietly(interaction, complaint);
    return;
  }
  await interaction.deferUpdate();
}

export async function handleSelect(bridge: Bridge, interaction: StringSelectMenuInteraction): Promise<void> {
  const action = parseCustomId(interaction.customId, interaction.values[0]);
  switch (action.kind) {
    case "plugin-chosen":
      return await choosePlugin(bridge, interaction, action);
    case "skill-chosen":
      return await runSkill(bridge, interaction, action);
    case "question-pick":
      return await pickAnswer(bridge, interaction, action);
    default:
      return await settleMenu(interaction, STALE);
  }
}

export async function handleModal(bridge: Bridge, interaction: ModalSubmitInteraction): Promise<void> {
  const action = parseCustomId(interaction.customId);
  if (action.kind === "question-other") return await answerInOwnWords(bridge, interaction, action);
  await respondQuietly(interaction, STALE);
}

async function decideApproval(bridge: Bridge, interaction: ButtonInteraction, action: Action<"approval">) {
  await respondQuietly(interaction, bridge.approvals.decide(action.id, interaction.user.id, action.choice));
}

async function stopTurn(bridge: Bridge, interaction: ButtonInteraction, action: Action<"turn-stop">) {
  await acknowledgeQuietly(interaction);
  await respondQuietly(interaction, describeStop(bridge.flow.stop(action.sessionId)));
}

async function cancelPurge(_bridge: Bridge, interaction: ButtonInteraction) {
  await settleMenu(interaction, "Left the channel alone.");
}

async function confirmPurge(bridge: Bridge, interaction: ButtonInteraction) {
  const channel = interaction.channel;
  if (!channel || !("bulkDelete" in channel)) {
    await settleMenu(interaction, NOT_DELETABLE);
    return;
  }
  await settleMenu(interaction, "Deleting...");
  try {
    const result = await purgeChannel(channel, interaction.message.id);
    await settleMenu(interaction, describePurge(result, isConversationChannel(bridge, interaction.channelId)));
  } catch (error) {
    await settleMenu(interaction, `The purge stopped partway: ${errorMessage(error)}. Run \`/purge\` again to finish.`);
  }
}

async function cancelCreate(bridge: Bridge, interaction: ButtonInteraction) {
  bridge.pendingCreates.take(interaction.message.id);
  await settleMenu(interaction, "Left it alone. Nothing was created.");
}

async function createNew(bridge: Bridge, interaction: ButtonInteraction) {
  const request = bridge.pendingCreates.take(interaction.message.id);
  if (!request) {
    await settleMenu(interaction, "That `/create` is too old to act on now. Run it again.");
    return;
  }
  await interaction.deferUpdate();
  await startConversation(bridge, interaction, request);
}

async function createResume(bridge: Bridge, interaction: ButtonInteraction, action: Action<"create-resume">) {
  bridge.pendingCreates.take(interaction.message.id);
  await interaction.deferUpdate();

  const record = await bridge.sessions.find(action.sessionId);
  if (!record || !hasWorkingDir(record)) {
    await settleMenu(
      interaction,
      "That conversation is no longer on the host: its transcript was removed or moved. Run `/create` again to start a fresh one.",
    );
    return;
  }
  await openConversation(bridge, interaction, record);
}

async function keepUnboundChannel(_bridge: Bridge, interaction: ButtonInteraction) {
  await settleMenu(interaction, "Kept. The channel stays as it is, with its history.");
}

// The reply lives in the channel being deleted, so it may be gone before it can be edited.
async function deleteUnboundChannel(bridge: Bridge, interaction: ButtonInteraction) {
  if (!canRunCommand(tierOf(bridge, interaction.user.id), "unbind")) {
    await settleMenu(interaction, describeOwnersOnly("unbind"));
    return;
  }
  const channel = interaction.channel;
  if (!channel || channel.isDMBased()) {
    await settleMenu(interaction, "This channel cannot be deleted from here. Remove it in Discord's channel settings.");
    return;
  }
  await settleMenu(interaction, "Deleting the channel...");
  try {
    await channel.delete();
  } catch (error) {
    await settleMenu(
      interaction,
      `Could not delete the channel: ${errorMessage(error)}. The bot needs Manage Channels; remove it in Discord's channel settings instead.`,
    ).catch(() => undefined);
  }
}

async function togglePlugin(bridge: Bridge, interaction: ButtonInteraction, action: Action<"plugin-toggle">) {
  // The menu is owner-only, and a button is checked on its own rather than trusting who could see the menu.
  if (!canRunCommand(tierOf(bridge, interaction.user.id), "plugins")) {
    await settleMenu(interaction, OWNERS_ONLY);
    return;
  }
  await interaction.deferUpdate();
  try {
    await settleMenu(interaction, await setPluginEnabled(action.id, action.enable));
  } catch (error) {
    await settleMenu(
      interaction,
      `Could not ${action.enable ? "enable" : "disable"} \`${action.id}\`: ${errorMessage(error)}. ` +
        "Run the same command on the host to see the full output.",
    );
  }
}

export async function handleButton(bridge: Bridge, interaction: ButtonInteraction): Promise<void> {
  const action = parseCustomId(interaction.customId);
  switch (action.kind) {
    case "approval":
      return await decideApproval(bridge, interaction, action);
    case "turn-stop":
      return await stopTurn(bridge, interaction, action);
    case "purge-cancel":
      return await cancelPurge(bridge, interaction);
    case "purge-confirm":
      return await confirmPurge(bridge, interaction);
    case "create-cancel":
      return await cancelCreate(bridge, interaction);
    case "create-new":
      return await createNew(bridge, interaction);
    case "create-resume":
      return await createResume(bridge, interaction, action);
    case "unbind-keep":
      return await keepUnboundChannel(bridge, interaction);
    case "unbind-delete":
      return await deleteUnboundChannel(bridge, interaction);
    case "question-submit":
      return await submitAnswers(bridge, interaction, action);
    case "question-skip":
      return await skipQuestions(bridge, interaction, action);
    case "plugin-toggle":
      return await togglePlugin(bridge, interaction, action);
    default:
      return await settleMenu(interaction, STALE);
  }
}
