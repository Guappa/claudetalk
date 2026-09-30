import fs from "node:fs/promises";
import path from "node:path";
import type { Say } from "../i18n/index.ts";
import { outboxPath, outboxRelative } from "../outboxFolder.ts";
import type { SinkFile } from "./messageSink.ts";

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;
// Discord refuses a message whose whole request is over 25 MiB, however little each file in it weighs.
export const MAX_MESSAGE_BYTES = 24 * 1024 * 1024;

export interface OutboxResult {
  files: SinkFile[];
  // The size and writing time of each file collected, by name: what tells one sent already and still on disk from a new file of the same name.
  marks: Map<string, string>;
  // Too large ever to be attached, so they stay where they are.
  skipped: string[];
  // How many were left for the next message because this one is full.
  deferred: number;
  // Call once the files are delivered; until then they stay on disk and the next sweep retries them. It answers with the names it could not remove.
  discard(): Promise<string[]>;
}

// Whether a file of this name, size and writing time was delivered before and is only still here because it could not be removed.
type SentAlready = (name: string, mark: string) => boolean;

export function describeSkipped(say: Say, skipped: string[], sessionId: string): string {
  if (skipped.length === 0) return "";
  return say("outbox.tooLarge", { folder: outboxRelative(sessionId), names: skipped.join(", ") });
}

// A file still being written must not be sent half-finished, so a sweep waits for it to settle.
export const SETTLE_MS = 3000;

export async function collectOutbox(
  cwd: string,
  sessionId: string,
  minAgeMs = 0,
  sentAlready: SentAlready = () => false,
): Promise<OutboxResult> {
  const dir = outboxPath(cwd, sessionId);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { files: [], marks: new Map(), skipped: [], deferred: 0, discard: async () => [] };
  }

  const files: SinkFile[] = [];
  const marks = new Map<string, string>();
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

      const mark = `${stat.size}:${stat.mtimeMs}`;
      // Removing it is tried again, and it takes no place in the message: it is in the channel already.
      if (sentAlready(entry, mark)) {
        collected.push(full);
        continue;
      }
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
      marks.set(entry, mark);
      collected.push(full);
      bytes += stat.size;
    } catch {
      continue;
    }
  }

  const discard = async (): Promise<string[]> => {
    const kept: string[] = [];
    // A file still held for a moment, by a scanner for one, is tried again before it is given up on for this sweep.
    for (const full of collected) {
      await fs.rm(full, { force: true, maxRetries: 5, retryDelay: 200 }).catch(() => void kept.push(path.basename(full)));
    }
    // Leaving empty folders behind litters whatever project the conversation works in.
    if (skipped.length === 0 && deferred === 0 && kept.length === 0) {
      await fs.rmdir(dir).catch(() => undefined);
      await fs.rmdir(path.dirname(dir)).catch(() => undefined);
    }
    return kept;
  };

  return { files, marks, skipped, deferred, discard };
}
