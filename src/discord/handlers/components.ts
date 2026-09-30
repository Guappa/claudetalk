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
import type { Say } from "../../i18n/index.ts";
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
import { clearConversation } from "../commands/clear.ts";
import { cancelRun, confirmRun, runPressed } from "../commands/run.ts";
import { requireConversation } from "../binding.ts";
import { acknowledgeQuietly, respond, respondQuietly, settleMenu } from "../respond.ts";
import { nameForDiscord, optionForDiscord } from "../outgoing.ts";
import { describeSendNow, describeStop, describeStopAgents, describeStopTurn } from "../turnFlow.ts";
import { canRunCommand } from "../../access.ts";
import { tierOf } from "../policy.ts";
import { hasWorkingDir } from "../../sessions/index.ts";
import { errorMessage, truncate } from "../../text.ts";

type Action<K extends MenuAction["kind"]> = Extract<MenuAction, { kind: K }>;

export async function handlePluginsCommand(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const say = bridge.language.say;
  const plugins = await listPlugins();
  if (plugins.length === 0) {
    await respond(interaction, say("plugins.none"));
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(PLUGIN_SELECT)
    .setPlaceholder(say("plugins.choose"))
    .addOptions(pluginSelectOptions(say, plugins).map(optionForDiscord));

  await respond(interaction, {
    content: say("plugins.summary", {
      count: plugins.length,
      enabled: plugins.filter((plugin) => plugin.enabled).length,
    }),
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

export async function handleSkillsCommand(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  const say = bridge.language.say;
  const skills = bridge.capabilities.skills(conversation.sessionId);
  if (skills.length === 0) {
    await respond(interaction, say("skills.none"));
    return;
  }

  const menus = skillSelectMenus(say, skills);
  const rows = menus.pages.map((page, index) =>
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(skillSelectId(index))
        .setPlaceholder(nameForDiscord(menuPlaceholder(say, page)))
        .addOptions(page.map(optionForDiscord)),
    ),
  );

  await respond(interaction, { content: describeSkillMenus(say, skills.length, menus), components: rows });
}

// A mention-only or unbound channel is not a view of a conversation, so /sync does not apply.
function isConversationChannel(bridge: Bridge, channelId: string): boolean {
  const conversation = bridge.store.byChannel(channelId);
  return conversation !== undefined && !conversation.mentionOnly;
}

export async function handlePurgeCommand(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const say = bridge.language.say;
  if (!interaction.channel || !("bulkDelete" in interaction.channel)) {
    await respond(interaction, say("purge.notDeletable"));
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PURGE_CONFIRM).setLabel(say("purge.confirm")).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(PURGE_CANCEL).setLabel(say("common.cancel")).setStyle(ButtonStyle.Secondary),
  );

  const lines: string[] = [say("purge.warning")];
  if (isConversationChannel(bridge, interaction.channelId)) lines.push("", say("purge.warningConversation"));

  await respond(interaction, { content: lines.join("\n"), components: [row] });
}

// A control is checked on its own press, not on who could see the message it sits on; false once the presser has been told it is not theirs.
async function mayPress(bridge: Bridge, interaction: ButtonInteraction | StringSelectMenuInteraction, command: string) {
  if (canRunCommand(tierOf(bridge, interaction.user.id), command)) return true;
  await settleMenu(interaction, bridge.language.say("access.ownersOnly", { command }));
  return false;
}

async function choosePlugin(bridge: Bridge, interaction: StringSelectMenuInteraction, action: Action<"plugin-chosen">) {
  const say = bridge.language.say;
  if (!(await mayPress(bridge, interaction, "plugins"))) return;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pluginToggleId(action.id, true))
      .setLabel(say("plugins.enable"))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(pluginToggleId(action.id, false))
      .setLabel(say("plugins.disable"))
      .setStyle(ButtonStyle.Danger),
  );
  await settleMenu(interaction, `\`${action.id}\``, [row]);
}

async function runSkill(bridge: Bridge, interaction: StringSelectMenuInteraction, action: Action<"skill-chosen">) {
  await runPressed(bridge, interaction, `/${action.skill}`);
}

const OTHER_ANSWER_FIELD = "answer";
// Discord allows a modal's title and a field's label forty-five characters each.
const MODAL_TEXT_LIMIT = 45;

