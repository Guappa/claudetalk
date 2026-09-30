import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Bridge } from "../../bridge.ts";
import type { Say } from "../../i18n/index.ts";
import { parseCustomId, questionOtherId, type Action, type MenuAction } from "../menus.ts";
import { OTHER_VALUE } from "../questions.ts";
import { openConversation, startConversation } from "../commands/conversations.ts";
import { clearConversation } from "../commands/clear.ts";
import { choosePlugin, togglePlugin } from "../commands/plugins.ts";
import { cancelPurge, confirmPurge } from "../commands/purge.ts";
import { cancelRun, confirmRun } from "../commands/run.ts";
import { runSkill } from "../commands/skills.ts";
import { acknowledgeQuietly, respondQuietly, settleMenu } from "../respond.ts";
import { nameForDiscord } from "../outgoing.ts";
import { describeSendNow, describeStop, describeStopAgents, describeStopTurn } from "../turnFlow.ts";
import { canRunCommand } from "../../access.ts";
import { MODAL_TEXT_CHARS } from "../limits.ts";
import { tierOf } from "../policy.ts";
import { hasWorkingDir } from "../../sessions/index.ts";
import { errorMessage, truncate } from "../../text.ts";

// Which command a control belongs to, and so who may press it: the same tiers that may run the command.
const COMMAND_OF: Partial<Record<MenuAction["kind"], string>> = {
  "plugin-chosen": "plugins",
  "plugin-toggle": "plugins",
  "skill-chosen": "skills",
  "purge-confirm": "purge",
  "purge-cancel": "purge",
  "create-new": "create",
  "create-cancel": "create",
  "create-resume": "create",
  "unbind-delete": "unbind",
  "unbind-keep": "unbind",
  "clear-confirm": "clear",
  "clear-cancel": "clear",
  "run-confirm": "run",
  "run-cancel": "run",
  "turn-stop": "stop",
  "turn-stop-all": "stop",
  "turn-stop-agents": "stop",
  "turn-send-now": "stop",
};

// A control is checked on its own press, not on who could see the message it sits on; false once the presser has been told it is not theirs.
async function mayPress(bridge: Bridge, interaction: ButtonInteraction | StringSelectMenuInteraction, action: MenuAction) {
  const command = COMMAND_OF[action.kind];
  if (!command || canRunCommand(tierOf(bridge, interaction.user.id), command)) return true;
  await settleMenu(interaction, bridge.language.say("access.ownersOnly", { command }));
  return false;
}

const OTHER_ANSWER_FIELD = "answer";

function otherAnswerModal(say: Say, action: Action<"question-pick">): ModalBuilder {
  const field = new TextInputBuilder()
    .setCustomId(OTHER_ANSWER_FIELD)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);
  return new ModalBuilder()
    .setCustomId(questionOtherId(action.askId, action.index))
    .setTitle(truncate(nameForDiscord(say("questions.ownAnswerTitle", { number: action.index + 1 })), MODAL_TEXT_CHARS))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(truncate(nameForDiscord(say("questions.ownAnswerLabel")), MODAL_TEXT_CHARS))
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
  if (!(await mayPress(bridge, interaction, action))) return;
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
  await clearConversation(bridge, interaction, action.sessionId);
}

async function keepUnboundChannel(bridge: Bridge, interaction: ButtonInteraction) {
  await settleMenu(interaction, bridge.language.say("unbind.kept"));
}

// The reply lives in the channel being deleted, so it may be gone before it can be edited.
async function deleteUnboundChannel(bridge: Bridge, interaction: ButtonInteraction) {
  const say = bridge.language.say;
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

export async function handleButton(bridge: Bridge, interaction: ButtonInteraction): Promise<void> {
  const action = parseCustomId(interaction.customId);
  if (!(await mayPress(bridge, interaction, action))) return;
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
      return await confirmRun(bridge, interaction);
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
