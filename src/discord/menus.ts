import { CUSTOM_ID_CHARS } from "./limits.ts";

export const PLUGIN_SELECT = "plugin:select";
export const MCP_SELECT = "mcp:select";
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
export const SEND_WAIT = "turn:sendwait";

export function stopActionId(sessionId: string): string {
  return `turn:stop:${sessionId}`.slice(0, CUSTOM_ID_CHARS);
}

export function stopAgentsActionId(sessionId: string): string {
  return `turn:stopagents:${sessionId}`.slice(0, CUSTOM_ID_CHARS);
}

export function sendNowActionId(sessionId: string): string {
  return `turn:sendnow:${sessionId}`.slice(0, CUSTOM_ID_CHARS);
}

// Offered once Send now has said what it would cut short, and naming that call by when it started, so a press left over from an earlier one asks again.
export function sendAnywayActionId(sessionId: string, startedAt: number): string {
  return `turn:sendanyway:${sessionId}:${startedAt}`.slice(0, CUSTOM_ID_CHARS);
}

export function stopAllActionId(sessionId: string): string {
  return `turn:stopall:${sessionId}`.slice(0, CUSTOM_ID_CHARS);
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
  | { kind: "mcp-chosen"; name: string }
  | { kind: "mcp-toggle"; name: string; enable: boolean }
  | { kind: "mcp-reconnect"; name: string }
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
  | { kind: "turn-send-now"; sessionId: string; confirmedFor: number | null }
  | { kind: "turn-send-wait" }
  | { kind: "question-pick"; askId: string; index: number }
  | { kind: "question-other"; askId: string; index: number }
  | { kind: "question-submit"; askId: string }
  | { kind: "question-skip"; askId: string }
  | { kind: "approval"; id: string; choice: ApprovalChoice }
  | { kind: "unknown" };

export type Action<K extends MenuAction["kind"]> = Extract<MenuAction, { kind: K }>;

export type ApprovalChoice = "approve" | "deny" | "approve-all";

export function approvalActionId(choice: ApprovalChoice, id: string): string {
  return `${choice}:${id}`;
}

export function pluginToggleId(id: string, enable: boolean): string {
  return `plugin:${enable ? "enable" : "disable"}:${id}`.slice(0, CUSTOM_ID_CHARS);
}

export function mcpToggleId(name: string, enable: boolean): string {
  return `mcp:${enable ? "on" : "off"}:${name}`.slice(0, CUSTOM_ID_CHARS);
}

export function mcpReconnectId(name: string): string {
  return `mcp:reconnect:${name}`.slice(0, CUSTOM_ID_CHARS);
}

// The button names the conversation it was offered for, so a press that comes late clears nothing else.
export function clearConfirmId(sessionId: string): string {
  return `clear:confirm:${sessionId}`.slice(0, CUSTOM_ID_CHARS);
}

export function createResumeId(sessionId: string): string {
  return `create:resume:${sessionId}`.slice(0, CUSTOM_ID_CHARS);
}

function isSkillSelect(customId: string): boolean {
  return customId === SKILL_SELECT || /^skill:select:\d+$/.test(customId);
}

export function parseCustomId(customId: string, selectedValue?: string): MenuAction {
  if (customId === PLUGIN_SELECT && selectedValue) return { kind: "plugin-chosen", id: selectedValue };
  if (customId === MCP_SELECT && selectedValue) return { kind: "mcp-chosen", name: selectedValue };
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
  if (customId === SEND_WAIT) return { kind: "turn-send-wait" };
  const clear = /^clear:confirm:(.+)$/.exec(customId);
  if (clear?.[1]) return { kind: "clear-confirm", sessionId: clear[1] };

  const resume = /^create:resume:(.+)$/.exec(customId);
  if (resume?.[1]) return { kind: "create-resume", sessionId: resume[1] };

  const sendNow = /^turn:sendnow:(.+)$/.exec(customId);
  if (sendNow?.[1]) return { kind: "turn-send-now", sessionId: sendNow[1], confirmedFor: null };
  const sendAnyway = /^turn:sendanyway:(.+):(\d+)$/.exec(customId);
  if (sendAnyway?.[1]) return { kind: "turn-send-now", sessionId: sendAnyway[1], confirmedFor: Number(sendAnyway[2]) };

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

  // A server's name can hold colons and spaces of its own, so everything after the verb is the name.
  const server = /^mcp:(on|off|reconnect):(.+)$/.exec(customId);
  if (server?.[1] === "reconnect" && server[2]) return { kind: "mcp-reconnect", name: server[2] };
  if (server?.[1] && server[2]) return { kind: "mcp-toggle", name: server[2], enable: server[1] === "on" };

  return { kind: "unknown" };
}
