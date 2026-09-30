import path from "node:path";

// Where a session leaves files for Discord: named to the session in its system note, read by the bridge after each turn and at each sweep.
export const OUTBOX_DIR = ".discord-outbox";

// Keyed by conversation: two conversations in one folder must never read each other's files.
export function outboxPath(cwd: string, sessionId: string): string {
  return path.join(cwd, OUTBOX_DIR, sessionId);
}

export function outboxRelative(sessionId: string): string {
  return `${OUTBOX_DIR}/${sessionId}/`;
}
