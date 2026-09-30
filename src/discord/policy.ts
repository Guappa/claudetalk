import fs from "node:fs/promises";
import path from "node:path";
import type { Bridge } from "../bridge.ts";
import { tierFor, workspaceFor, type Tier } from "../access.ts";
import { displayPath } from "../displayPath.ts";
import type { Say } from "../i18n/index.ts";
import { errorMessage } from "../text.ts";

export function tierOf(bridge: Bridge, userId: string): Tier {
  return tierFor({ ownerIds: bridge.config.ownerIds, operatorIds: bridge.operators.all() }, userId);
}

export function adHocWorkingDir(bridge: Bridge, tier: Tier, userId: string): string | null {
  if (tier === "owner") return bridge.config.projectsRoot;
  const root = bridge.config.workspacesRoot;
  return root ? workspaceFor(root, userId) : null;
}

// A workspace is where an operator's conversations live by default, not a wall around them; null when there is none to start from.
export function workingDirFor(bridge: Bridge, tier: Tier, userId: string, project?: string): string | null {
  const root = adHocWorkingDir(bridge, tier, userId);
  if (!root) return null;
  if (!project?.trim()) return root;
  return path.isAbsolute(project) ? project : path.resolve(root, project);
}

// Claude Code is spawned with this as its cwd, and a missing one fails as a bare spawn ENOENT; undefined when the folder is there.
export async function makeWorkingDir(say: Say, cwd: string): Promise<string | undefined> {
  try {
    await fs.mkdir(cwd, { recursive: true });
    return undefined;
  } catch (error) {
    return say("create.folderFailed", { cwd: displayPath(cwd), error: errorMessage(error) });
  }
}
