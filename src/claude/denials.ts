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

// Every word as the path a shell would hand on: quotes off, home expanded, and a bare name a file in the working directory.
function pathsNamed(command: string, cwd: string): string[] {
  return [...new Set(wordsOf(command))].map((word) => path.resolve(cwd, word));
}

const SHELLS = String.raw`(?<![\w.-])(?:sh|bash|zsh|dash|ksh|fish|su|pwsh|powershell|cmd)(?:\.exe)?`;
// A shell handed a command to run, after its flags and their values, or eval and its PowerShell kin. A flag's value can be any word, so the flags are capped: unbounded, each shell name would read on to the end of the line.
const RUNNER = String.raw`(?:${SHELLS}(?:[ \t]+[-\/][\w-]+(?:[ \t]+(?![-\/"'])[\w.-]+)?){0,8}?[ \t]+(?:-[a-z]*c|\/c|-Command)|(?<![\w.-])(?:eval|iex|Invoke-Expression))[ \t]+`;
// A closed double quote honours \"; a quote never closed ends with its line, as a reader would take it, so one apostrophe cannot hide the lines below.
const QUOTED = String.raw`(?<!\\)(?:"(?:[^"\\]|\\[^])*"|'[^']*'|["'][^\n]*)`;
// A heredoc's body runs to the line holding its tag alone, or to the end; it is text unless a shell is the one reading it. A tag starts with a letter, so the shift in $((1<<3)) opens none.
const HEREDOC = String.raw`(?<feed>${SHELLS}(?:[ \t]+[-\/][\w-]+){0,8}[ \t]*)?(?<!<)<<(?!<)-?[ \t]*(?<tagQuote>["']?)(?<tag>[A-Za-z_]\w*)\k<tagQuote>[^\n]*(?<body>\n[^]*?(?:\n[ \t]*\k<tag>(?=\r?\n|\r?$)|$))?`;
const COMMENT = String.raw`(?<![^\s;&|(])#[^\n]*`;
const NOT_A_COMMAND = new RegExp(`(?<runner>${RUNNER})?(?<quoted>${QUOTED})|${HEREDOC}|(?<comment>${COMMENT})`, "gi");

const blank = (text: string): string => " ".repeat(text.length);
// A shell inside a shell is read again, and a hook that throws lets the call run, so the depth read is capped well short of the stack.
const MAX_NESTING = 8;

// Inside double quotes the shell still runs $(...) and backticks, so those stay readable, the $ dropped so the bracket starts a command.
function keepSubstitutions(text: string): string {
  return text.replace(/\$\([^()]*\)?|`[^`]*`?|[^$`]+|[$`]/g, (part) =>
    part.startsWith("$(") ? ` ${part.slice(1)}` : part.startsWith("`") ? part : blank(part),
  );
}

// Quoted text, a comment and a heredoc's body are arguments, not commands: each is blanked to spaces of the same length before a rule looks for where a command starts, so a commit message that says "then shutdown" refuses nothing. What a shell is handed to run is kept and read the same way, its opening quote standing for a separator.
function blankQuoted(command: string, depth = 0): string {
  if (depth > MAX_NESTING) return blank(command);
  return command.replace(NOT_A_COMMAND, (...args: unknown[]) => {
    const whole = args[0] as string;
    const found = args.at(-1) as Record<string, string | undefined>;
    if (found.comment !== undefined) return blank(whole);
    if (found.tag !== undefined) {
      const body = found.body ?? "";
      const head = whole.slice(0, whole.length - body.length);
      return `${head}${found.feed !== undefined ? blankQuoted(body, depth + 1) : blank(body)}`;
    }
    const quoted = found.quoted ?? "";
    if (found.runner !== undefined) return `${found.runner};${blankQuoted(quoted.slice(1), depth + 1)}`;
    return `${quoted[0]}${quoted[0] === '"' ? keepSubstitutions(quoted.slice(1)) : blank(quoted.slice(1))}`;
  });
}

// The original text of a span found in the blanked one, which has the same length.
function originalOf(command: string, match: RegExpExecArray | RegExpMatchArray, group: number): string {
  const span = match.indices?.[group];
  return span ? command.slice(span[0], span[1]) : "";
}

