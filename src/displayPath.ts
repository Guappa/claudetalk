import os from "node:os";
import path from "node:path";
import { shortHomeDir } from "./platform.ts";

export function redactHome(text: string): string {
  return redactPaths(text, RUNNING_HOME);
}

// Whose home it is never matters: the running account's is recognised in every spelling, anyone else's by its shape.
export function redactPaths(text: string, ownHome: RegExp[]): string {
  const own = ownHome.reduce((result, pattern) => result.replace(pattern, "~"), text);
  return ACCOUNT_SHAPES.reduce(
    (result, pattern) =>
      result.replace(pattern, (whole: string, root: string, account: string) => (SHARED.test(account) ? whole : `${root}…`)),
    own,
  );
}

export function homePatterns(homes: string[]): RegExp[] {
  return homes.flatMap((home) => [spelledPattern(home), flattenedPattern(home)].filter((pattern) => pattern !== null));
}

function escaped(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A space in a path also travels as %20, in file URLs and encoded links.
function segmentPattern(segment: string): string {
  return escaped(segment).replace(/ /g, "(?: |%20)");
}

// WSL reaches a Windows drive as /mnt/c and Cygwin as /cygdrive/c, ahead of the /c that Git Bash and MSYS tools use.
const MOUNT = "(?:[\\\\/]+(?:mnt|cygdrive))?";

// Commands and prose carry paths too, in either separator and any case, so a field is not enough.
function spelledPattern(home: string): RegExp | null {
  const segments = home.split(/[\\/]/).filter(Boolean).map(segmentPattern);
  const [first, ...rest] = segments;
  if (!first) return null;
  // A Windows home is spelled with its drive letter, or as a path from the root by every POSIX shell on the machine, and commands quote it each way.
  const drive = /^[A-Za-z]:$/.test(first) ? `(?:${first}|${MOUNT}[\\\\/]+${escaped(first[0]!)})` : first;
  const lead = path.isAbsolute(home) && !/^[A-Za-z]:/.test(home) ? "[\\\\/]+" : "";
  // Anchored at both ends: a home called /root must not rewrite the word root or a URL ending in it, nor /home/dan "danger"; a full stop that ends the sentence is not part of the name.
  return new RegExp(`(?<![\\w.-])${lead}${[drive, ...rest].join("[\\\\/]+")}(?![\\w-]|\\.\\w)`, "gi");
}

// Claude Code names a project's folders after its path with every other character turned into a dash.
function flattenedPattern(home: string): RegExp | null {
  const flat = home.replace(/[^A-Za-z0-9]/g, "-");
  if (!/[A-Za-z0-9]/.test(flat)) return null;
  // A dash before it belongs to something else: a home of /root flattens to -root, which is also the tail of the flag --root.
  return new RegExp(`(?<![A-Za-z0-9-])${escaped(flat)}(?![A-Za-z0-9])`, "gi");
}

const RUNNING_HOME = homePatterns([os.homedir(), shortHomeDir()].filter((home): home is string => home !== null));

// Folders under a users root that belong to nobody in particular.
const SHARED = /^(?:Public|Default|Default User|All Users|Shared)$/i;
const WINDOWS_USERS = `((?<![\\w.-])(?:[A-Za-z]:|${MOUNT}[\\\\/]+[A-Za-z](?=[\\\\/]))[\\\\/]+Users[\\\\/]+)`;
// A Windows account name may hold spaces, so it runs to the next separator or quote; a path that ends at the name has neither, and there it runs to the first space or mark.
const ACCOUNT_SHAPES = [
  new RegExp(`${WINDOWS_USERS}([^\\\\/\\r\\n"'\`<>|*?:;,=+[\\]]+?)(?=[\\\\/"'\`])`, "gi"),
  new RegExp(`${WINDOWS_USERS}([^\\\\/\\s"'\`<>|*?:;,=+[\\]]+?)(?=[.,;:!?)]*(?:\\s|$))`, "gim"),
  /((?<![\w.-])\/(?:home|Users)\/)([^/\s"'`<>]+)(?=[/"'`\s]|$)/g,
];

// An absolute path carries the operator's account name, and Discord is not a place to put it.
export function displayPath(target: string): string {
  const relative = path.relative(os.homedir(), target);
  if (relative === "") return "~";
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return target;
  return `~/${relative.split(path.sep).join("/")}`;
}
