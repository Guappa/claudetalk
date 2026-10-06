import { spawnSync } from "node:child_process";
import { bundledClaudeBin, resolveClaudeBin, sameExecutable } from "../platform.ts";

// Turns run on the build the Agent SDK ships; the host's own claude does the side jobs. Both read the same transcripts, so a difference is worth knowing after an update.
export interface ClaudeVersions {
  bundled: string | null;
  host: string | null;
  // No claude is installed on the host, so the SDK's build does the side jobs too.
  hostIsBundled: boolean;
}

// "2.1.285 (Claude Code)" is what --version prints; anything else reads as unknown, never as a reason not to start.
export function parseVersion(output: string): string | null {
  const match = /^\s*(\d+\.\d+\.\d+\S*)/.exec(output);
  return match ? match[1]! : null;
}

function versionOf(bin: string | null): string | null {
  if (!bin) return null;
  const result = spawnSync(bin, ["--version"], { encoding: "utf8", shell: false, windowsHide: true, timeout: 15_000 });
  return result.error || typeof result.stdout !== "string" ? null : parseVersion(result.stdout);
}

export function readClaudeVersions(): ClaudeVersions {
  const bundledBin = bundledClaudeBin();
  const hostBin = resolveClaudeBin();
  return { bundled: versionOf(bundledBin), host: versionOf(hostBin), hostIsBundled: sameExecutable(hostBin, bundledBin) };
}

// For the host log: which Claude Code runs turns, which does the listings, and whether they agree.
export function describeClaudeVersions(versions: ClaudeVersions): string {
  const bundled = versions.bundled ?? "unknown";
  const host = versions.host ?? "unknown";
  if (versions.hostIsBundled)
    return `Claude Code ${bundled}, the SDK's build, which does the listings too: no other claude was found.`;
  if (versions.bundled && versions.bundled === versions.host) return `Claude Code ${bundled}, the SDK's build and the host's.`;
  return (
    `Claude Code ${bundled} in the SDK (turns run on it), ${host} on the host (session listings). ` +
    "They differ; if resuming or listing breaks after an update, this is the first thing to check, and npm run test:integration proves a turn."
  );
}
