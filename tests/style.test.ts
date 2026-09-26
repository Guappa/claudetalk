import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DOC_ONLY, SHAPES } from "../scripts/scan-private.mjs";

const repoRoot = path.join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

const files = sourceFiles(path.join(repoRoot, "src"));
const read = (relative: string): string => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const basenames = (paths: string[]): string[] => paths.map((file) => path.basename(file));

describe("comment rules", () => {
  it("has no stacked multi-line // blocks", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const next = lines[index + 1];
        if (line.trim().startsWith("//") && next?.trim().startsWith("//")) {
          offenders.push(`${path.basename(file)}:${index + 1}  ${line.trim().slice(0, 60)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("has no JSDoc blocks", () => {
    expect(basenames(files.filter((file) => fs.readFileSync(file, "utf8").includes("/**")))).toEqual([]);
  });

  it("has no module-scope mutable state", () => {
    const offenders: string[] = [];
    for (const file of files) {
      fs.readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        if (/^(export )?(let|var) /.test(line)) offenders.push(`${path.basename(file)}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("branches on the operating system only in platform.ts", () => {
    const offenders = files.filter(
      (file) => path.basename(file) !== "platform.ts" && fs.readFileSync(file, "utf8").includes("process.platform"),
    );
    expect(basenames(offenders)).toEqual([]);
  });

  it("never spawns through a shell", () => {
    expect(basenames(files.filter((file) => /shell:\s*true/.test(fs.readFileSync(file, "utf8"))))).toEqual([]);
  });
});

describe("naming rules", () => {
  const checked = [...files, ...sourceFiles(path.join(repoRoot, "tests"))];
  // A parameter, function or variable named with one letter says nothing to the next reader.
  const singleLetter = [
    /[(,]\s*[a-z]\s*(?=[,:)]|=>)/,
    /(?<![\w.$])[a-z]\s*=>/,
    /\bfunction\s+[a-z]\s*\(/,
    /\b(?:const|let|var)\s+[a-z]\s*[=:]/,
    /\bcatch\s*\(\s*[a-z]\s*\)/,
  ];
  // Loop counters are the one place the convention allows it; a comment is prose, not code.
  const exempt = (line: string): boolean => /^\s*for\s*\(/.test(line) || /^\s*\/\//.test(line);

  it("never names a parameter, function or variable with a single letter", () => {
    const offenders: string[] = [];
    for (const file of checked) {
      fs.readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        if (exempt(line)) return;
        if (singleLetter.some((pattern) => pattern.test(line))) {
          offenders.push(`${path.relative(repoRoot, file)}:${index + 1}  ${line.trim().slice(0, 70)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("docs follow code", () => {
  const registeredCommands = (): string[] =>
    [
      ...read("src/discord/commands/registry.ts").matchAll(
        /new SlashCommandBuilder\(\)\s*\.setName\("([a-z-]+)"\)/g,
      ),
    ].map((match) => match[1]!);

  it("documents every registered slash command in the reference table", () => {
    const reference = read("docs/REFERENCE.md");
    const commands = registeredCommands();
    const rows = new Set([...reference.matchAll(/^\| `\/([a-z-]+)/gm)].map((match) => match[1]));

    expect(commands.length).toBeGreaterThan(0);
    expect(commands.filter((name) => !rows.has(name))).toEqual([]);
  });

  it("routes every registered slash command, and routes nothing else", () => {
    const router = read("src/discord/handlers/interaction.ts");
    const table = /const COMMANDS: Record<string, CommandHandler> = \{([\s\S]*?)\n\};/.exec(router)?.[1] ?? "";
    const routed = [...table.matchAll(/^ {2}([a-z-]+):/gm)].map((match) => match[1]!);
    const commands = registeredCommands();

    expect(routed.length).toBeGreaterThan(0);
    expect(commands.filter((name) => !routed.includes(name))).toEqual([]);
    expect(routed.filter((name) => !commands.includes(name))).toEqual([]);
  });

  it("gates access only on commands that exist", () => {
    const access = read("src/access.ts");
    const commands = registeredCommands();
    const gated = [...access.matchAll(/new Set\(\[([^\]]*)\]\)/g)].flatMap((set) =>
      [...set[1]!.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]!),
    );

    expect(gated.length).toBeGreaterThan(0);
    expect(gated.filter((name) => !commands.includes(name))).toEqual([]);
  });

  it("never replies to a command outside the one helper that knows it was deferred", () => {
    const allowed = new Set(["respond.ts", "interaction.ts"]);
    const offenders = files
      .filter((file) => !allowed.has(path.basename(file)))
      .filter((file) => /interaction\.(reply|deferReply)\(/.test(fs.readFileSync(file, "utf8")));

    expect(basenames(offenders)).toEqual([]);
  });

  it("spends a turn only through the helper that does the sync bookkeeping", () => {
    const allowed = new Set(["turn.ts", "turnFlow.ts"]);
    const offenders = files
      .filter((file) => !allowed.has(path.basename(file)))
      .filter((file) => /flow\.run\(/.test(fs.readFileSync(file, "utf8")));

    expect(basenames(offenders)).toEqual([]);
  });

  // Admission is the only security boundary left, so both doors have to refuse a stranger first.
  it("turns away tier none before doing anything, on every entry point", () => {
    for (const entry of ["src/discord/handlers/message.ts", "src/discord/handlers/interaction.ts"]) {
      expect(read(entry), entry).toMatch(/if \(tier === "none"\)/);
    }
  });

  // Adding a caller means adding a path to a session, which has to be a deliberate edit.
  it("spends a turn from only the places that are gated", () => {
    const callers = basenames(files.filter((file) => /runConversationTurn\(/.test(fs.readFileSync(file, "utf8")))).sort();

    expect(callers).toEqual(
      ["ask.ts", "clear.ts", "components.ts", "conversations.ts", "fork.ts", "message.ts", "turn.ts"].sort(),
    );
  });

  it("lists every environment variable in .env.example and the README", () => {
    const config = read("src/config.ts");
    const example = read(".env.example");
    const readme = read("README.md");
    const names = [...new Set([...config.matchAll(/env\.([A-Z_][A-Z0-9_]*)/g)].map((match) => match[1]))];

    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !example.includes(name!))).toEqual([]);
    expect(names.filter((name) => !readme.includes(name!))).toEqual([]);
  });

  // A README that names an installer a fork does not have sends them to a missing file.
  it("ships every autostart script the README tells someone to run", () => {
    const readme = read("README.md");
    const named = [...readme.matchAll(/scripts\/(install-autostart[a-z-]*\.(?:sh|ps1))/g)].map((match) => match[1]!);
    const missing = [...new Set(named)].filter((name) => !fs.existsSync(path.join(repoRoot, "scripts", name)));

    expect(named.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  // Every host the README offers a service for has to be one the scripts actually refuse or handle.
  it("gives each autostart script a guard against the wrong operating system", () => {
    const posix = ["install-autostart.sh", "install-autostart-macos.sh"];
    const unguarded = posix.filter((name) => !read(`scripts/${name}`).includes("uname -s"));

    expect(unguarded).toEqual([]);
  });

  // The shapes are the scanner's own, so the two can never disagree about what a leak looks like.
  it("keeps identifying details out of anything shipped", () => {
    const shipped = ["README.md", "docs/REFERENCE.md", "CONTRIBUTING.md", ".env.example"];
    const leaks = [...SHAPES, ...DOC_ONLY] as Array<[string, RegExp]>;

    const found: string[] = [];
    for (const file of shipped) {
      const text = read(file);
      for (const [label, pattern] of leaks) {
        if (pattern.test(text)) found.push(`${file}: ${label}`);
      }
    }
    expect(found).toEqual([]);
  });
});
