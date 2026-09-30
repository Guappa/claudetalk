export const DISCORD_MESSAGE_LIMIT = 2000;
// A fence is a run of three or more backticks at the start of a line, and what follows on the line that opens one is its language tag.
const FENCE = /^\s*(`{3,})(.*)$/;
// A language tag is one short word; anything longer after the backticks is content that happens to sit on the opening line.
const LANGUAGE = /^[\w+#.-]{1,20}$/;

const MARKER = /^`+/;

function markerOf(opener: string): string {
  return MARKER.exec(opener)![0];
}

// The fence left open once this line has been read, given the one open before it, as the opener a later chunk reopens with. Only a line holding nothing but at least as many backticks closes a fence, so a shorter one quoted inside it is content.
export function fenceAfter(open: string | null, line: string): string | null {
  const found = FENCE.exec(line);
  if (open !== null) {
    const closes = found !== null && found[1]!.length >= markerOf(open).length && found[2]!.trim() === "";
    return closes ? null : open;
  }
  // A line that opens and closes its own block leaves nothing open.
  if (!found || found[2]!.includes("```")) return null;
  const tag = found[2]!.trim();
  return LANGUAGE.test(tag) ? `${found[1]}${tag}` : found[1]!;
}

function closing(opener: string): string {
  return `\n${markerOf(opener)}`;
}

// A chunk split inside a fence closes and reopens it, so a line in one, or a line that opens one, is cut to what is left beside both.
function roomForLine(open: string | null, line: string, limit: number): number {
  const opener = open ?? fenceAfter(null, line);
  if (opener === null) return limit;
  return limit - closing(opener).length - opener.length - 1;
}

function splitOverlongLine(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  // A room of nothing would never advance, and the loop would run until memory did.
  const step = Math.max(max, 1);
  const pieces: string[] = [];
  for (let start = 0; start < line.length; start += step) {
    pieces.push(line.slice(start, start + step));
  }
  return pieces;
}

// Nothing to say is no chunks at all; what stands in for an empty answer is the caller's to word.
export function chunkForDiscord(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  if (!text.trim()) return [];

  const chunks: string[] = [];
  let lines: string[] = [];
  let length = 0;
  let open: string | null = null;
  // Where in the chunk being built its open fence starts; a chunk that would end on that line gives it to the next one whole.
  let fenceAt = -1;

  const flush = (): void => {
    // An opening line that fills a chunk by itself is sent, not held back: carried whole it would leave the next line no room.
    const endsOnOpener = open !== null && fenceAt === lines.length - 1 && (lines.length > 1 || lines[0] === open);
    const body = endsOnOpener ? lines.slice(0, -1) : lines;
    if (body.length > 0) chunks.push(open !== null && !endsOnOpener ? `${body.join("\n")}${closing(open)}` : body.join("\n"));
    // The line that opened the fence moves on as it was written; a fence carried past it is reopened by its marker and tag alone.
    const carried = endsOnOpener ? lines.at(-1)! : open;
    lines = carried !== null ? [carried] : [];
    length = carried !== null ? carried.length + 1 : 0;
    fenceAt = carried !== null ? 0 : -1;
  };

  for (const rawLine of text.split("\n")) {
    for (const line of splitOverlongLine(rawLine, roomForLine(open, rawLine, limit))) {
      const after = fenceAfter(open, line);
      // Room is kept for the closing fence on every line added while one is open, so closing the chunk never pushes it over.
      const needed = line.length + (after !== null ? closing(after).length : 0);
      // A second flush is for an opening line held back by the first, which may still be too long to share a chunk.
      for (let flushes = 0; flushes < 2 && length + needed > limit; flushes += 1) flush();
      lines.push(line);
      length += line.length + 1;
      if (open === null && after !== null) fenceAt = lines.length - 1;
      else if (after === null) fenceAt = -1;
      open = after;
    }
  }

  // A last chunk that is only a fence carried over is an empty code block, which is not worth sending.
  const onlyCarried = open !== null && lines.length === 1 && chunks.length > 0;
  if (lines.length > 0 && !onlyCarried) chunks.push(open !== null ? `${lines.join("\n")}${closing(open)}` : lines.join("\n"));
  return chunks;
}
