export const DISCORD_MESSAGE_LIMIT = 2000;
const FENCE_CLOSE = "\n```";
const FENCE = /^```/;

// A chunk split inside a fence closes and reopens it, and the opener can carry a language tag.
function roomForLine(openFence: string | null, limit: number): number {
  if (!openFence) return limit - 1;
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

  const flush = (): void => {
    if (lines.length === 0) return;
    const body = lines.join("\n");
    chunks.push(openFence ? `${body}${FENCE_CLOSE}` : body);
    lines = openFence ? [openFence] : [];
    length = openFence ? openFence.length + 1 : 0;
  };

  for (const rawLine of text.split("\n")) {
    for (const line of splitOverlongLine(rawLine, roomForLine(openFence, limit))) {
      const cost = line.length + 1;
      const closing = openFence ? FENCE_CLOSE.length : 0;
      if (length + cost + closing > limit) flush();
      lines.push(line);
      length += cost;
      if (FENCE.test(line)) openFence = openFence ? null : line;
    }
  }

  // A flush that only reopened a fence leaves an empty code block, which is not worth sending.
  if (lines.length > (openFence ? 1 : 0)) flush();
  return chunks;
}
