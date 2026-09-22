import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveClaudeBin } from "../platform.ts";

const execFileAsync = promisify(execFile);
// A plugin or agent listing is small; the cap only stops a runaway process from being buffered whole.
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export async function claudeCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync(resolveClaudeBin(), args, { maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true });
}

// CLI output is a boundary: anything but a JSON array of objects reads as an empty list.
export function parseJsonArray<T>(raw: string, isRecord: (item: unknown) => item is T): T[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}
