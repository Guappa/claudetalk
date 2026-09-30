import path from "node:path";
import { jsonLines, readTail, TAIL_BYTES } from "./transcriptTail.ts";

export interface TranscriptInfo {
  name: string | null;
  cwd: string | null;
  lastActivity: Date | null;
  hasContent: boolean;
}

const LONGEST_FOLDER_NAME = 200;

// The string hash Claude Code appends, in base 36, to a folder name it had to cut short.
function pathHash(directory: string): string {
  let hash = 0;
  for (let index = 0; index < directory.length; index += 1) hash = ((hash << 5) - hash + directory.charCodeAt(index)) | 0;
  return Math.abs(hash).toString(36);
}

// Claude Code files a session under the directory it was started in, with every character that is not a letter or a digit made a dash, and a name past its limit cut there and told apart by a hash of the whole path.
function projectFolderName(directory: string): string {
  const flat = directory.replace(/[^A-Za-z0-9]/g, "-");
  const named = flat.length <= LONGEST_FOLDER_NAME ? flat : `${flat.slice(0, LONGEST_FOLDER_NAME)}-${pathHash(directory)}`;
  return named.toLowerCase();
}

// A drive letter is stamped in either case, and the hash of a long path depends on which it was given in.
function spellings(directory: string): string[] {
  const drive = /^[A-Za-z](?=:)/.exec(directory)?.[0];
  if (!drive) return [directory];
  const other = drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase();
  return [directory, `${other}${directory.slice(1)}`];
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
      if (spellings(candidate).some((spelled) => projectFolderName(spelled) === wanted)) return candidate;
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
  for (const record of jsonLines(tail.text)) {
    if (record.type === "custom-title" && typeof record.customTitle === "string") info.name = record.customTitle;
    if (typeof record.cwd === "string" && record.cwd !== stamped.at(-1)) stamped.push(record.cwd);
    if (typeof record.timestamp === "string") info.lastActivity = new Date(record.timestamp);
    if (record.type === "user" || record.type === "assistant") info.hasContent = true;
  }
  info.cwd = startedIn(stamped, path.basename(path.dirname(filePath)));
  return info;
}
