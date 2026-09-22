import { spawnSync } from "node:child_process";
import { resolveClaudeBin } from "../platform.ts";

export interface AuthStatus {
  loggedIn: boolean;
  subscriptionType?: string;
}

// Anything but a clear "no" reads as unknown, so a changed output can never keep the bridge down.
export function parseAuthStatus(output: string): AuthStatus | null {
  try {
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as { loggedIn?: unknown; subscriptionType?: unknown };
    if (typeof record.loggedIn !== "boolean") return null;
    return {
      loggedIn: record.loggedIn,
      subscriptionType: typeof record.subscriptionType === "string" ? record.subscriptionType : undefined,
    };
  } catch {
    return null;
  }
}

export function readAuthStatus(): AuthStatus | null {
  const result = spawnSync(resolveClaudeBin(), ["auth", "status", "--json"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 15_000,
  });
  if (result.error || typeof result.stdout !== "string") return null;
  return parseAuthStatus(result.stdout);
}

export const SIGNED_OUT =
  "Claude Code is signed out, so every turn would fail as soon as anyone sent one. " +
  "Run `claude auth login` as the account this bridge runs as, then start it again.";
