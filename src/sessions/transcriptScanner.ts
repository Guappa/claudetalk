import { jsonLines, readTail, TAIL_BYTES } from "./transcriptTail.ts";

export interface TranscriptInfo {
  name: string | null;
  cwd: string | null;
  lastActivity: Date | null;
  hasContent: boolean;
}

export async function scanTranscript(filePath: string): Promise<TranscriptInfo> {
  const info: TranscriptInfo = { name: null, cwd: null, lastActivity: null, hasContent: false };
  const tail = await readTail(filePath, TAIL_BYTES);
  if (tail === null) return info;

  for (const record of jsonLines(tail)) {
    if (record.type === "custom-title" && typeof record.customTitle === "string") info.name = record.customTitle;
    if (typeof record.cwd === "string") info.cwd = record.cwd;
    if (typeof record.timestamp === "string") info.lastActivity = new Date(record.timestamp);
    if (record.type === "user" || record.type === "assistant") info.hasContent = true;
  }
  return info;
}
