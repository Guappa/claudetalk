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

// Commands and prose carry paths too, in either separator and any case, so a field is not enough.
function spelledPattern(home: string): RegExp | null {
  const segments = home.split(/[\\/]/).filter(Boolean).map(segmentPattern);
  const [first, ...rest] = segments;
  if (!first) return null;
  // A Windows home is also spelled /c/Users/... by Git Bash and MSYS tools, and commands quote it that way.
  const drive = /^[A-Za-z]:$/.test(first) ? `(?:${first}|[\\\\/]+${escaped(first[0]!)})` : first;
  // Anchored at both ends: a home called /root must not rewrite the word root, nor /home/dan "danger".
  const lead = path.isAbsolute(home) && !/^[A-Za-z]:/.test(home) ? "[\\\\/]+" : "(?<![\\w.-])";
  return new RegExp(`${lead}${[drive, ...rest].join("[\\\\/]+")}(?![\\w.-])`, "gi");
}

// Claude Code names a project's folders after its path with every other character turned into a dash.
function flattenedPattern(home: string): RegExp | null {
  const flat = home.replace(/[^A-Za-z0-9]/g, "-");
  if (!/[A-Za-z0-9]/.test(flat)) return null;
  return new RegExp(`(?<![A-Za-z0-9])${escaped(flat)}(?![A-Za-z0-9])`, "gi");
}

const RUNNING_HOME = homePatterns([os.homedir(), shortHomeDir()].filter((home): home is string => home !== null));

// Folders under a users root that belong to nobody in particular.
const SHARED = /^(?:Public|Default|Default User|All Users|Shared)$/i;
const ACCOUNT_SHAPES = [
  /((?<![\w.-])(?:[A-Za-z]:|[\\/]+[A-Za-z](?=[\\/]))[\\/]+Users[\\/]+)([^\\/\r\n"'`<>|*?:]+?)(?=[\\/"'`])/gi,
  /((?<![\w.-])\/(?:home|Users)\/)([^/\s"'`<>]+)(?=[/"'`\s]|$)/g,
];

// An absolute path carries the operator's account name, and Discord is not a place to put it.
export function displayPath(target: string): string {
  const relative = path.relative(os.homedir(), target);
  if (relative === "") return "~";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return target;
  return `~/${relative.split(path.sep).join("/")}`;
}
