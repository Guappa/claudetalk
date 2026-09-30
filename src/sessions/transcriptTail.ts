import fs from "node:fs/promises";

// A transcript can run to hundreds of megabytes; what a listing or a recap needs is at the end.
export const TAIL_BYTES = 3 * 1024 * 1024;
// As far as a tail is widened in search of a whole record; past this the file is not read any further back.
const WIDEST_TAIL_BYTES = 48 * 1024 * 1024;

export interface Tail {
  text: string;
  // True when the tail is the whole file, so nothing older was left unread.
  fromStart: boolean;
}

// Claude Code ends a transcript with lines of its own bookkeeping, a title or a cost, so a whole line is not yet a whole message.
function holdsAMessage(text: string): boolean {
  const firstBreak = text.indexOf("\n");
  return firstBreak !== -1 && /"type":\s*"(?:user|assistant)"/.test(text.slice(firstBreak));
}

// One record can be larger than the window asked for, a pasted image for one, and a tail that starts inside it would read as an empty transcript, so it is widened until it holds a message whole.
export async function readTail(transcriptPath: string, bytes: number): Promise<Tail | null> {
  const handle = await fs.open(transcriptPath, "r").catch(() => null);
  if (!handle) return null;

  try {
    const { size } = await handle.stat();
    for (let width = bytes; ; width *= 4) {
      const length = Math.min(size, width);
      const buffer = Buffer.alloc(length);
      if (length > 0) await handle.read(buffer, 0, length, size - length);
      const tail = { text: buffer.toString("utf8"), fromStart: length === size };
      if (tail.fromStart || width >= WIDEST_TAIL_BYTES || holdsAMessage(tail.text)) return tail;
    }
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
