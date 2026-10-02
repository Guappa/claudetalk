import os from "node:os";
import path from "node:path";
import { isWithin, samePath } from "../platform.ts";

// Shapes a turn is refused outright, approvals on or off: a guard against an accident or a careless model, not a fence against a determined one, which can spell the same thing another way.
const DENIALS = ["deletes", "force-push", "secrets", "keys", "download-run", "machine"] as const;
export type Denial = (typeof DENIALS)[number];

export function parseDenials(value: string | undefined): Set<Denial> {
  const given = value?.trim() || DENIALS.join(",");
  if (given === "none") return new Set();
  const names = given.split(",").map((name) => name.trim());
  const unknown = names.filter((name) => !DENIALS.includes(name as Denial));
  if (unknown.length > 0) {
    throw new Error(
      `TOOL_DENIALS names "${unknown.join('", "')}", which is not a rule. Use any of ${DENIALS.join(", ")}, or none. Set it in .env, then restart the bridge.`,
    );
  }
  return new Set(names as Denial[]);
}

// What the turn works in, and what no turn may write however it is reached.
export interface DenialScope {
  cwd: string;
  dataDir: string;
}

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function home(): string {
  return os.homedir();
}

function keyFiles(): string[] {
  return [path.join(home(), ".ssh"), path.join(home(), ".claude", ".credentials.json")];
}

function protectedPaths(scope: DenialScope): string[] {
  return [scope.dataDir, path.join(process.cwd(), ".env"), ...keyFiles()];
}

function underAny(roots: string[], target: string): boolean {
  return roots.some((root) => samePath(root, target) || isWithin(root, target));
}

// ~ and the home variables, as a shell would read them, so a path is judged by where it lands.
function expandHome(token: string): string {
  return token
    .replace(/^~(?=$|[\\/])/, home())
    .replace(/^(\$HOME|\$\{HOME\}|%USERPROFILE%|\$env:USERPROFILE)(?=$|[\\/])/i, home());
}

