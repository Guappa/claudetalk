import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Manifest {
  version?: string;
  repository?: { url?: string };
}

// Read rather than imported, so it is the same value whether running from src or dist.
function manifest(): Manifest {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Manifest;
  } catch {
    return {};
  }
}

export function bridgeVersion(): string {
  return manifest().version ?? "unknown";
}

// Where this copy's versions are tagged, which for a fork is the fork.
export function bridgeRepository(): string | undefined {
  return manifest().repository?.url;
}

// The commit a clone stands on, which tells two builds of one version apart; null where the code is not a clone, as in the image.
function bridgeCommit(): string | null {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 5_000,
  });
  const commit = result.error || result.status !== 0 ? "" : result.stdout.trim();
  return /^[0-9a-f]{7,40}$/.test(commit) ? commit : null;
}

// The version as a start names it, with the commit beside it where there is one.
export function describeBuild(): string {
  const commit = bridgeCommit();
  return commit ? `${bridgeVersion()} (${commit})` : bridgeVersion();
}
