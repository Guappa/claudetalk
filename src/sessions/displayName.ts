import type { SessionRecord } from "./index.ts";
import { displayPath } from "../displayPath.ts";

// Most conversations are never given a title, so the folder they work in names them instead.
export function displayName(record: SessionRecord): string {
  if (record.name) return record.name;
  if (!record.cwd) return "(untitled)";
  // Via displayPath, so a conversation working in the home folder cannot name its owner.
  const shown = displayPath(record.cwd);
  if (shown === "~") return "home";
  return shown.split(/[\\/]/).filter(Boolean).pop() ?? shown;
}