function otherAnswerModal(say: Say, action: Action<"question-pick">): ModalBuilder {
  const field = new TextInputBuilder()
    .setCustomId(OTHER_ANSWER_FIELD)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);
  return new ModalBuilder()
    .setCustomId(questionOtherId(action.askId, action.index))
    .setTitle(truncate(nameForDiscord(say("questions.ownAnswerTitle", { number: action.index + 1 })), MODAL_TEXT_LIMIT))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(truncate(nameForDiscord(say("questions.ownAnswerLabel")), MODAL_TEXT_LIMIT))
        .setTextInputComponent(field),
    );
}

// A pick is kept, not sent: the message keeps its menus until Submit, so a choice can still change.
async function pickAnswer(bridge: Bridge, interaction: StringSelectMenuInteraction, action: Action<"question-pick">) {
  const complaint = bridge.questions.pick(bridge.language.say, action.askId, action.index, interaction.values);
  if (complaint) {
    await respondQuietly(interaction, complaint);
    return;
  }
  if (interaction.values.includes(OTHER_VALUE)) {
    await interaction.showModal(otherAnswerModal(bridge.language.say, action));
    return;
  }
  await interaction.deferUpdate();
}

async function answerInOwnWords(bridge: Bridge, interaction: ModalSubmitInteraction, action: Action<"question-other">) {
  const text = interaction.fields.getTextInputValue(OTHER_ANSWER_FIELD);
  const complaint = bridge.questions.answerFreeText(bridge.language.say, action.askId, action.index, text);
  if (complaint) {
    await respondQuietly(interaction, complaint);
    return;
  }
  await interaction.deferUpdate();
}

async function submitAnswers(bridge: Bridge, interaction: ButtonInteraction, action: Action<"question-submit">) {
  const complaint = bridge.questions.submit(bridge.language.say, action.askId);
  if (complaint) {
    await respondQuietly(interaction, complaint);
    return;
  }
  await interaction.deferUpdate();
}

async function skipQuestions(bridge: Bridge, interaction: ButtonInteraction, action: Action<"question-skip">) {
  const complaint = bridge.questions.skip(bridge.language.say, action.askId);
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
      return await settleMenu(interaction, bridge.language.say("common.staleControl"));
  }
}

export async function handleModal(bridge: Bridge, interaction: ModalSubmitInteraction): Promise<void> {
  const action = parseCustomId(interaction.customId);
  if (action.kind === "question-other") return await answerInOwnWords(bridge, interaction, action);
  await respondQuietly(interaction, bridge.language.say("common.staleControl"));
}

async function decideApproval(bridge: Bridge, interaction: ButtonInteraction, action: Action<"approval">) {
  const verdict = bridge.approvals.decide(bridge.language.say, action.id, interaction.user.id, action.choice);
  await respondQuietly(interaction, verdict);
}

async function stopTurn(bridge: Bridge, interaction: ButtonInteraction, action: Action<"turn-stop">) {
  await acknowledgeQuietly(interaction);
  await respondQuietly(interaction, describeStopTurn(bridge.language.say, bridge.flow.stopTurn(action.sessionId)));
}

async function stopAllTurns(bridge: Bridge, interaction: ButtonInteraction, action: Action<"turn-stop-all">) {
  await acknowledgeQuietly(interaction);
  await respondQuietly(interaction, describeStop(bridge.language.say, bridge.flow.stop(action.sessionId)));
}

async function stopAgents(bridge: Bridge, interaction: ButtonInteraction, action: Action<"turn-stop-agents">) {
  await acknowledgeQuietly(interaction);
  const stopped = await bridge.flow.stopAgents(action.sessionId);
  await respondQuietly(interaction, describeStopAgents(bridge.language.say, stopped));
}

async function sendNow(bridge: Bridge, interaction: ButtonInteraction, action: Action<"turn-send-now">) {
  await acknowledgeQuietly(interaction);
  const outcome = await bridge.flow.sendNow(action.sessionId);
  await respondQuietly(interaction, describeSendNow(bridge.language.say, outcome));
}

async function cancelPurge(bridge: Bridge, interaction: ButtonInteraction) {
  await settleMenu(interaction, bridge.language.say("purge.cancelled"));
}

async function confirmPurge(bridge: Bridge, interaction: ButtonInteraction) {
  const say = bridge.language.say;
  const channel = interaction.channel;
  if (!channel || !("bulkDelete" in channel)) {
    await settleMenu(interaction, say("purge.notDeletable"));
    return;
  }
  await settleMenu(interaction, say("purge.deleting"));
  try {
    const result = await purgeChannel(channel, interaction.message.id);
    await settleMenu(interaction, describePurge(say, result, isConversationChannel(bridge, interaction.channelId)));
  } catch (error) {
    await settleMenu(interaction, say("purge.stoppedPartway", { error: errorMessage(error) }));
  }
}

