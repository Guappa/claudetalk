import { readFileSync } from "node:fs";

// Read rather than imported, so it is the same value whether running from src or dist.
export function bridgeVersion(): string {
  try {
    const manifest = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    return (JSON.parse(manifest) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}
