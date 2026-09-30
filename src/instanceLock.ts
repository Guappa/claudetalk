import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { orderedWriter, readJsonOr } from "./jsonFile.ts";

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

// A hard link appears whole or not at all and refuses to replace a file; a filesystem without them gets an exclusive copy, which can be seen half-written for a moment.
async function publish(from: string, to: string): Promise<void> {
  try {
    await fs.link(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw error;
    await fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);
  }
}

// The lock is also where a draining bridge tells the stop script what it is waiting for.
export class InstanceLock {
  private readonly lockPath: string;
  private readonly startedAt: string;
  private draining: DrainState | undefined;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly save: (value: unknown) => Promise<void>;

  constructor(lockPath: string) {
    this.lockPath = lockPath;
    this.startedAt = new Date().toISOString();
    this.save = orderedWriter(lockPath);
  }

  async acquire(aliveCheck: (pid: number) => boolean = isProcessAlive): Promise<void> {
    const seen = await fs.readFile(this.lockPath, "utf8").catch(() => null);
    if (seen !== null) {
      const existing = parseLock(seen);
      if (existing && isLockHeld(existing, Date.now(), aliveCheck)) throw new Error(describeConflict(existing, this.lockPath));
      await this.clearDead(seen);
    }
    await this.claim();
    this.heartbeat = setInterval(() => void this.write().catch(() => undefined), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  // Written in full beside the lock and linked into place, which fails if one is there: of two bridges starting together one gets the file and the other is told.
  private async claim(): Promise<void> {
    await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
    const draft = `${this.lockPath}.${process.pid}.claim`;
    await fs.writeFile(draft, JSON.stringify(this.info(), null, 2), "utf8");
    try {
      await publish(draft, this.lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const winner = await readJsonOr<Partial<LockInfo>>(this.lockPath, () => ({}));
      throw new Error(describeConflict(winner, this.lockPath));
    } finally {
      await fs.rm(draft, { force: true });
    }
  }

  // Moved aside before it is removed: if it was rewritten after being judged dead it belongs to a bridge that is alive, so it goes back and this start gives way.
  private async clearDead(seen: string): Promise<void> {
    const aside = `${this.lockPath}.${process.pid}.dead`;
    const moved = await fs.rename(this.lockPath, aside).then(
      () => true,
      () => false,
    );
    if (!moved) return;
    const taken = await fs.readFile(aside, "utf8").catch(() => seen);
    if (taken !== seen) await publish(aside, this.lockPath).catch(() => undefined);
    await fs.rm(aside, { force: true });
    if (taken !== seen) throw new Error(describeConflict(parseLock(taken) ?? {}, this.lockPath));
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

  private info(): LockInfo {
    const info: LockInfo = { pid: process.pid, startedAt: this.startedAt, heartbeatAt: new Date().toISOString() };
    if (this.draining) info.draining = this.draining;
    return info;
  }

  private write(): Promise<void> {
    return this.save(this.info());
  }
}

function parseLock(raw: string): Partial<LockInfo> | null {
  try {
    return JSON.parse(raw) as Partial<LockInfo> | null;
  } catch {
    return null;
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
