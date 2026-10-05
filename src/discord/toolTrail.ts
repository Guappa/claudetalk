import { displayPath } from "../displayPath.ts";
import type { Say } from "../i18n/index.ts";
import { truncate } from "../text.ts";

// What a reader can switch off in the trail: tool calls grouped by what they do, since nobody thinks of them by tool name.
export const TRAIL_KINDS = ["edits", "commands", "reads", "web", "agents", "todos", "other"] as const;
export type TrailKind = (typeof TRAIL_KINDS)[number];

const KIND_OF = new Map<string, TrailKind>([
  ...["Edit", "MultiEdit", "Write", "NotebookEdit"].map((tool): [string, TrailKind] => [tool, "edits"]),
  ...["Bash", "PowerShell"].map((tool): [string, TrailKind] => [tool, "commands"]),
  ...["Read", "Glob", "Grep"].map((tool): [string, TrailKind] => [tool, "reads"]),
  ...["WebFetch", "WebSearch"].map((tool): [string, TrailKind] => [tool, "web"]),
  ...["Agent", "Task", "Skill"].map((tool): [string, TrailKind] => [tool, "agents"]),
  ["TodoWrite", "todos"],
]);

// A tool the bridge has no line of its own for, an MCP server's among them, is drawn by name and so belongs to no group but the last.
export function trailKind(toolName: string): TrailKind {
  return KIND_OF.get(toolName) ?? "other";
}

// A tool call's line opens with a mark of what it does, so it reads apart from Claude's own words in the same message. A command has none: its fenced `$` line already stands apart.
const TOOL_MARK = new Map<string, string>([
  ["Read", "📖"],
  ["Glob", "📁"],
  ["Grep", "🔍"],
  ["WebSearch", "🌐"],
  ["WebFetch", "🔗"],
  ["ToolSearch", "🧰"],
  ["Skill", "🧩"],
  ["Agent", "🤖"],
  ["Task", "🤖"],
  ["TodoWrite", "📋"],
  ["NotebookEdit", "📓"],
  ["Edit", "📝"],
  ["MultiEdit", "📝"],
  ["Write", "📝"],
]);
const UNMARKED = new Set(["Bash", "PowerShell"]);
const SERVER_MARK = "🔌";
const OTHER_MARK = "🔧";

function markOf(name: string): string | null {
  if (UNMARKED.has(name)) return null;
  return TOOL_MARK.get(name) ?? (name.startsWith("mcp__") ? SERVER_MARK : OTHER_MARK);
}

// What the terminal shows for a tool call, drawn from the call's own input, so it costs the model nothing: every call gets a line, as in the terminal, so nothing a turn does goes unseen.
export function describeToolUse(say: Say, name: string, input: Record<string, unknown>): string | null {
  const line = toolLine(say, name, input);
  const mark = markOf(name);
  return line && mark ? `${mark} ${line}` : line;
}

function toolLine(say: Say, name: string, input: Record<string, unknown>): string | null {
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
    case "Read":
      return filed(say, "tools.read", input.file_path);
    case "NotebookEdit":
      return filed(say, "tools.notebook", input.notebook_path);
    case "Glob":
      return searched(say, "tools.find", "tools.findAnywhere", input);
    case "Grep":
      return searched(say, "tools.search", "tools.searchAnywhere", input);
    case "WebFetch":
      return quoted(input.url, (url) => say("tools.fetch", { url: `<${url}>` }));
    case "WebSearch":
      return quoted(input.query, (query) => say("tools.webSearch", { query }));
    case "ToolSearch":
      return quoted(input.query, (query) => say("tools.toolSearch", { query: asCode(query) }));
    case "Agent":
    case "Task":
      return quoted(input.description, (description) => say("tools.agent", { description }));
    case "Skill":
      return quoted(input.skill, (name) => say("tools.skill", { name }));
    case "TodoWrite":
      return todos(say, input);
    // The questions reach the channel as menus of their own.
    case "AskUserQuestion":
      return null;
    default:
      return named(say, name);
  }
}

