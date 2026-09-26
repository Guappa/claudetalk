import fs from "node:fs/promises";
import { readJsonOr, writeJsonAtomic } from "./jsonFile.ts";

export interface DrainState {
  since: string;
  turns: number;
}

export interface LockInfo {
  pid: number;
  startedAt: string;
  heartbeatAt: string;
  draining?: DrainState;
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

// The lock is also where a draining bridge tells the stop script what it is waiting for.
export class InstanceLock {
  private readonly lockPath: string;
  private readonly startedAt: string;
  private draining: DrainState | undefined;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(lockPath: string) {
    this.lockPath = lockPath;
    this.startedAt = new Date().toISOString();
  }

  async acquire(aliveCheck: (pid: number) => boolean = isProcessAlive): Promise<void> {
    const existing = await readJsonOr<Partial<LockInfo> | null>(this.lockPath, () => null);
    if (existing && isLockHeld(existing, Date.now(), aliveCheck)) {
      throw new Error(describeConflict(existing, this.lockPath));
    }
    await this.write();
    this.heartbeat = setInterval(() => void this.write().catch(() => undefined), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  async noteDraining(turns: number): Promise<void> {
    this.draining = { since: this.draining?.since ?? new Date().toISOString(), turns };
    await this.write();
  }

  async release(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    const existing = await readJsonOr<Partial<LockInfo> | null>(this.lockPath, () => null);
    if (existing?.pid === process.pid) await fs.rm(this.lockPath, { force: true });
  }

  private write(): Promise<void> {
    const info: LockInfo = { pid: process.pid, startedAt: this.startedAt, heartbeatAt: new Date().toISOString() };
    if (this.draining) info.draining = this.draining;
    return writeJsonAtomic(this.lockPath, info);
  }
}

export async function acquireInstanceLock(
  lockPath: string,
  aliveCheck: (pid: number) => boolean = isProcessAlive,
): Promise<InstanceLock> {
  const lock = new InstanceLock(lockPath);
  await lock.acquire(aliveCheck);
  return lock;
}