async function cancelCreate(bridge: Bridge, interaction: ButtonInteraction) {
  bridge.pendingCreates.take(interaction.message.id);
  await settleMenu(interaction, bridge.language.say("create.cancelled"));
}

async function createNew(bridge: Bridge, interaction: ButtonInteraction) {
  const request = bridge.pendingCreates.take(interaction.message.id);
  if (!request) {
    await settleMenu(interaction, bridge.language.say("create.tooOld"));
    return;
  }
  await interaction.deferUpdate();
  await startConversation(bridge, interaction, request);
}

async function createResume(bridge: Bridge, interaction: ButtonInteraction, action: Action<"create-resume">) {
  // The offer expires as a whole: a press on Resume is held to the same ten minutes as one on Start a new one.
  if (!bridge.pendingCreates.take(interaction.message.id)) {
    await settleMenu(interaction, bridge.language.say("create.tooOld"));
    return;
  }
  await interaction.deferUpdate();

  const record = await bridge.sessions.find(action.sessionId);
  if (!record || !hasWorkingDir(record)) {
    await settleMenu(interaction, bridge.language.say("create.gone"));
    return;
  }
  await openConversation(bridge, interaction, record);
}

async function cancelClear(bridge: Bridge, interaction: ButtonInteraction) {
  await settleMenu(interaction, bridge.language.say("clear.cancelled"));
}

async function confirmClear(bridge: Bridge, interaction: ButtonInteraction, action: Action<"clear-confirm">) {
  if (!(await mayPress(bridge, interaction, "clear"))) return;
  await clearConversation(bridge, interaction, action.sessionId);
}

async function approveRun(bridge: Bridge, interaction: ButtonInteraction) {
  if (!(await mayPress(bridge, interaction, "run"))) return;
  await confirmRun(bridge, interaction);
}

async function keepUnboundChannel(bridge: Bridge, interaction: ButtonInteraction) {
  await settleMenu(interaction, bridge.language.say("unbind.kept"));
}

// The reply lives in the channel being deleted, so it may be gone before it can be edited.
async function deleteUnboundChannel(bridge: Bridge, interaction: ButtonInteraction) {
  const say = bridge.language.say;
  if (!(await mayPress(bridge, interaction, "unbind"))) return;
  const channel = interaction.channel;
  if (!channel || channel.isDMBased()) {
    await settleMenu(interaction, say("unbind.notDeletable"));
    return;
  }
  // The button outlives the moment it was offered in, and the channel may hold a conversation again by now.
  if (bridge.store.byChannel(interaction.channelId)) {
    await settleMenu(interaction, say("unbind.boundAgain"));
    return;
  }
  await settleMenu(interaction, say("unbind.deleting"));
  try {
    await channel.delete();
  } catch (error) {
    await settleMenu(interaction, say("unbind.deleteFailed", { error: errorMessage(error) })).catch(() => undefined);
  }
}

async function togglePlugin(bridge: Bridge, interaction: ButtonInteraction, action: Action<"plugin-toggle">) {
  const say = bridge.language.say;
  if (!(await mayPress(bridge, interaction, "plugins"))) return;
  await interaction.deferUpdate();
  try {
    const printed = await setPluginEnabled(action.id, action.enable);
    await settleMenu(interaction, printed || say(action.enable ? "plugins.enabled" : "plugins.disabled", { id: action.id }));
  } catch (error) {
    await settleMenu(
      interaction,
      say(action.enable ? "plugins.enableFailed" : "plugins.disableFailed", { id: action.id, error: errorMessage(error) }),
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
    case "turn-stop-all":
      return await stopAllTurns(bridge, interaction, action);
    case "turn-stop-agents":
      return await stopAgents(bridge, interaction, action);
    case "turn-send-now":
      return await sendNow(bridge, interaction, action);
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
    case "clear-cancel":
      return await cancelClear(bridge, interaction);
    case "clear-confirm":
      return await confirmClear(bridge, interaction, action);
    case "run-cancel":
      return await cancelRun(bridge, interaction);
    case "run-confirm":
      return await approveRun(bridge, interaction);
    case "question-submit":
      return await submitAnswers(bridge, interaction, action);
    case "question-skip":
      return await skipQuestions(bridge, interaction, action);
    case "plugin-toggle":
      return await togglePlugin(bridge, interaction, action);
    default:
      return await settleMenu(interaction, bridge.language.say("common.staleControl"));
  }
}
