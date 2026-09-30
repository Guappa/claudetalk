const CUSTOM_ID_LIMIT = 100;

export const PLUGIN_SELECT = "plugin:select";
export const SKILL_SELECT = "skill:select";
export const PURGE_CONFIRM = "purge:confirm";
export const PURGE_CANCEL = "purge:cancel";
export const CREATE_NEW = "create:new";
export const CREATE_CANCEL = "create:cancel";
export const UNBIND_DELETE = "unbind:delete";
export const UNBIND_KEEP = "unbind:keep";
export const CLEAR_CANCEL = "clear:cancel";
export const RUN_CONFIRM = "run:confirm";
export const RUN_CANCEL = "run:cancel";

export function stopActionId(sessionId: string): string {
  return `turn:stop:${sessionId}`.slice(0, CUSTOM_ID_LIMIT);
}

export function stopAgentsActionId(sessionId: string): string {
  return `turn:stopagents:${sessionId}`.slice(0, CUSTOM_ID_LIMIT);
}

export function sendNowActionId(sessionId: string): string {
  return `turn:sendnow:${sessionId}`.slice(0, CUSTOM_ID_LIMIT);
}

export function stopAllActionId(sessionId: string): string {
  return `turn:stopall:${sessionId}`.slice(0, CUSTOM_ID_LIMIT);
}

export function questionPickId(askId: string, index: number): string {
  return `question:pick:${askId}:${index}`;
}

export function questionOtherId(askId: string, index: number): string {
  return `question:other:${askId}:${index}`;
}

export function questionSubmitId(askId: string): string {
  return `question:submit:${askId}`;
}

export function questionSkipId(askId: string): string {
  return `question:skip:${askId}`;
}

// Every menu in one message needs its own id, and which page a skill came from does not matter.
export function skillSelectId(page: number): string {
  return `${SKILL_SELECT}:${page}`;
}

export type MenuAction =
  | { kind: "plugin-chosen"; id: string }
  | { kind: "plugin-toggle"; id: string; enable: boolean }
  | { kind: "skill-chosen"; skill: string }
  | { kind: "purge-confirm" }
  | { kind: "purge-cancel" }
  | { kind: "create-new" }
  | { kind: "create-cancel" }
  | { kind: "unbind-delete" }
  | { kind: "unbind-keep" }
  | { kind: "clear-confirm"; sessionId: string }
  | { kind: "clear-cancel" }
  | { kind: "run-confirm" }
  | { kind: "run-cancel" }
  | { kind: "create-resume"; sessionId: string }
  | { kind: "turn-stop"; sessionId: string }
  | { kind: "turn-stop-all"; sessionId: string }
  | { kind: "turn-stop-agents"; sessionId: string }
  | { kind: "turn-send-now"; sessionId: string }
  | { kind: "question-pick"; askId: string; index: number }
  | { kind: "question-other"; askId: string; index: number }
  | { kind: "question-submit"; askId: string }
  | { kind: "question-skip"; askId: string }
  | { kind: "approval"; id: string; choice: ApprovalChoice }
  | { kind: "unknown" };

export type ApprovalChoice = "approve" | "deny" | "approve-all";

export function approvalActionId(choice: ApprovalChoice, id: string): string {
  return `${choice}:${id}`;
}

export function pluginToggleId(id: string, enable: boolean): string {
  return `plugin:${enable ? "enable" : "disable"}:${id}`.slice(0, CUSTOM_ID_LIMIT);
}

// The button names the conversation it was offered for, so a press that comes late clears nothing else.
export function clearConfirmId(sessionId: string): string {
  return `clear:confirm:${sessionId}`.slice(0, CUSTOM_ID_LIMIT);
}

export function createResumeId(sessionId: string): string {
  return `create:resume:${sessionId}`.slice(0, CUSTOM_ID_LIMIT);
}

function isSkillSelect(customId: string): boolean {
  return customId === SKILL_SELECT || /^skill:select:\d+$/.test(customId);
}

export function parseCustomId(customId: string, selectedValue?: string): MenuAction {
  if (customId === PLUGIN_SELECT && selectedValue) return { kind: "plugin-chosen", id: selectedValue };
  if (isSkillSelect(customId) && selectedValue) return { kind: "skill-chosen", skill: selectedValue };

  if (customId === PURGE_CONFIRM) return { kind: "purge-confirm" };
  if (customId === PURGE_CANCEL) return { kind: "purge-cancel" };

  if (customId === CREATE_NEW) return { kind: "create-new" };
  if (customId === CREATE_CANCEL) return { kind: "create-cancel" };
  if (customId === UNBIND_DELETE) return { kind: "unbind-delete" };
  if (customId === UNBIND_KEEP) return { kind: "unbind-keep" };
  if (customId === CLEAR_CANCEL) return { kind: "clear-cancel" };
  if (customId === RUN_CONFIRM) return { kind: "run-confirm" };
  if (customId === RUN_CANCEL) return { kind: "run-cancel" };
  const clear = /^clear:confirm:(.+)$/.exec(customId);
  if (clear?.[1]) return { kind: "clear-confirm", sessionId: clear[1] };

  const resume = /^create:resume:(.+)$/.exec(customId);
  if (resume?.[1]) return { kind: "create-resume", sessionId: resume[1] };

  const sendNow = /^turn:sendnow:(.+)$/.exec(customId);
  if (sendNow?.[1]) return { kind: "turn-send-now", sessionId: sendNow[1] };

  const stopAgents = /^turn:stopagents:(.+)$/.exec(customId);
  if (stopAgents?.[1]) return { kind: "turn-stop-agents", sessionId: stopAgents[1] };

  const stopAll = /^turn:stopall:(.+)$/.exec(customId);
  if (stopAll?.[1]) return { kind: "turn-stop-all", sessionId: stopAll[1] };

  const stop = /^turn:stop:(.+)$/.exec(customId);
  if (stop?.[1]) return { kind: "turn-stop", sessionId: stop[1] };

  const question = /^question:(pick|other|submit|skip):([^:]+)(?::(\d+))?$/.exec(customId);
  if (question?.[1] && question[2]) {
    const askId = question[2];
    const index = Number(question[3] ?? -1);
    if (question[1] === "pick" && index >= 0) return { kind: "question-pick", askId, index };
    if (question[1] === "other" && index >= 0) return { kind: "question-other", askId, index };
    if (question[1] === "submit") return { kind: "question-submit", askId };
    if (question[1] === "skip") return { kind: "question-skip", askId };
  }

  const approval = /^(approve-all|approve|deny):(.+)$/.exec(customId);
  if (approval?.[1] && approval[2]) {
    return { kind: "approval", id: approval[2], choice: approval[1] as ApprovalChoice };
  }

  const toggle = /^plugin:(enable|disable):(.+)$/.exec(customId);
  if (toggle?.[1] && toggle[2]) return { kind: "plugin-toggle", id: toggle[2], enable: toggle[1] === "enable" };

  return { kind: "unknown" };
}
