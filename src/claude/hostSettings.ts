import fs from "node:fs/promises";
import path from "node:path";
import type { Say } from "../i18n/index.ts";
import { claudeSettingsPath } from "../platform.ts";

export interface HostDefaults {
  model: string | null;
  effort: string | null;
}

const NONE: HostDefaults = { model: null, effort: null };

export function parseHostDefaults(raw: string): HostDefaults {
  try {
    const parsed = JSON.parse(raw) as { model?: unknown; effortLevel?: unknown } | null;
    return {
      model: typeof parsed?.model === "string" ? parsed.model : null,
      effort: typeof parsed?.effortLevel === "string" ? parsed.effortLevel : null,
    };
  } catch {
    return NONE;
  }
}

async function readLayer(filePath: string): Promise<HostDefaults> {
  try {
    return parseHostDefaults(await fs.readFile(filePath, "utf8"));
  } catch {
    return NONE;
  }
}

// What a turn runs with when the conversation overrides nothing: the account's settings, with the folder's own laid over them the way Claude Code lays them.
export async function readHostDefaults(cwd: string, accountSettings: string = claudeSettingsPath()): Promise<HostDefaults> {
  const layers = [accountSettings, path.join(cwd, ".claude", "settings.json"), path.join(cwd, ".claude", "settings.local.json")];
  let defaults = NONE;
  for (const layer of layers) {
    const set = await readLayer(layer);
    defaults = { model: set.model ?? defaults.model, effort: set.effort ?? defaults.effort };
  }
  return defaults;
}

export function describeDefault(say: Say, override: string | undefined, hostValue: string | null): string {
  if (override) return `\`${override}\``;
  return hostValue ? say("settings.hostDefault", { value: hostValue }) : say("settings.claudeDefault");
}
