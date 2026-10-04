import { readFileSync } from "node:fs";

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
