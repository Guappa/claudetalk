// Discord draws no tables: two columns read well as a list, more need a monospace block to line up.
export function convertTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const next = lines[index + 1];
    if (ROW.test(line) && next !== undefined && SEPARATOR.test(next)) {
      const header = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && ROW.test(lines[index]!)) {
        rows.push(cells(lines[index]!));
        index += 1;
      }
      out.push(...(header.length <= 2 ? asList(rows) : asBlock(header, rows)));
      continue;
    }
    out.push(line);
    index += 1;
  }
  return out.join("\n");
}

const ROW = /^\s*\|(.*)\|\s*$/;
const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  const inner = ROW.exec(line)?.[1] ?? line;
  return inner.split("|").map((cell) => cell.trim());
}

// Inside a code block, inline markup would show as its own punctuation, so it is dropped rather than kept.
function plain(cell: string): string {
  return cell.replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]*)\*\*/g, "$1").replace(/\*([^*]*)\*/g, "$1");
}

function asList(rows: string[][]): string[] {
  return rows.map(([first = "", second = ""]) => `- **${first}**: ${second}`);
}

function asBlock(header: string[], rows: string[][]): string[] {
  const table = [header, ...rows].map((row) => row.map(plain));
  const widths = header.map((_, column) => Math.max(...table.map((row) => (row[column] ?? "").length)));
  const pad = (row: string[]): string => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd();
  return ["```", pad(table[0]!), widths.map((width) => "-".repeat(width)).join("  "), ...table.slice(1).map(pad), "```"];
}
