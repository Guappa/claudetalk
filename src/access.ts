import path from "node:path";

export type Tier = "owner" | "operator" | "none";

// An operator drives the bot; deciding who else may is the owner's, and stays off this list.
const OPERATOR_COMMANDS = new Set([
  "ask",
  "sync",
  "whoami",
  "spend",
  "members",
  "skills",
  "stop",
  "queue",
  "create",
  "category",
  "resume",
  "fork",
  "sessions",
  "model",
  "effort",
  "unbind",
  "takeover",
  "purge",
  "clear",
]);

export interface AccessContext {
  ownerIds: string[];
  operatorIds: string[];
}

// Being in a conversation grants nothing: any prompt reaching a session runs with the host's rights.
export function tierFor(context: AccessContext, userId: string): Tier {
  if (context.ownerIds.includes(userId)) return "owner";
  if (context.operatorIds.includes(userId)) return "operator";
  return "none";
}

export function canRunCommand(tier: Tier, command: string): boolean {
  if (tier === "owner") return true;
  if (tier === "operator") return OPERATOR_COMMANDS.has(command);
  return false;
}

export function describeOwnersOnly(command: string): string {
  return (
    `\`/${command}\` is an owner's. Operators drive the bot; who else may use it, and what runs ` +
    "inside it, is the owner's to decide."
  );
}

export function workspaceFor(workspacesRoot: string, userId: string): string {
  return path.join(workspacesRoot, userId);
}
