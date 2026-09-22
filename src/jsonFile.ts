import fs from "node:fs/promises";
import path from "node:path";

// A missing or unreadable file is the empty state, since the first run has nothing to load.
export async function readJsonOr<T>(filePath: string, fallback: () => T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback();
  }
}

// Written beside and renamed over, so a crash mid-write leaves the old file rather than half of the new one.
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temp, filePath);
}
