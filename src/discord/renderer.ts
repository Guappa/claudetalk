export const DISCORD_MESSAGE_LIMIT = 2000;
const FENCE_CLOSE = "\n```";
// A fence opens on a line that starts with three backticks and does not also end its block; only a line of backticks alone closes it, so a fence quoted inside one is content.
const OPENS = /^\s*```(?!.*```)/;
const CLOSES = /^\s*```\s*$/;

// A chunk split inside a fence closes and reopens it, and the opener can carry a language tag.
function roomForLine(openFence: string | null, limit: number): number {
  if (openFence === null) return limit;
  return limit - FENCE_CLOSE.length - openFence.length - 1;
}

function splitOverlongLine(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const pieces: string[] = [];
  for (let start = 0; start < line.length; start += max) {
    pieces.push(line.slice(start, start + max));
  }
  return pieces;
}

// Nothing to say is no chunks at all; what stands in for an empty answer is the caller's to word.
export function chunkForDiscord(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  if (!text.trim()) return [];

  const chunks: string[] = [];
  let lines: string[] = [];
  let length = 0;
  let openFence: string | null = null;
  // Where in the chunk being built its open fence starts; a chunk that would end on that line gives it to the next one whole.
  let fenceAt = -1;

  const flush = (): void => {
    const endsOnOpener = openFence !== null && fenceAt === lines.length - 1;
    const body = endsOnOpener ? lines.slice(0, -1) : lines;
    if (body.length > 0) chunks.push(openFence !== null && !endsOnOpener ? `${body.join("\n")}${FENCE_CLOSE}` : body.join("\n"));
    lines = openFence !== null ? [openFence] : [];
    length = openFence !== null ? openFence.length + 1 : 0;
    fenceAt = openFence !== null ? 0 : -1;
  };

  for (const rawLine of text.split("\n")) {
    for (const line of splitOverlongLine(rawLine, roomForLine(openFence, limit))) {
      const staysOpen = openFence !== null ? !CLOSES.test(line) : OPENS.test(line);
      // Room is kept for the closing fence on every line added while one is open, so closing the chunk never pushes it over.
      if (length + line.length + (staysOpen ? FENCE_CLOSE.length : 0) > limit) flush();
      lines.push(line);
      length += line.length + 1;
      if (openFence === null && staysOpen) {
        openFence = line;
        fenceAt = lines.length - 1;
      } else if (openFence !== null && !staysOpen) {
        openFence = null;
        fenceAt = -1;
      }
    }
  }

  // A last chunk that is only a fence carried over is an empty code block, which is not worth sending.
  const onlyCarried = openFence !== null && lines.length === 1 && chunks.length > 0;
  if (lines.length > 0 && !onlyCarried) chunks.push(openFence !== null ? `${lines.join("\n")}${FENCE_CLOSE}` : lines.join("\n"));
  return chunks;
}
