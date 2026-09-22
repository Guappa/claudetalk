import type { SessionRecord } from "../../sessions/index.ts";
import { displayPath } from "../../displayPath.ts";
import { displayName } from "../../sessions/displayName.ts";
import { isWithin, longTmpDir } from "../../platform.ts";
import { byRecencyDesc } from "../../sessions/resolve.ts";
import { count } from "../../text.ts";

const MAX_LISTED = 25;
const CHOICE_LABEL_LIMIT = 100;
const SHORT_ID_CHARS = 8;

// Untitled conversations are all named after their folder, so the id is what tells them apart.
function tagFor(record: SessionRecord): string {
  return record.name ? "" : ` ${record.sessionId.slice(0, SHORT_ID_CHARS)}`;
}

export function humanSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function humanAge(at: Date | null, now = new Date()): string {
  if (!at) return "unknown";
  const minutes = Math.round((now.getTime() - at.getTime()) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (60 * 24))}d ago`;
}

// Probes and scratch runs live under the temp folder and bury real work in a picker.
export function withoutScratch(records: SessionRecord[]): { shown: SessionRecord[]; hidden: number } {
  const temp = longTmpDir();
  const shown = records.filter((record) => !record.cwd || !isWithin(temp, record.cwd));
  return { shown, hidden: records.length - shown.length };
}

export function describeHidden(hidden: number): string {
  if (hidden === 0) return "";
  const noun = `${count(hidden, "conversation")} in the temp folder ${hidden === 1 ? "is" : "are"}`;
  return `\n\n${noun} left out. Pass a filter to include ${hidden === 1 ? "it" : "them"}.`;
}

// Conversations sharing a name are the same folder's, and the newest is nearly always the one meant.
export function newestPerName(records: SessionRecord[]): Array<[SessionRecord, number]> {
  const byName = new Map<string, SessionRecord[]>();
  for (const record of records) {
    const key = displayName(record).toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), record]);
  }

  return [...byName.values()]
    .map((group) => {
      const sorted = group.slice().sort(byRecencyDesc);
      return [sorted[0]!, sorted.length - 1] as [SessionRecord, number];
    })
    .sort(([left], [right]) => byRecencyDesc(left, right));
}

// The session id is the value because several conversations can share a name.
export function sessionChoice(record: SessionRecord, older = 0): { name: string; value: string } {
  const olderTag = older > 0 ? ` · +${older} older` : "";
  const suffix = `${tagFor(record)} · ${humanSize(record.sizeBytes)} · ${humanAge(record.lastActivity)}${olderTag}`;
  const room = CHOICE_LABEL_LIMIT - suffix.length;
  const name = displayName(record).slice(0, Math.max(room, 1));
  return { name: `${name}${suffix}`.slice(0, CHOICE_LABEL_LIMIT), value: record.sessionId };
}

export function formatSessionList(records: SessionRecord[]): string {
  if (records.length === 0) return "No conversations found yet. Start one with `/create <name>`.";

  return records
    .slice()
    .sort(byRecencyDesc)
    .slice(0, MAX_LISTED)
    .map((record) => {
      const when = record.lastActivity
        ? record.lastActivity.toISOString().slice(0, 16).replace("T", " ")
        : "unknown";
      const live = record.live ? ` · live (${record.live.kind}, ${record.live.status ?? "starting"})` : "";
      return `**${displayName(record)}**${tagFor(record)} · ${humanSize(record.sizeBytes)} · ${record.cwd ? displayPath(record.cwd) : "?"} · ${when}${live}`;
    })
    .join("\n");
}
