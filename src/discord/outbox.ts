import fs from "node:fs/promises";
import path from "node:path";
import type { SinkFile } from "./messageSink.ts";

export const OUTBOX_DIR = ".discord-outbox";
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;

export interface OutboxResult {
  files: SinkFile[];
  skipped: string[];
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

export function describeSkipped(skipped: string[], sessionId: string): string {
  if (skipped.length === 0) return "";
  const names = skipped.join(", ");
  return `Too large to attach, left in \`${outboxRelative(sessionId)}\`: ${names}.`;
}

// A file still being written must not be sent half-finished, so a sweep waits for it to settle.
export const SETTLE_MS = 3000;

export async function collectOutbox(cwd: string, sessionId: string, minAgeMs = 0): Promise<OutboxResult> {
  const dir = outboxPath(cwd, sessionId);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { files: [], skipped: [], discard: async () => undefined };
  }

  const files: SinkFile[] = [];
  const skipped: string[] = [];
  const collected: string[] = [];

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
      if (files.length >= MAX_FILES_PER_MESSAGE) {
        skipped.push(entry);
        continue;
      }

      files.push({ name: entry, data: await fs.readFile(full) });
      collected.push(full);
    } catch {
      continue;
    }
  }

  const discard = async (): Promise<void> => {
    for (const full of collected) await fs.rm(full, { force: true }).catch(() => undefined);
    // Leaving empty folders behind litters whatever project the conversation works in.
    if (skipped.length === 0) {
      await fs.rmdir(dir).catch(() => undefined);
      await fs.rmdir(path.dirname(dir)).catch(() => undefined);
    }
  };

  return { files, skipped, discard };
}
