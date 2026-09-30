import { staysFenced } from "./renderer.ts";

// Discord draws no tables: two columns read well as a list, more need a monospace block to line up.
export function convertTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fenced = false;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const next = lines[index + 1];
    // A table quoted inside a code block is code, and a block planted inside it would end it early.
    if (!fenced && ROW.test(line) && next !== undefined && SEPARATOR.test(next)) {
      const header = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && ROW.test(lines[index]!)) {
        rows.push(cells(lines[index]!));
        index += 1;
      }
      // With no rows beneath it the heading is all the table says, so it is kept as the one row.
      out.push(...(header.length <= 2 ? asList(rows.length > 0 ? rows : [header]) : asBlock(header, rows)));
      continue;
    }
    fenced = staysFenced(fenced, line);
    out.push(line);
    index += 1;
  }
  return out.join("\n");
}

const ROW = /^\s*\|(.*)\|\s*$/;
const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

// A pipe inside inline code, or one written as \|, belongs to its cell.
function cells(line: string): string[] {
  const inner = ROW.exec(line)?.[1] ?? line;
  const found: string[] = [];
  let cell = "";
  let inCode = false;
  for (let at = 0; at < inner.length; at++) {
    const char = inner[at]!;
    if (char === "\\" && inner[at + 1] === "|") {
      cell += "|";
      at += 1;
    } else if (char === "|" && !inCode) {
      found.push(cell.trim());
      cell = "";
    } else {
      if (char === "`") inCode = !inCode;
      cell += char;
    }
  }
  return [...found, cell.trim()];
}

// Inside a code block, inline markup would show as its own punctuation, so it is dropped; a star with a space beside it is arithmetic and stays.
function plain(cell: string): string {
  return cell
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*(\S(?:[^*]*\S)?)\*\*/g, "$1")
    .replace(/\*(\S(?:[^*]*\S)?)\*/g, "$1");
}

function asList(rows: string[][]): string[] {
  return rows.map(([first = "", ...rest]) => `- **${first}**: ${rest.join(" · ")}`);
}

function asBlock(header: string[], rows: string[][]): string[] {
  const table = [header, ...rows].map((row) => row.map(plain));
  const widths = header.map((_, column) => Math.max(...table.map((row) => (row[column] ?? "").length)));
  const pad = (row: string[]): string =>
    row
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();
  return ["```", pad(table[0]!), widths.map((width) => "-".repeat(width)).join("  "), ...table.slice(1).map(pad), "```"];
}
