import fs from "node:fs/promises";
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

// What a turn runs with when the conversation overrides nothing is decided by the host's own settings.
export async function readHostDefaults(): Promise<HostDefaults> {
  try {
    return parseHostDefaults(await fs.readFile(claudeSettingsPath(), "utf8"));
  } catch {
    return NONE;
  }
}

export function describeDefault(override: string | undefined, hostValue: string | null): string {
  if (override) return `\`${override}\``;
  return hostValue ? `\`${hostValue}\` (host default)` : "Claude Code's default";
}
