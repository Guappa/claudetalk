import { displayPath } from "../displayPath.ts";
import type { Say } from "../i18n/index.ts";
import { truncate } from "../text.ts";

// What the terminal shows for a tool call, drawn from the call's own input, so it costs the model nothing.
export function describeToolUse(say: Say, name: string, input: Record<string, unknown>): string | null {
  switch (name) {
    case "Edit":
      return editDiff(say, input);
    case "MultiEdit":
      return multiEditDiff(say, input);
    case "Write":
      return writeSummary(say, input);
    case "Bash":
      return command(input, "bash");
    case "PowerShell":
      return command(input, "powershell");
    default:
      return null;
  }
}

// Enough to see what changed; a whole file rewrite is not worth a screen of scrolling on a phone.
const MAX_DIFF_LINES = 24;
const MAX_COMMAND_CHARS = 300;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

// A fence inside the content would end the block early.
function safe(line: string): string {
  return line.replace(/```/g, "` ` `");
}

function capped(say: Say, lines: string[]): string[] {
  if (lines.length <= MAX_DIFF_LINES) return lines;
  return [...lines.slice(0, MAX_DIFF_LINES), say("trail.moreLines", { count: lines.length - MAX_DIFF_LINES })];
}

function fenced(kind: string, lines: string[]): string {
  return `\`\`\`${kind}\n${lines.map(safe).join("\n")}\n\`\`\``;
}

// A path is code, so no character in a file name reads as formatting.
function pathHeading(filePath: string): string {
  return `\`${displayPath(filePath)}\``;
}

function diffLines(before: string, after: string): string[] {
  const removed = before ? before.split("\n").map((line) => `- ${line}`) : [];
  const added = after ? after.split("\n").map((line) => `+ ${line}`) : [];
  return [...removed, ...added];
}

function editDiff(say: Say, input: Record<string, unknown>): string | null {
  const filePath = text(input.file_path);
  if (!filePath) return null;
  return `${pathHeading(filePath)}\n${fenced("diff", capped(say, diffLines(text(input.old_string), text(input.new_string))))}`;
}

function multiEditDiff(say: Say, input: Record<string, unknown>): string | null {
  const filePath = text(input.file_path);
  const edits = Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : [];
  if (!filePath || edits.length === 0) return null;
  const lines = edits.flatMap((edit, index) => [
    ...(index > 0 ? [""] : []),
    ...diffLines(text(edit.old_string), text(edit.new_string)),
  ]);
  return `${pathHeading(filePath)}\n${fenced("diff", capped(say, lines))}`;
}

// Discord highlights a block by its tag; an extension it does not know gets no tag rather than a wrong one.
const LANGUAGES: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  mts: "ts",
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "jsx",
  py: "python",
  json: "json",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  ps1: "powershell",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
};

export function languageFor(filePath: string): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(filePath)?.[1]?.toLowerCase() ?? "";
  return LANGUAGES[extension] ?? "";
}

function writeSummary(say: Say, input: Record<string, unknown>): string | null {
  const filePath = text(input.file_path);
  if (!filePath) return null;
  const lines = text(input.content).split("\n");
  const heading = say("trail.written", { path: pathHeading(filePath), count: lines.length });
  return `${heading}\n${fenced(languageFor(filePath), capped(say, lines))}`;
}

function command(input: Record<string, unknown>, shell: string): string | null {
  const run = text(input.command).replace(/\s+/g, " ").trim();
  if (!run) return null;
  return fenced(shell, [`$ ${truncate(run, MAX_COMMAND_CHARS)}`]);
}
