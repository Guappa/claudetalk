import { spawn } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Real executables come first because Node cannot spawn .cmd/.bat without a shell (CVE-2024-27980).
const WINDOWS_EXTENSIONS = [".exe", ".com", ".cmd", ".bat"];
const UNSPAWNABLE_EXTENSIONS = [".cmd", ".bat"];

function findOnPath(command: string, env: NodeJS.ProcessEnv): string | null {
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? WINDOWS_EXTENSIONS : [""];

  for (const extension of extensions) {
    for (const dir of dirs) {
      const candidate = path.join(dir, command + extension);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function resolveClaudeBin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  return findOnPath("claude", env) ?? "claude";
}

export function assertSpawnable(bin: string): void {
  if (process.platform !== "win32") return;
  if (!UNSPAWNABLE_EXTENSIONS.includes(path.extname(bin).toLowerCase())) return;

  throw new Error(
    `The only claude on PATH is a script shim (${bin}), which Node cannot start directly on Windows. ` +
      `Set CLAUDE_BIN in .env to the real executable, usually ` +
      `${path.join(os.homedir(), ".local", "bin", "claude.exe")}.`,
  );
}

export function claudeProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export function claudeSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

// Restricted mode rejects 8.3 short names as suspicious, and os.tmpdir() returns one on Windows.
export function longTmpDir(): string {
  try {
    return realpathSync.native(os.tmpdir());
  } catch {
    return os.tmpdir();
  }
}

// Only a NAME~1 segment is expanded: resolving every path would also rewrite a symlink a project relies on.
export function expandShortPath(target: string): string {
  if (process.platform !== "win32" || !/~\d+(?=[\\/]|$)/.test(target)) return target;
  try {
    return realpathSync.native(target);
  } catch {
    return target;
  }
}

export function isWithin(parent: string, target: string): boolean {
  const fold = (value: string): string => (process.platform === "linux" ? value : value.toLowerCase());
  const relative = path.relative(fold(path.resolve(parent)), fold(path.resolve(target)));
  if (relative === "" || path.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

// POSIX shares one temp directory between every account, so the uid keeps the roots from colliding.
export function attachmentsRoot(): string {
  const owner = process.getuid ? `-${process.getuid()}` : "";
  return path.join(longTmpDir(), `claudetalk-attachments${owner}`);
}

// Windows and macOS both hold one folder under many spellings; only Linux treats case as identity.
export function samePath(left: string, right: string): boolean {
  const leftResolved = path.resolve(left);
  const rightResolved = path.resolve(right);
  if (process.platform === "linux") return leftResolved === rightResolved;
  return leftResolved.toLowerCase() === rightResolved.toLowerCase();
}

// A turn's own children keep running when only the turn is killed, so a stop has to take the tree.
export function killTree(pid: number): void {
  if (process.platform === "win32") {
    // taskkill can take seconds, and holding the event loop that long leaves a button press unanswered.
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.on("error", () => undefined);
    killer.unref();
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
}

// Only POSIX gets its own process group: on Windows that would give the child a console of its own.
type SpawnStdio = ["pipe", "pipe", "pipe"];

export function turnSpawnOptions(
  cwd: string,
): { cwd: string; shell: false; stdio: SpawnStdio; detached?: boolean } {
  // The SDK writes the prompt and its control messages over stdin, so all three are pipes.
  const stdio: SpawnStdio = ["pipe", "pipe", "pipe"];
  if (process.platform === "win32") return { cwd, shell: false, stdio };
  return { cwd, shell: false, stdio, detached: true };
}
