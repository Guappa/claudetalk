import { jsonLines, readTail, TAIL_BYTES } from "./transcriptTail.ts";

const CEILING_TAIL_BYTES = 16 * 1024 * 1024;

// Records Claude Code injects itself, which were never typed by a person.
const INJECTED_FLAGS = ["isMeta", "isSynthetic", "isCompactSummary", "isSidechain", "isReplay"];

// Slash commands, shell escapes and hook output are stored as user messages wrapped in these.
const PLUMBING = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|task-notification|system-reminder|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook)>/;

export interface Exchange {
  at: Date;
  role: "user" | "assistant";
  text: string;
}

interface TranscriptBlock {
  type: string;
  text?: string;
}

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;

  const blocks = content as TranscriptBlock[];
  if (blocks.some((block) => block.type === "tool_result" || block.type === "tool_use")) return null;

  const text = blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
  return text || null;
}

export async function readExchanges(transcriptPath: string, since?: Date): Promise<Exchange[]> {
  const tail = await readTail(transcriptPath, TAIL_BYTES);
  if (tail === null) return [];

  const exchanges: Exchange[] = [];
  for (const record of jsonLines(tail)) {
    if (record.type !== "user" && record.type !== "assistant") continue;
    if (INJECTED_FLAGS.some((flag) => record[flag])) continue;
    if (typeof record.timestamp !== "string") continue;

    const message = record.message as { content?: unknown } | undefined;
    const text = textOf(message?.content);
    if (!text || PLUMBING.test(text)) continue;

    const at = new Date(record.timestamp);
    if (since && at <= since) continue;
    exchanges.push({ at, role: record.type, text });
  }
  return exchanges;
}

export async function lastExchanges(transcriptPath: string, count: number): Promise<Exchange[]> {
  const all = await readExchanges(transcriptPath);
  return all.slice(-count);
}

// Transcripts spell this compactMetadata.preTokens; the stream spells it compact_metadata.pre_tokens.
export async function lastCompactionCeiling(transcriptPath: string): Promise<number | null> {
  const tail = await readTail(transcriptPath, CEILING_TAIL_BYTES);
  if (tail === null) return null;

  let ceiling: number | null = null;
  for (const record of jsonLines(tail)) {
    const metadata = record.compactMetadata as { trigger?: string; preTokens?: number } | undefined;
    // Only an automatic compaction marks where the session fills up; a manual one marks where someone asked.
    if (metadata?.trigger !== "auto") continue;
    if (typeof metadata.preTokens === "number" && metadata.preTokens > 0) {
      ceiling = Math.max(ceiling ?? 0, metadata.preTokens);
    }
  }
  return ceiling;
}
