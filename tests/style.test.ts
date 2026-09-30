import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { refusal } from "../scripts/check-boot.mjs";
import { DOC_ONLY, SHAPES, publishable } from "../scripts/scan-private.mjs";
import { execFileSync } from "node:child_process";
import os from "node:os";

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
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/^(export )?(let|var) /.test(line)) offenders.push(`${path.basename(file)}:${index + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("branches on the operating system only in platform.ts", () => {
    const offenders = files.filter(
      (file) =>
        path.basename(file) !== "platform.ts" && /process\.(?:platform|getuid|geteuid)\b/.test(fs.readFileSync(file, "utf8")),
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
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
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
    [...read("src/discord/commands/registry.ts").matchAll(/new SlashCommandBuilder\(\)\s*\.setName\("([a-z-]+)"\)/g)].map(
      (match) => match[1]!,
    );

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

    expect(callers).toEqual(["ask.ts", "clear.ts", "conversations.ts", "fork.ts", "message.ts", "run.ts", "turn.ts"].sort());
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

  // Each example is put together here in pieces, so this file does not hold the shape it tests for.
  it("recognises the leaks the scanner exists to catch, in the spellings they arrive in", () => {
    const shape = (label: string): RegExp => (SHAPES as Array<[string, RegExp]>).find(([name]) => name === label)![1];
    const credential = shape("a credential");
    expect(credential.test(["sk", "ant", "api03", "A".repeat(24)].join("-"))).toBe(true);
    expect(credential.test(["sk", "proj", "B".repeat(24)].join("-"))).toBe(true);
    expect(credential.test("the task-runner-configuration-file")).toBe(false);

    const home = shape("a real home directory");
    const account = ["C:", "Users", "Some Body", "notes"];
    expect(home.test(account.join("\\"))).toBe(true);
    expect(home.test(account.join("\\\\"))).toBe(true);
    expect(home.test(account.join("/"))).toBe(true);
  });

  // systemd reads the start limit only under [Unit]; under [Service] it is ignored and a bad token restarts forever.
  it("puts the restart limit of the Linux service where systemd reads it", () => {
    const installer = read("scripts/install-autostart.sh");
    const limit = installer.indexOf("StartLimitBurst=");
    expect(limit).toBeGreaterThan(installer.indexOf("[Unit]"));
    expect(limit).toBeLessThan(installer.indexOf("[Service]"));
  });

  // systemd signals every process of a unit by default, and the Claude Code process running the turn would end with the bridge still waiting for it.
  it("has the Linux service signal only the bridge when it is stopped", () => {
    const unit = read("scripts/install-autostart.sh").split("[Service]")[1]!.split("[Install]")[0]!;
    expect(unit).toMatch(/^KillMode=mixed$/m);
    expect(unit).toMatch(/^TimeoutStopSec=1800$/m);
  });

  // The stop script finds the bridge by the same setting the bridge placed its lock with, which lives in .env.
  it("runs the stop script with the environment the bridge itself is started with", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    for (const name of ["dev", "stop", "stop:now"]) expect(scripts[name], name).toContain("--env-file-if-exists=.env");
  });
});

describe("what the bridge says lives in the catalog", () => {
  interface Literal {
    text: string;
    index: number;
  }

  // Every string in a source file with where it starts; comments and regular expressions are skipped, and a template gives only its fixed text.
  function stringLiterals(source: string): Literal[] {
    const found: Literal[] = [];
    const startsRegex = (index: number): boolean => /(^|[(,=:[!&|?{};\n])\s*$/.test(source.slice(Math.max(index - 40, 0), index));

    const readQuoted = (start: number): number => {
      const quote = source[start]!;
      let index = start + 1;
      while (index < source.length && source[index] !== quote) index += source[index] === "\\" ? 2 : 1;
      found.push({ text: source.slice(start + 1, index), index: start });
      return index + 1;
    };

    const readRegex = (start: number): number => {
      let index = start + 1;
      let inClass = false;
      while (index < source.length && (inClass || source[index] !== "/")) {
        if (source[index] === "\\") index += 1;
        else if (source[index] === "[") inClass = true;
        else if (source[index] === "]") inClass = false;
        index += 1;
      }
      return index + 1;
    };

    const readTemplate = (start: number): number => {
      let index = start + 1;
      let text = "";
      while (index < source.length && source[index] !== "`") {
        if (source[index] === "\\") {
          text += source.slice(index, index + 2);
          index += 2;
        } else if (source.startsWith("${", index)) {
          index = readCode(index + 2, true);
          text += "{}";
        } else {
          text += source[index];
          index += 1;
        }
      }
      found.push({ text, index: start });
      return index + 1;
    };

    const readCode = (start: number, untilBrace: boolean): number => {
      let index = start;
      let depth = 0;
      while (index < source.length) {
        const char = source[index]!;
        if (source.startsWith("//", index))
          index = source.indexOf("\n", index) === -1 ? source.length : source.indexOf("\n", index);
        else if (source.startsWith("/*", index)) index = source.indexOf("*/", index) + 2;
        else if (char === '"' || char === "'") index = readQuoted(index);
        else if (char === "`") index = readTemplate(index);
        else if (char === "/" && startsRegex(index)) index = readRegex(index);
        else if (char === "{") {
          depth += 1;
          index += 1;
        } else if (char === "}") {
          if (untilBrace && depth === 0) return index + 1;
          depth -= 1;
          index += 1;
        } else index += 1;
      }
      return index;
    };

    readCode(0, false);
    return found;
  }

  // Written for Claude, for whoever runs the host, or as a diagnostic a catalog sentence quotes; the last is Discord's command picker, the same in every language as in the terminal.
  const NOT_FOR_THE_CATALOG = [
    "src/claude/prompts.ts",
    "src/claude/runner.ts",
    "src/discord/context.ts",
    "src/claude/auth.ts",
    "src/instanceLock.ts",
    "src/conversations.ts",
    "src/discord/commands/registry.ts",
  ];
  const SENTENCE = /[A-Za-z][a-z']+ [a-z']{2,} [a-z']{2,}/;
  const LABEL = /(?:\.set(?:Label|Placeholder|Title|Description)\(|\b(?:label|placeholder|title|description):\s*)$/;

  // The statement a literal sits in, as far back as the line that opens it.
  function statementBefore(source: string, index: number): string {
    const opened = Math.max(source.lastIndexOf(";\n", index), source.lastIndexOf("{\n", index), source.lastIndexOf("}\n", index));
    return source.slice(opened + 1, index);
  }

  const isDiagnostic = (statement: string): boolean => /new Error\(|console\.(log|error|warn)\(/.test(statement);
  const isImport = (statement: string): boolean => /\b(import|from)\s*$/.test(statement);

  it("keeps sentences and labels for people out of the code", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const relative = path.relative(repoRoot, file).split(path.sep).join("/");
      if (relative.startsWith("src/i18n/locales/") || NOT_FOR_THE_CATALOG.includes(relative)) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const literal of stringLiterals(source)) {
        const statement = statementBefore(source, literal.index);
        if (isDiagnostic(statement) || isImport(statement)) continue;
        const isLabel = LABEL.test(statement) && /^[A-Z][a-z]/.test(literal.text);
        if (SENTENCE.test(literal.text) || isLabel) {
          offenders.push(`${path.basename(file)}: ${literal.text.replace(/\s+/g, " ").slice(0, 70)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads a string, a template, a comment and a regular expression apart", () => {
    const lines = [
      'const first = "one two three"; // not "four five six"',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample is source text, template and all
      'const second = `seven ${eight("nine")} ten`; /quote"mark/.test(other);',
    ];
    const sample = lines.join("\n");
    expect(stringLiterals(sample).map((literal) => literal.text)).toEqual(["one two three", "nine", "seven {} ten"]);
  });
});

describe("everything posted to Discord passes the outgoing gate", () => {
  // A path or a stray marker that skips forDiscord reaches the channel as written; the sink gates its payloads itself.
  it("sends text to Discord only through forDiscord", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (["sink.ts", "outgoing.ts"].includes(path.basename(file))) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const call of source.matchAll(/(\w+)\??\.(?:send|reply|editReply|followUp|update|edit)\(/g)) {
        if (/sink$/i.test(call[1]!)) continue;
        const statement = source.slice(call.index, source.indexOf(";", call.index));
        if (!statement.includes("forDiscord")) offenders.push(`${path.basename(file)}: ${call[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("what is drawn on a control, an embed or a file passes the gate too", () => {
  const given = (source: string, open: number): string => {
    let depth = 0;
    for (let at = open; at < source.length; at += 1) {
      if (source[at] === "(") depth += 1;
      if (source[at] === ")") depth -= 1;
      if (depth === 0) return source.slice(open + 1, at).trim();
    }
    return source.slice(open + 1).trim();
  };
  // A sentence from the catalog with nothing filled in holds no path; anything else is gated by name.
  const needsNoGate = (argument: string): boolean => /^say\("[\w.]+"\)$/.test(argument) || argument === "[]";
  const gated = (argument: string): boolean => /(?:for|For)Discord\b/.test(argument);

  // A label, a placeholder, a title, an option and an autocomplete choice are as public as a message, and none of them is message content.
  it("gates every text handed to a control or offered as a choice", () => {
    const offenders: string[] = [];
    for (const file of files) {
      // Command definitions are fixed text, written there and registered once.
      if (path.basename(file) === "registry.ts") continue;
      const source = fs.readFileSync(file, "utf8");
      for (const call of source.matchAll(/\.(?:setLabel|setDescription|setPlaceholder|setTitle|addOptions|respond)\(/g)) {
        const argument = given(source, call.index + call[0].length - 1);
        if (!needsNoGate(argument) && !gated(argument)) {
          offenders.push(`${path.basename(file)}: ${call[0]}${argument.slice(0, 50)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("builds embeds in one gated place, and gates the text of a file it writes itself", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const name = path.basename(file);
      const source = fs.readFileSync(file, "utf8");
      if (name !== "embeds.ts" && source.includes("new EmbedBuilder(")) offenders.push(`${name}: builds an embed of its own`);
      // The sink attaches the files a turn left, which are the conversation's own and are sent as they are.
      if (name === "sink.ts") continue;
      for (const made of source.matchAll(/new AttachmentBuilder\(/g)) {
        if (!gated(given(source, made.index + made[0].length - 1))) offenders.push(`${name}: attaches ungated text`);
      }
    }
    expect(offenders).toEqual([]);
    expect(read("src/discord/embeds.ts")).toContain("forDiscord(description)");
  });
});

describe("the private-data scan", () => {
  const shape = (label: string): RegExp => SHAPES.find(([name]) => name === label)![1] as RegExp;

  // A placeholder is exempt as a whole name; a real name that merely starts the same way is not.
  it("exempts the placeholder names whole, and catches a name that only begins like one", () => {
    const home = shape("a real home directory");
    for (const placeholder of [
      "/home/user/x",
      "/home/you/x",
      "/Users/me/x",
      "C:\\\\Users\\\\you\\\\x",
      "C:\\\\Users\\\\your\\\\x",
    ]) {
      expect(home.test(placeholder), placeholder).toBe(false);
    }
    // Spelled in pieces, or this file would be the one leak the scan reports.
    const posix = (...parts: string[]) => `/${parts.join("/")}/`;
    const windows = (...parts: string[]) => parts.join("\\\\");
    for (const real of [
      posix("home", "young", "notes"),
      posix("home", "yousef", "x"),
      posix("Users", "youssef", "x"),
      posix("home", "users1", "x"),
      windows("C:", "Users", "yourick", "x"),
      windows("C:", "Users", "username7", "x"),
    ]) {
      expect(home.test(real), real).toBe(true);
    }
  });

  // A bot token starts with its application id in base64, and an id can start with any digit.
  it("knows a bot token whatever digit its id starts with", () => {
    const credential = shape("a credential");
    const token = (id: string) => `${Buffer.from(id).toString("base64").replace(/=+$/, "")}.Gx7Yq2.${"a".repeat(38)}`;
    for (const id of ["123456789012345678", "298765432109876543", "432109876543210987", "876543210987654321"]) {
      expect(credential.test(token(id)), id).toBe(true);
    }
    expect(credential.test("MTIz.short")).toBe(false);
  });

  // A transcript kept as a fixture is the file likeliest to have been captured from a real session.
  it("reads the transcript fixtures and the files with no extension, as git would publish them", () => {
    const listed = publishable().map((file: string) => path.relative(repoRoot, file).split(path.sep).join("/"));
    expect(listed).toContain("tests/fixtures/transcript-stub.jsonl");
    expect(listed).toContain("LICENSE");
    expect(listed).toContain(".gitignore");
    expect(listed.some((file: string) => file.startsWith("node_modules/"))).toBe(false);
    expect(listed.some((file: string) => file.endsWith(".webp"))).toBe(false);
  });
});

describe("the boot check", () => {
  // A checkout reached through a junction or a linked folder is spelled two ways, and a guard comparing them as written runs nothing and passes.
  it("runs when the checkout is reached through a linked folder", () => {
    const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "linked-")), "checkout");
    fs.symlinkSync(repoRoot, link, "junction");
    try {
      const printed = execFileSync(process.execPath, [path.join(link, "scripts", "check-boot.mjs")], { encoding: "utf8" });
      expect(printed).toContain("Every source file loads");
    } finally {
      fs.rmSync(link, { recursive: false, force: true });
    }
  });

  // The suite compiles with esbuild, which runs all of these, so only Node's own stripper can say which of them the bridge would start with.
  it("refuses what Node's type stripper cannot run, and nothing that it can", () => {
    expect(refusal("enum Mood { Done }")).toContain("enum");
    const heldInItsConstructor = ["private", "readonly value: number"].join(" ");
    expect(refusal(`export class Held { constructor(${heldInItsConstructor}) {} }`)).toContain("parameter property");
    expect(refusal("namespace Held { export const value = 1; }")).toContain("namespace");
    expect(refusal("const limit: number = 3;\nexport const twice = limit * 2;")).toBeNull();
  });
});
