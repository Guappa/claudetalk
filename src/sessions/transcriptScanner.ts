import path from "node:path";
import { jsonLines, readTail, TAIL_BYTES } from "./transcriptTail.ts";

export interface TranscriptInfo {
  name: string | null;
  cwd: string | null;
  lastActivity: Date | null;
  hasContent: boolean;
}

// Claude Code files a session under the directory it was started in, with every character that is not a letter or a digit made a dash.
function projectFolderName(directory: string): string {
  return directory.replace(/[^A-Za-z0-9]/g, "-").toLowerCase();
}

// Either separator, so a transcript written on Windows reads the same wherever the bridge runs.
function parentOf(directory: string): string {
  return directory.replace(/[\\/]+[^\\/]*$/, "");
}

// Each record is stamped with where the shell stood, which moves with every `cd`; the session belongs to the directory its folder is named after.
function startedIn(stamped: string[], projectFolder: string): string | null {
  const wanted = projectFolder.toLowerCase();
  for (const stamp of stamped.toReversed()) {
    for (let candidate = stamp; candidate; candidate = parentOf(candidate)) {
      if (projectFolderName(candidate) === wanted) return candidate;
      if (parentOf(candidate) === candidate) break;
    }
  }
  return stamped.at(-1) ?? null;
}

export async function scanTranscript(filePath: string): Promise<TranscriptInfo> {
  const info: TranscriptInfo = { name: null, cwd: null, lastActivity: null, hasContent: false };
  const tail = await readTail(filePath, TAIL_BYTES);
  if (tail === null) return info;

  const stamped: string[] = [];
  for (const record of jsonLines(tail)) {
    if (record.type === "custom-title" && typeof record.customTitle === "string") info.name = record.customTitle;
    if (typeof record.cwd === "string" && record.cwd !== stamped.at(-1)) stamped.push(record.cwd);
    if (typeof record.timestamp === "string") info.lastActivity = new Date(record.timestamp);
    if (record.type === "user" || record.type === "assistant") info.hasContent = true;
  }
  info.cwd = startedIn(stamped, path.basename(path.dirname(filePath)));
  return info;
}