// A path as a shell would see it: quotes off, home expanded, judged by where it lands from the working directory.
function pathsNamed(command: string, cwd: string): string[] {
  return command
    .split(/\s+/)
    .map((token) => expandHome(token.replace(/^["']|["']$/g, "")))
    .filter((token) => /^[~$%]|[\\/]/.test(token))
    .map((token) => path.resolve(cwd, token));
}

// The shell forms of a write that a reader would call obvious: a redirection, or a verb that writes, copies, moves or removes.
const SHELL_WRITE =
  /(^|[\s;&|])(>>?|tee|cp|mv|install|chmod|chown|truncate|rm|sed\s+-[a-zA-Z]*i|Set-Content|Out-File|Add-Content|Copy-Item|Move-Item|Remove-Item)(?=[\s]|$)/i;

function writesProtected(command: string, scope: DenialScope): boolean {
  if (!SHELL_WRITE.test(command)) return false;
  return pathsNamed(command, scope.cwd).some((target) => underAny(protectedPaths(scope), target));
}

const RECURSIVE_DELETE =
  /(?:^|[;&|]\s*)(?:sudo\s+)?(?:rm\s+(?:-[a-zA-Z]*r[a-zA-Z]*\s+)+|rmdir\s+\/s\s+|rd\s+\/s\s+|Remove-Item\s+(?=[^;&|]*-Recurse))([^;&|]*)/gi;

// A recursive delete whose target is the working directory itself or anything outside it.
function deletesOutside(command: string, cwd: string): boolean {
  for (const match of command.matchAll(RECURSIVE_DELETE)) {
    const targets = (match[1] ?? "")
      .split(/\s+/)
      .filter((token) => token && !token.startsWith("-"))
      .map((token) => expandHome(token.replace(/^["']|["']$/g, "")));
    for (const target of targets) {
      if (/^(\/\*?|[A-Za-z]:[\\/]?\*?|\*|\.\.?|\.\.[\\/].*)$/.test(target)) return true;
      const resolved = path.resolve(cwd, target.replace(/[\\/]\*$/, ""));
      if (!isWithin(cwd, resolved)) return true;
    }
  }
  return false;
}

// --force on a push to the main branches, or with no branch named, where the current one may be main; --force-with-lease is left alone.
function forcesMain(command: string): boolean {
  for (const match of command.matchAll(/\bgit\b(?:\s+-[^\s]+(?:\s+[^\s-][^\s]*)?)*\s+push\b([^;&|]*)/g)) {
    const args = (match[1] ?? "").split(/\s+/).filter(Boolean);
    const forced = args.some((arg) => arg === "--force" || arg === "-f" || /^-[a-eg-zA-Z]*f/.test(arg));
    const refs = args.filter((arg) => !arg.startsWith("-"));
    const named = refs.slice(1);
    if (forced && (named.length === 0 || named.some((ref) => /^\+?(?:[^:]+:)?(main|master)$/.test(ref)))) return true;
    if (refs.some((ref) => /^\+(?:[^:]+:)?(main|master)$/.test(ref))) return true;
  }
  return /git\s+branch\s+(?:-D|--delete\s+--force|-d\s+-f)\s+(main|master)\b/.test(command);
}

const DOWNLOAD_RUN =
  /\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|;&]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh|node|python3?|perl)\b/i;
const MACHINE =
  /(?:^|[;&|]\s*)(?:sudo\s+)?(?:shutdown|reboot|halt|poweroff|mkfs(?:\.\w+)?|diskpart|format(?:\.com)?|Stop-Computer|Restart-Computer)(?=\s|$)|\bdd\b[^;&|]*\bof=\/dev\//i;
const KEY_MENTION = /(?:^|[\s"'=:\\/])\.ssh[\\/]id_[A-Za-z0-9_]+(?!\.pub)\b|\.credentials\.json\b/;

const REASONS: Record<Denial, string> = {
  deletes:
    "The bridge refused this outright: a recursive delete reaching outside the working directory. Delete inside it, or ask the person in Discord to do this by hand.",
  "force-push":
    "The bridge refused this outright: a force push to main, or the deletion of it. Push to a branch, or ask the person in Discord to do this by hand.",
  secrets:
    "The bridge refused this outright: a write to where credentials or the bridge's own state live. Ask the person in Discord to change that file by hand.",
  keys: "The bridge refused this outright: a read of a private key or of Claude Code's login. Nothing in a turn needs them.",
  "download-run":
    "The bridge refused this outright: a download piped straight into a shell. Download to a file, read it, then run it, or ask the person in Discord.",
  machine:
    "The bridge refused this outright: a command that would stop, restart or reformat the machine. Ask the person in Discord to do this by hand.",
};

// The reason a call is refused, for Claude to read, or null when no rule the bridge runs with applies.
export function deniedBy(
  rules: ReadonlySet<Denial>,
  scope: DenialScope,
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  const command = SHELL_TOOLS.has(toolName) ? text(input.command) : "";
  if (command) {
    if (rules.has("deletes") && deletesOutside(command, scope.cwd)) return REASONS.deletes;
    if (rules.has("force-push") && forcesMain(command)) return REASONS["force-push"];
    if (rules.has("download-run") && DOWNLOAD_RUN.test(command)) return REASONS["download-run"];
    if (rules.has("machine") && MACHINE.test(command)) return REASONS.machine;
    if (rules.has("secrets") && writesProtected(command, scope)) return REASONS.secrets;
    if (rules.has("keys") && KEY_MENTION.test(command)) return REASONS.keys;
    return null;
  }
  const filePath = text(input.file_path) || text(input.notebook_path);
  if (!filePath) return null;
  const target = path.resolve(scope.cwd, expandHome(filePath));
  if (rules.has("secrets") && EDIT_TOOLS.has(toolName) && underAny(protectedPaths(scope), target)) return REASONS.secrets;
  if (rules.has("keys") && toolName === "Read" && underAny(keyFiles(), target) && !/\.pub$/.test(target)) return REASONS.keys;
  return null;
}
