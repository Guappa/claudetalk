import { claudeCli, parseJsonArray } from "./cli.ts";

export interface PluginRecord {
  id: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
}

function isPluginRecord(item: unknown): item is PluginRecord {
  const record = item as Partial<PluginRecord> | null;
  return typeof record?.id === "string" && typeof record.enabled === "boolean";
}

export function parsePluginList(raw: string): PluginRecord[] {
  return parseJsonArray(raw, isPluginRecord);
}

export async function listPlugins(): Promise<PluginRecord[]> {
  try {
    return parsePluginList((await claudeCli(["plugin", "list", "--json"])).stdout);
  } catch {
    return [];
  }
}

// Whatever Claude Code printed; empty when it said nothing, which leaves the caller to say it worked.
export async function setPluginEnabled(id: string, enabled: boolean): Promise<string> {
  const { stdout, stderr } = await claudeCli(["plugin", enabled ? "enable" : "disable", id]);
  return (stdout || stderr).trim();
}
