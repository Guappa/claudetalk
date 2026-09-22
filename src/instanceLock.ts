import fs from "node:fs/promises";
import { readJsonOr, writeJsonAtomic } from "./jsonFile.ts";

export interface LockInfo {
  pid: number;
  startedAt: string;
  heartbeatAt: string;
}

const HEARTBEAT_MS = 30_000;
export const STALE_AFTER_MS = 90_000;

export function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence check without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// A killed bridge leaves its lock behind and its pid can be reused, so a heartbeat is the proof.
export function isLockHeld(lock: Partial<LockInfo>, now: number, aliveCheck = isProcessAlive): boolean {
  if (typeof lock.pid !== "number" || lock.pid === process.pid) return false;
  if (!aliveCheck(lock.pid)) return false;

  const beat = Date.parse(lock.heartbeatAt ?? "");
  if (Number.isNaN(beat)) return false;
  return now - beat < STALE_AFTER_MS;
}

function describeConflict(lock: Partial<LockInfo>, lockPath: string): string {
  return (
    `Another bridge is already running (pid ${lock.pid}, started ${lock.startedAt}). ` +
    `Two instances would answer every message twice and double your usage. ` +
    `Stop that one first, or delete ${lockPath} if you are sure it is gone.`
  );
}

export async function acquireInstanceLock(
  lockPath: string,
  aliveCheck: (pid: number) => boolean = isProcessAlive,
): Promise<NodeJS.Timeout> {
  const existing = await readJsonOr<Partial<LockInfo> | null>(lockPath, () => null);
  if (existing && isLockHeld(existing, Date.now(), aliveCheck)) {
    throw new Error(describeConflict(existing, lockPath));
  }

  const startedAt = new Date().toISOString();
  await writeJsonAtomic(lockPath, { pid: process.pid, startedAt, heartbeatAt: startedAt });

  const heartbeat = setInterval(() => {
    void writeJsonAtomic(lockPath, { pid: process.pid, startedAt, heartbeatAt: new Date().toISOString() }).catch(
      () => undefined,
    );
  }, HEARTBEAT_MS);
  heartbeat.unref();
  return heartbeat;
}

export async function releaseInstanceLock(lockPath: string): Promise<void> {
  const existing = await readJsonOr<Partial<LockInfo> | null>(lockPath, () => null);
  if (existing?.pid === process.pid) await fs.rm(lockPath, { force: true });
}
