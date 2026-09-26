import os from "node:os";
import path from "node:path";

function escaped(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Commands and prose carry paths too, in either separator and any case, so a field is not enough.
export function redactHome(text: string): string {
  const home = os.homedir();
  const segments = home.split(/[\\/]/).filter(Boolean).map(escaped);
  const [first, ...rest] = segments;
  if (!first) return text;
  // A Windows home is also spelled /c/Users/... by Git Bash and MSYS tools, and commands quote it that way.
  const drive = /^[A-Za-z]:$/.test(first) ? `(?:${first}|[\\\\/]+${escaped(first[0]!)})` : first;
  // Anchored at both ends: a home called /root must not rewrite the word root, nor /home/dan "danger".
  const lead = path.isAbsolute(home) && !/^[A-Za-z]:/.test(home) ? "[\\\\/]+" : "(?<![\\w.-])";
  const pattern = new RegExp(`${lead}${[drive, ...rest].join("[\\\\/]+")}(?![\\w.-])`, "gi");
  return text.replace(pattern, "~");
}

// An absolute path carries the operator's account name, and Discord is not a place to put it.
export function displayPath(target: string): string {
  const relative = path.relative(os.homedir(), target);
  if (relative === "") return "~";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return target;
  return `~/${relative.split(path.sep).join("/")}`;
}
