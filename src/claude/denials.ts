import os from "node:os";
import path from "node:path";
import { isWithin, landingPath, samePath } from "../platform.ts";

// Shapes a turn is refused outright, approvals on or off: a guard against an accident or a careless model, not a fence against a determined one, which can spell the same thing another way.
const DENIALS = ["deletes", "writes", "force-push", "secrets", "keys", "download-run", "machine"] as const;
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

// Where a turn writes as a matter of course beside its own folder: scratch files under the temp directory, and Claude Code's own memory, plans and settings.
function ordinaryRoots(scope: DenialScope): string[] {
  return [scope.cwd, os.tmpdir(), path.join(home(), ".claude")];
}

// A link inside the folder can point anywhere, so the file a tool names is judged by where it lands. Null when the call names none.
function landingOf(scope: DenialScope, input: Record<string, unknown>): string | null {
  const filePath = text(input.file_path) || text(input.notebook_path);
  return filePath ? landingPath(path.resolve(scope.cwd, expandHome(filePath))) : null;
}

// The roots are followed the same way as what is held against them: a temp folder is itself a link on some systems and goes by a short name on others.
function landsUnder(roots: string[], landing: string): boolean {
  return underAny(roots.map(landingPath), landing);
}

// A file tool names its target outright, so where a write lands is known without reading a command. Where it lands, or null when that is somewhere a turn ordinarily writes.
function writesOutside(scope: DenialScope, toolName: string, input: Record<string, unknown>): string | null {
  if (!EDIT_TOOLS.has(toolName)) return null;
  const landing = landingOf(scope, input);
  return landing === null || landsUnder(ordinaryRoots(scope), landing) ? null : landing;
}

// ~ and the home variables, as a shell would read them, so a path is judged by where it lands.
function expandHome(token: string): string {
  return token
    .replace(/^~(?=$|[\\/])/, home())
    .replace(/^(\$HOME|\$\{HOME\}|%USERPROFILE%|\$env:USERPROFILE)(?=$|[\\/])/i, home());
}