// Enough to see what changed; a whole file rewrite is not worth a screen of scrolling on a phone.
const MAX_DIFF_LINES = 24;
const MAX_COMMAND_CHARS = 300;
// A minified file is one line of any length, and a preview of it would run to a hundred messages.
const MAX_LINE_CHARS = 200;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

// A fence inside the content would end the block early.
function safe(line: string): string {
  return line.replace(/```/g, "` ` `");
}

function capped(say: Say, lines: string[]): string[] {
  const shown = lines.slice(0, MAX_DIFF_LINES).map((line) => truncate(line, MAX_LINE_CHARS));
  if (lines.length <= MAX_DIFF_LINES) return shown;
  return [...shown, say("trail.moreLines", { count: lines.length - MAX_DIFF_LINES })];
}

function fenced(kind: string, lines: string[]): string {
  return `\`\`\`${kind}\n${lines.map(safe).join("\n")}\n\`\`\``;
}

// A path is code, so no character in a file name reads as formatting.
function pathHeading(filePath: string): string {
  return `\`${displayPath(filePath)}\``;
}

// A pattern or a list of tool names is not prose: as code, its underscores and stars stay characters, and a backtick of its own cannot end the span early.
function asCode(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
}

// One line, as the terminal gives a call: what it was and what it was given, cut where a phone stops reading.
const MAX_LINE_CHARS_SHOWN = 200;
const MAX_TODOS_SHOWN = 12;

function filed(say: Say, key: "tools.read" | "tools.notebook", value: unknown): string | null {
  const filePath = text(value);
  return filePath ? say(key, { path: pathHeading(filePath) }) : null;
}

function searched(
  say: Say,
  within: "tools.find" | "tools.search",
  anywhere: "tools.findAnywhere" | "tools.searchAnywhere",
  input: Record<string, unknown>,
): string | null {
  const pattern = text(input.pattern);
  if (!pattern) return null;
  const where = text(input.path);
  const shown = asCode(truncate(pattern, MAX_LINE_CHARS_SHOWN));
  return where ? say(within, { pattern: shown, path: pathHeading(where) }) : say(anywhere, { pattern: shown });
}

function quoted(value: unknown, sentence: (shown: string) => string): string | null {
  const given = text(value).replace(/\s+/g, " ").trim();
  return given ? sentence(truncate(given, MAX_LINE_CHARS_SHOWN)) : null;
}

function todos(say: Say, input: Record<string, unknown>): string | null {
  const listed = Array.isArray(input.todos) ? input.todos : [];
  const items = listed
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({ content: text(item.content), done: item.status === "completed" }))
    .filter((item) => item.content);
  if (items.length === 0) return null;
  const lines = items
    .slice(0, MAX_TODOS_SHOWN)
    .map((item) => `- ${item.done ? "[x]" : "[ ]"} ${truncate(item.content, MAX_LINE_CHARS_SHOWN)}`);
  if (items.length > MAX_TODOS_SHOWN) lines.push(say("trail.moreLines", { count: items.length - MAX_TODOS_SHOWN }));
  return `${say("tools.todos", { count: items.length })}\n${lines.join("\n")}`;
}

// A tool from an MCP server is named by the server and the tool; any other is named as it is.
function named(say: Say, name: string): string {
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  return mcp ? say("tools.server", { server: mcp[1]!, tool: mcp[2]! }) : say("tools.other", { name });
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

function languageFor(filePath: string): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(filePath)?.[1]?.toLowerCase() ?? "";
  return LANGUAGES[extension] ?? "";
}

function writeSummary(say: Say, input: Record<string, unknown>): string | null {
  const filePath = text(input.file_path);
  if (!filePath) return null;
  const content = text(input.content);
  // A file ends with a line break, which closes its last line and does not begin another.
  const lines = content === "" ? [] : content.replace(/\r?\n$/, "").split("\n");
  const heading = say("trail.written", { path: pathHeading(filePath), count: lines.length });
  return `${heading}\n${fenced(languageFor(filePath), capped(say, lines))}`;
}

function command(input: Record<string, unknown>, shell: string): string | null {
  const run = text(input.command).replace(/\s+/g, " ").trim();
  if (!run) return null;
  return fenced(shell, [`$ ${truncate(run, MAX_COMMAND_CHARS)}`]);
}
