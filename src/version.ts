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

// Null where git has no answer: the code is not a clone, as in the image, or git is not installed.
function git(args: string[]): string | null {
  const result = spawnSync("git", args, {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 5_000,
  });
  return result.error || result.status !== 0 ? null : result.stdout.trim();
}

// On the tagged release the version says which code this is. Anywhere else it does not: fixes land on main between tags without moving it, so the commit is named beside it.
export function buildName(version: string, tagAtHead: string | null, commit: string | null): string {
  if (tagAtHead === `v${version}` || !commit || !/^[0-9a-f]{7,40}$/.test(commit)) return version;
  return `${version} (${commit})`;
}

export function describeBuild(): string {
  return buildName(bridgeVersion(), git(["describe", "--tags", "--exact-match", "HEAD"]), git(["rev-parse", "--short", "HEAD"]));
}
