import type { SessionRecord } from "./index.ts";
import { displayName } from "./displayName.ts";
import { samePath } from "../platform.ts";
import { fromChannelName, toChannelName } from "../discord/channelName.ts";

export type Resolution =
  | { match: SessionRecord; shadowed: SessionRecord[] }
  | { match: null; candidates: SessionRecord[] };

export function byRecencyDesc(left: SessionRecord, right: SessionRecord): number {
  return (right.lastActivity?.getTime() ?? 0) - (left.lastActivity?.getTime() ?? 0);
}

export function resolveByName(records: SessionRecord[], query: string): Resolution {
  const needle = query.trim().toLowerCase();
  if (!needle) return { match: null, candidates: [] };

  const labelled = records.map((record) => ({ record, label: displayName(record).toLowerCase() }));

  const exact = labelled.filter((entry) => entry.label === needle).map((entry) => entry.record).sort(byRecencyDesc);
  if (exact[0]) return { match: exact[0], shadowed: exact.slice(1) };

  const matching = labelled.filter((entry) => entry.label.startsWith(needle));
  const prefixed = matching.map((entry) => entry.record);
  const distinctNames = new Set(matching.map((entry) => entry.label));
  if (distinctNames.size === 1) {
    const sorted = prefixed.sort(byRecencyDesc);
    if (sorted[0]) return { match: sorted[0], shadowed: sorted.slice(1) };
  }

  return { match: null, candidates: prefixed };
}

// A channel name is a slug, and un-slugging loses hyphens, so the names are compared as slugs first.
export function resolveByChannelName(records: SessionRecord[], channelName: string): Resolution {
  const wanted = channelName.toLowerCase();
  const slugged = records.filter((record) => toChannelName(displayName(record)) === wanted).sort(byRecencyDesc);
  if (slugged[0]) return { match: slugged[0], shadowed: slugged.slice(1) };
  return resolveByName(records, fromChannelName(channelName));
}

export function resolveByFolder(records: SessionRecord[], cwd: string): SessionRecord[] {
  return records.filter((record) => record.cwd && samePath(record.cwd, cwd)).sort(byRecencyDesc);
}