// The shell forms of a write that a reader would call obvious: a verb that writes, copies, moves or removes, or a redirection, spaced or not.
const SHELL_WRITE_VERB =
  /(^|[\s;&|(])(tee|cp|mv|install|chmod|chown|truncate|touch|ln|rsync|rm|sed\s+-[a-zA-Z]*i\S*|Set-Content|Out-File|Add-Content|Clear-Content|New-Item|Copy-Item|Move-Item|Rename-Item|Remove-Item)(?=\s|$)/im;
// A redirection writes only the word after it, so a read beside `2>/dev/null` is not a write to what it reads; `>&1` names no file.
const REDIRECTION = />>?\|?/g;
// The parts of a command that run on their own, so a verb in one says nothing about the paths in another.
const RUNS_ON_ITS_OWN = /[^;&|\n]+/dg;

function writesProtected(command: string, scope: DenialScope): boolean {
  const blanked = blankQuoted(command);
  const withVerb = [...blanked.matchAll(RUNS_ON_ITS_OWN)]
    .filter((part) => SHELL_WRITE_VERB.test(part[0]))
    .map((part) => originalOf(command, part, 0));
  const targetAt = /\s*("[^"]*"|'[^']*'|[^\s<>;&|()]+)/y;
  const redirected = [...blanked.matchAll(REDIRECTION)].map((match) => {
    targetAt.lastIndex = (match.index ?? 0) + match[0].length;
    return targetAt.exec(command)?.[1] ?? "";
  });
  const roots = protectedPaths(scope);
  return [...withVerb, ...redirected].flatMap((part) => pathsNamed(part, scope.cwd)).some((target) => underAny(roots, target));
}

// Where a command starts: a line, a separator, a bracket, brace or backtick, a shell keyword, or what runs one command inside another, then the wrappers that run what follows and a path or a backslash before its name. Only spaces and tabs may lead it, so a run of blank lines is read once.
const COMMAND_START = String.raw`(?:^|[;&|({\x60]|(?<![\w-])(?:then|do|else|xargs|-exec|\/c|-Command)(?=[ \t]))[ \t]*(?:(?:sudo|env|nohup|time|exec)[ \t]+|(?:-[\w-]|\w+=)[^\s;&|(){}\x60]*[ \t]+)*(?:\\|[^\s;&|"'(){}]*[\\/])?`;

// The recursive flag may come after others, short or spelled out, and each flag is read one way only: read every way it could be, a long run of them costs the square of its length. The targets end where the command does, at a separator, a redirection or the end of the line.
const RECURSIVE_DELETE = new RegExp(
  String.raw`${COMMAND_START}(?:rm\s+(?:-(?:-(?!recursive\b)[a-z-]+|[a-qs-z]+)\s+)*(?:-[a-qs-z]*r[a-z]*|--recursive)\s+|(?:rmdir|rd)[ \t]+(?=(?:\/[a-z][ \t]+)*\/s[ \t])(?:\/[a-z][ \t]+)+|Remove-Item(?=[^;&|\n]{0,300}?\s-r[a-z]*\b)\s+)([^;&|\n<>)}\x60]*)`,
  "dgim",
);

// A recursive delete whose target is the working directory itself or anything outside it.
function deletesOutside(command: string, cwd: string): boolean {
  for (const match of blankQuoted(command).matchAll(RECURSIVE_DELETE)) {
    const targets = [...new Set(wordsOf(originalOf(command, match, 1)))].filter((word) => !word.startsWith("-"));
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
const MACHINE = new RegExp(
  String.raw`${COMMAND_START}(?:(?:shutdown|reboot|halt|poweroff|mkfs(?:\.\w+)?|diskpart|format(?:\.com)?|Stop-Computer|Restart-Computer)(?=[\s;)}"'\x60]|$)|dd\b[^;&|\n]*\bof=\/dev\/)`,
  "im",
);
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
    if (rules.has("force-push") && forcesMain(blankQuoted(command))) return REASONS["force-push"];
    if (rules.has("download-run") && DOWNLOAD_RUN.test(blankQuoted(command))) return REASONS["download-run"];
    if (rules.has("machine") && MACHINE.test(blankQuoted(command))) return REASONS.machine;
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
