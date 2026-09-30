import fs from "node:fs/promises";
import path from "node:path";
import type { Say } from "../i18n/index.ts";
import type { SinkFile } from "./messageSink.ts";

export const OUTBOX_DIR = ".discord-outbox";
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;
// Discord refuses a message whose whole request is over 25 MiB, however little each file in it weighs.
export const MAX_MESSAGE_BYTES = 24 * 1024 * 1024;

export interface OutboxResult {
  files: SinkFile[];
  // Too large ever to be attached, so they stay where they are.
  skipped: string[];
  // How many were left for the next message because this one is full.
  deferred: number;
  // Call once the files are delivered; until then they stay on disk and the next sweep retries them.
  discard(): Promise<void>;
}

// Keyed by conversation: two conversations in one folder must never read each other's files.
export function outboxPath(cwd: string, sessionId: string): string {
  return path.join(cwd, OUTBOX_DIR, sessionId);
}

export function outboxRelative(sessionId: string): string {
  return `${OUTBOX_DIR}/${sessionId}/`;
}

export function describeSkipped(say: Say, skipped: string[], sessionId: string): string {
  if (skipped.length === 0) return "";
  return say("outbox.tooLarge", { folder: outboxRelative(sessionId), names: skipped.join(", ") });
}

// A file still being written must not be sent half-finished, so a sweep waits for it to settle.
export const SETTLE_MS = 3000;

export async function collectOutbox(cwd: string, sessionId: string, minAgeMs = 0): Promise<OutboxResult> {
  const dir = outboxPath(cwd, sessionId);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { files: [], skipped: [], deferred: 0, discard: async () => undefined };
  }

  const files: SinkFile[] = [];
  const skipped: string[] = [];
  const collected: string[] = [];
  let bytes = 0;
  let deferred = 0;

  for (const entry of entries.sort()) {
    const full = path.join(dir, entry);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      if (minAgeMs > 0 && Date.now() - stat.mtimeMs < minAgeMs) continue;

      if (stat.size > MAX_FILE_BYTES) {
        skipped.push(entry);
        continue;
      }
      // Once one file has to wait, the rest wait behind it, so they arrive in the order they are named in.
      if (deferred > 0 || files.length >= MAX_FILES_PER_MESSAGE || bytes + stat.size > MAX_MESSAGE_BYTES) {
        deferred += 1;
        continue;
      }

      files.push({ name: entry, data: await fs.readFile(full) });
      collected.push(full);
      bytes += stat.size;
    } catch {
      continue;
    }
  }

  const discard = async (): Promise<void> => {
    for (const full of collected) await fs.rm(full, { force: true }).catch(() => undefined);
    // Leaving empty folders behind litters whatever project the conversation works in.
    if (skipped.length === 0 && deferred === 0) {
      await fs.rmdir(dir).catch(() => undefined);
      await fs.rmdir(path.dirname(dir)).catch(() => undefined);
    }
  };

  return { files, skipped, deferred, discard };
}
