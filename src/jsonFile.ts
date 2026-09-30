import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { errorMessage } from "./text.ts";

// For state that can be rebuilt: a cache that is missing or damaged starts over, since stopping the bridge over it would cost more than it holds.
export async function readJsonOr<T>(filePath: string, fallback: () => T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback();
  }
}

// For state nothing can rebuild: only a missing file is the empty state. One that is there and cannot be read would be overwritten by the next save, so it stops the start.
export async function readStore<T>(filePath: string, fallback: () => T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback();
    throw new Error(
      `${filePath} could not be read: ${errorMessage(error)}. Nothing was changed. ` +
        "Check that the bridge may read the file and that nothing else has it open, then start the bridge again.",
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `${filePath} is not valid JSON: ${errorMessage(error)}. Nothing was changed. ` +
        "Correct the file, or move it aside to start without what it holds, then start the bridge again.",
    );
  }
}

// Written beside and renamed over, so a crash mid-write leaves the old file; the name is its own, so two writes never share one.
async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(temp, filePath);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

// One file's saves land in the order they were asked for, so an older state can never be renamed over a newer one; a failed save does not hold up the next.
export function orderedWriter(filePath: string): (value: unknown) => Promise<void> {
  let last: Promise<void> = Promise.resolve();
  return (value) => {
    const written = last.then(() => writeJsonAtomic(filePath, value));
    last = written.catch(() => undefined);
    return written;
  };
}
