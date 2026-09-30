import { claudeCli, parseJsonArray } from "../claude/cli.ts";

export interface ActiveSession {
  pid: number;
  cwd: string;
  kind: "interactive" | "background";
  sessionId: string;
  name?: string;
  status?: string;
  id?: string;
}

function isActiveSession(item: unknown): item is ActiveSession {
  const record = item as Partial<ActiveSession> | null;
  return typeof record?.pid === "number" && typeof record.sessionId === "string" && typeof record.cwd === "string";
}

export function parseAgentsJson(raw: string): ActiveSession[] {
  return parseJsonArray(raw, isActiveSession);
}

// Null when the listing could not be had, which is not the same as nothing being live.
export async function listActiveSessions(): Promise<ActiveSession[] | null> {
  try {
    return parseAgentsJson((await claudeCli(["agents", "--json"])).stdout);
  } catch {
    return null;
  }
}

export async function stopBackgroundSession(shortId: string): Promise<string> {
  const { stdout, stderr } = await claudeCli(["stop", shortId]);
  return (stdout || stderr).trim();
}
