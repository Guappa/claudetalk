import fs from "node:fs/promises";

// A transcript can run to hundreds of megabytes; what a listing or a recap needs is at the end.
export const TAIL_BYTES = 3 * 1024 * 1024;

export async function readTail(transcriptPath: string, bytes: number): Promise<string | null> {
  let handle;
  try {
    handle = await fs.open(transcriptPath, "r");
  } catch {
    return null;
  }

  try {
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    if (length > 0) await handle.read(buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

// A tail starts mid-record, so the first line is usually a fragment and is skipped like any other bad line.
export function* jsonLines(text: string): Generator<Record<string, unknown>> {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      yield JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
}
