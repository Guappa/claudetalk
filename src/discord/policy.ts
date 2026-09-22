import path from "node:path";
import type { Bridge } from "../bridge.ts";
import { tierFor, workspaceFor, type Tier } from "../access.ts";

export function tierOf(bridge: Bridge, userId: string): Tier {
  return tierFor(
    { ownerIds: bridge.config.ownerIds, operatorIds: bridge.operators.all() },
    userId,
  );
}

export function adHocWorkingDir(bridge: Bridge, tier: Tier, userId: string): string | null {
  if (tier === "owner") return bridge.config.projectsRoot;
  const root = bridge.config.workspacesRoot;
  return root ? workspaceFor(root, userId) : null;
}

// A workspace is where an operator's conversations live by default, not a wall around them.
export function workingDirFor(bridge: Bridge, tier: Tier, userId: string, project?: string): string {
  const root = adHocWorkingDir(bridge, tier, userId);
  if (!root) {
    throw new Error(
      "Only an owner can create conversations here. Set WORKSPACES_ROOT to give other " +
        "operators somewhere of their own to work.",
    );
  }
  if (!project?.trim()) return root;
  return path.isAbsolute(project) ? project : path.resolve(root, project);
}