// The words of a command as a shell splits them: a quoted path is one word whatever spaces it holds, and a redirection ends a word whether or not a space follows it.
function wordsOf(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|[^\s<>;&|()]+/g) ?? []).map((word) => expandHome(word.replace(/^["']|["']$/g, "")));
}

// A path as a shell would see it: quotes off, home expanded, judged by where it lands from the working directory.
function pathsNamed(command: string, cwd: string): string[] {
  return wordsOf(command)
    .filter((word) => /^[~$%]|[\\/]/.test(word))
    .map((word) => path.resolve(cwd, word));
}

// The shell forms of a write that a reader would call obvious: a redirection, spaced or not, or a verb that writes, copies, moves or removes.
const SHELL_WRITE =
  />|(^|[\s;&|(])(tee|cp|mv|install|chmod|chown|truncate|rm|sed\s+-[a-zA-Z]*i|Set-Content|Out-File|Add-Content|Copy-Item|Move-Item|Remove-Item)(?=\s|$)/im;

function writesProtected(command: string, scope: DenialScope): boolean {
  if (!SHELL_WRITE.test(command)) return false;
  return pathsNamed(command, scope.cwd).some((target) => underAny(protectedPaths(scope), target));
}

// A command starts a line, or follows a separator or an opening bracket, with any spaces before it. The recursive flag may come after others, short or spelled out, and each flag is read one way only: read every way it could be, a long run of them costs the square of its length. The targets end where the command does, at a separator, a redirection or the end of the line.
const RECURSIVE_DELETE =
  /(?:^|[;&|(])\s*(?:sudo\s+)?(?:rm\s+(?:-(?:-(?!recursive\b)[a-z-]+|[a-qs-z]+)\s+)*(?:-[a-qs-z]*r[a-z]*|--recursive)\s+|rmdir\s+\/s\s+|rd\s+\/s\s+|Remove-Item\s+(?=[^;&|\n]*-Recurse))([^;&|\n<>)]*)/gim;

// A recursive delete whose target is the working directory itself or anything outside it.
function deletesOutside(command: string, cwd: string): boolean {
  for (const match of command.matchAll(RECURSIVE_DELETE)) {
    const targets = wordsOf(match[1] ?? "").filter((word) => !word.startsWith("-"));
    for (const target of targets) {
      if (/^(\/\*?|[A-Za-z]:[\\/]?\*?|\*|\.\.?|\.\.[\\/].*)$/.test(target)) return true;
      const resolved = path.resolve(cwd, target.replace(/[\\/]\*$/, ""));
      if (!isWithin(cwd, resolved)) return true;
    }
  }
  return false;
}

// main or master as a push names it: bare, or as the full ref.
const MAIN = "(?:refs\\/heads\\/)?(?:main|master)";
const PUSHED_TO_MAIN = new RegExp(`^\\+?(?:[^:]*:)?${MAIN}$`);
const FORCED_OR_DELETED_MAIN = new RegExp(`^(?:\\+(?:[^:]*:)?|:)${MAIN}$`);
const NAMES_MAIN = new RegExp(`^${MAIN}$`);

// --force on a push to the main branches, or with no branch named, where the current one may be main; deleting main on the remote, by --delete or an empty source; --force-with-lease is left alone.
function forcesMain(command: string): boolean {
  for (const match of command.matchAll(/\bgit\b(?:\s+-[^\s]+(?:\s+[^\s-][^\s]*)?)*\s+push\b([^;&|\n]*)/g)) {
    const args = (match[1] ?? "").split(/\s+/).filter(Boolean);
    const forced = args.some((arg) => arg === "--force" || arg === "-f" || /^-[a-eg-zA-Z]*f/.test(arg));
    const deleting = args.some((arg) => arg === "--delete" || arg === "-d");
    const refs = args.filter((arg) => !arg.startsWith("-"));
    const named = refs.slice(1);
    if (forced && (named.length === 0 || named.some((ref) => PUSHED_TO_MAIN.test(ref)))) return true;
    if (refs.some((ref) => FORCED_OR_DELETED_MAIN.test(ref))) return true;
    if (deleting && named.some((ref) => NAMES_MAIN.test(ref))) return true;
  }
  return /git\s+branch\s+(?:-D|--delete\s+--force|-d\s+-f)\s+(main|master)\b/.test(command);
}

const DOWNLOAD_RUN =
  /\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|;&]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh|node|python3?|perl)\b/i;
const MACHINE =
  /(?:^|[;&|(])\s*(?:sudo\s+)?(?:shutdown|reboot|halt|poweroff|mkfs(?:\.\w+)?|diskpart|format(?:\.com)?|Stop-Computer|Restart-Computer)(?=[\s)]|$)|\bdd\b[^;&|\n]*\bof=\/dev\//im;
const KEY_MENTION = /(?:^|[\s"'=:\\/])\.ssh[\\/]id_[A-Za-z0-9_]+(?!\.pub)\b|\.credentials\.json\b/;

const REASONS: Record<Denial, string> = {
  deletes:
    "The bridge refused this outright: a recursive delete reaching outside the working directory. Delete inside it, or ask the person in Discord to do this by hand.",
  writes:
    "The bridge refused this outright: a file written outside the working directory by a file tool. Write inside it or under the temp directory, or ask the person in Discord to do this by hand.",
  "force-push":
    "The bridge refused this outright: a force push to main, or the deletion of it. Push to a branch, or ask the person in Discord to do this by hand.",
  secrets:
    "The bridge refused this outright: a write to where credentials or the bridge's own state live. Ask the person in Discord to change that file by hand.",
  keys: "The bridge refused this outright: a read of ~/.ssh, where private keys live, or of Claude Code's login. Nothing in a turn needs them; a public key (.pub) may be read.",
  "download-run":
    "The bridge refused this outright: a download piped straight into a shell. Download to a file, read it, then run it, or ask the person in Discord.",
  machine:
    "The bridge refused this outright: a command that would stop, restart or reformat the machine. Ask the person in Discord to do this by hand.",
};

// The rules an owner may let a single call past: a turn has to be able to remove what it made outside its folder, and at times to write there, and only a person can say that this call is that.
const ASKED_OF_AN_OWNER: ReadonlySet<Denial> = new Set(["deletes", "writes"]);

export function withoutAskable(rules: ReadonlySet<Denial>): Set<Denial> {
  return new Set([...rules].filter((rule) => !ASKED_OF_AN_OWNER.has(rule)));
}

// What an owner is asked about: the rule that caught the call, and the command or the file it caught.
export interface AskedOfOwner {
  rule: "deletes" | "writes";
  subject: string;
}

// Read takes the file it names, and Grep searches the file or folder in its path; either one pointed at ~/.ssh or the login prints what is there.
function readsKeys(scope: DenialScope, toolName: string, input: Record<string, unknown>): boolean {
  const named = toolName === "Read" ? text(input.file_path) : toolName === "Grep" ? text(input.path) : "";
  if (!named) return false;
  const landing = landingPath(path.resolve(scope.cwd, expandHome(named)));
  return landsUnder(keyFiles(), landing) && !/\.pub$/.test(landing);
}

// Null where no rule an owner is asked about is on and applies.
export function askedOfOwner(
  rules: ReadonlySet<Denial>,
  scope: DenialScope,
  toolName: string,
  input: Record<string, unknown>,
): AskedOfOwner | null {
  const command = SHELL_TOOLS.has(toolName) ? text(input.command) : "";
  if (command && rules.has("deletes") && deletesOutside(command, scope.cwd)) return { rule: "deletes", subject: command };
  const written = rules.has("writes") ? writesOutside(scope, toolName, input) : null;
  return written ? { rule: "writes", subject: written } : null;
}

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
  if (rules.has("keys") && readsKeys(scope, toolName, input)) return REASONS.keys;
  const landing = landingOf(scope, input);
  if (landing === null) return null;
  if (rules.has("secrets") && EDIT_TOOLS.has(toolName) && landsUnder(protectedPaths(scope), landing)) return REASONS.secrets;
  if (rules.has("writes") && writesOutside(scope, toolName, input)) return REASONS.writes;
  return null;
}
