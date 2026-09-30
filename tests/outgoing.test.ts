import { describe, it, expect } from "vitest";
import { recordingSink } from "./helpers/sinks.ts";
import { fakeChannel as fakeDiscordChannel } from "./helpers/discord.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isFromGuild } from "../src/discord/gate.ts";
import { chunkForDiscord } from "../src/discord/renderer.ts";
import { choicesForDiscord, fitForDiscord, forDiscord, optionForDiscord, splitForDiscord } from "../src/discord/outgoing.ts";
import { StatusMessage } from "../src/discord/statusMessage.ts";
import {
  collectReferences,
  linkPlain,
  linkReferences,
  referenceLinks,
  remoteWebUrl,
  resolveReferences,
} from "../src/discord/repoLinks.ts";
import { execFileSync } from "node:child_process";
import { convertTables } from "../src/discord/tables.ts";
import { describeToolUse } from "../src/discord/toolTrail.ts";
import { defuseStrayMarkup } from "../src/discord/strayMarkup.ts";
import { DISCORD_MESSAGE_LIMIT, EMBED_DESCRIPTION_LIMIT, EMBED_FIELD_LIMIT } from "../src/discord/limits.ts";
import { channelSink } from "../src/discord/sink.ts";
import { truncate } from "../src/text.ts";
import { displayPath, homePatterns, redactHome, redactPaths } from "../src/displayPath.ts";
import { shortPrefix } from "../src/platform.ts";
import { detail } from "../src/discord/embeds.ts";
import { sayIn } from "../src/i18n/index.ts";
import { formatExchanges } from "../src/discord/transcriptView.ts";

const say = sayIn("en");

describe("gate", () => {
  const config = { guildId: "g1" };

  it("accepts messages from the configured guild", () => {
    expect(isFromGuild(config, "g1", false)).toBe(true);
  });

  it("rejects another guild", () => {
    expect(isFromGuild(config, "g2", false)).toBe(false);
  });

  it("rejects bots, including itself", () => {
    expect(isFromGuild(config, "g1", true)).toBe(false);
  });

  it("rejects a DM, where guildId is null", () => {
    expect(isFromGuild(config, null, false)).toBe(false);
  });
});

describe("chunkForDiscord", () => {
  it("leaves short text as one chunk", () => {
    expect(chunkForDiscord("hello")).toEqual(["hello"]);
  });

  it("keeps every chunk within the Discord limit", () => {
    expect(chunkForDiscord("x".repeat(5000)).every((chunk) => chunk.length <= 2000)).toBe(true);
  });

  it("loses no characters when splitting plain text", () => {
    const text = Array.from({ length: 400 }, (_, index) => `line ${index}`).join("\n");
    expect(chunkForDiscord(text).join("\n")).toBe(text);
  });

  it("reopens a code fence that a split would otherwise leave dangling", () => {
    const text = `\`\`\`ts\n${"const value = 1;\n".repeat(300)}\`\`\``;
    const chunks = chunkForDiscord(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.endsWith("```")).toBe(true);
    expect(chunks[1]!.startsWith("```")).toBe(true);
  });

  it("gives nothing for empty text, leaving what stands in for it to the caller", () => {
    expect(chunkForDiscord("")).toEqual([]);
  });

  // An opener closed at once is an empty code block, with the code after it outside any block.
  it("does not leave an empty code block when a fenced line needs a chunk to itself", () => {
    const chunks = chunkForDiscord(`\`\`\`\n${"x".repeat(1995)}\n\`\`\``);
    expect(chunks).not.toContain("```\n```");
    expect(chunks.every((chunk) => chunk.length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
    expect(chunks.every((chunk) => chunk.startsWith("```") && chunk.endsWith("```"))).toBe(true);
  });

  it("moves a fence that opens on a chunk's last line to the next chunk, whole", () => {
    // 1,980 characters of prose leave room for the opener and its closing fence, and for no line of code after it.
    const filler = [...Array.from({ length: 39 }, () => "y".repeat(49)), "y".repeat(29)].join("\n");
    const chunks = chunkForDiscord(`${filler}\n\`\`\`js\n${"const value = 1;\n".repeat(20)}\`\`\``);
    expect(chunks.every((chunk) => chunk.length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
    expect(chunks[0]).not.toContain("```");
    expect(chunks[1]?.startsWith("```js\n")).toBe(true);
  });

  it("keeps a fence indented under a list item closed and reopened across chunks", () => {
    const chunks = chunkForDiscord(`- item\n   \`\`\`js\n${"const value = 1;\n".repeat(200)}   \`\`\`\nafter`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(1, -1)) {
      expect(chunk.startsWith("   ```js\n")).toBe(true);
      expect(chunk.endsWith("\n```")).toBe(true);
    }
    expect(chunks.at(-1)).toContain("after");
  });

  it("does not take a one-line block, or a fence quoted inside a block, for a fence opening or closing", () => {
    const oneLine = chunkForDiscord(`\`\`\`echo hi\`\`\`\n${"word ".repeat(450)}`);
    expect(oneLine.at(-1)?.endsWith("```")).toBe(false);

    const quoted = chunkForDiscord(`\`\`\`md\n\`\`\`python\n${"print(1)\n".repeat(300)}\`\`\``);
    expect(quoted.every((chunk) => chunk.startsWith("```md") && chunk.endsWith("```"))).toBe(true);
  });

  // Markdown that itself holds a code block is shown inside a longer fence, which a shorter one inside it does not close.
  it("closes a fence only on a line of at least as many backticks as opened it", () => {
    const shown = ["Put this in README.md:", "````md", "## Usage", "```bash", "npm run stop", "```", "````", "That is all."].join(
      "\n",
    );
    expect(chunkForDiscord(shown)).toEqual([shown]);

    const table = "| a | b |\n|---|---|\n| 1 | 2 |";
    expect(convertTables(`${shown}\n${table}`)).toBe(`${shown}\n- **1**: 2`);
    const quoted = ["````md", table, "````"].join("\n");
    expect(convertTables(quoted)).toBe(quoted);

    const inner = "```sh\nls\n```\n".repeat(200);
    const long = chunkForDiscord(["````md", `${inner}\`\`\`\``, "after"].join("\n"));
    expect(long.length).toBeGreaterThan(1);
    expect(long.slice(0, -1).every((chunk) => chunk.startsWith("````md") && chunk.endsWith("````"))).toBe(true);
    expect(long.at(-1)?.endsWith("after")).toBe(true);
  });

  // The opener is carried into every later chunk, so a line of content that merely starts with a fence must not be carried whole.
  it("carries only a fence and its language into the next chunk, however long the line that opened it", () => {
    const body = "x".repeat(3000);
    const pieces = chunkForDiscord(["```".concat(body), "last line"].join("\n"));
    expect(pieces.every((piece) => piece.length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
    expect(pieces.join("").split("x").length - 1).toBe(3000);

    const tagged = chunkForDiscord(["```python", "print(1)\n".repeat(400).trimEnd(), "```"].join("\n"));
    expect(tagged.every((piece) => piece.startsWith("```python\n"))).toBe(true);
  });
});

describe("an answer with a very long line that starts a fence", () => {
  // The split is tightened when prose grows under escaping, and a limit that leaves such a line no room would never advance.
  it("is split, and every piece fits, where the prose around it grows when escaped", () => {
    const prose = Array.from({ length: 12 }, () => "the x_y_z and a_b_c of 2 * 3 [ then".repeat(4)).join("\n");
    for (const width of [1000, 1300, 1647, 1690, 3000]) {
      const pieces = splitForDiscord([prose, "```".concat("x".repeat(width)), "done"].join("\n"));
      expect(
        pieces.every((piece) => forDiscord(piece).length <= DISCORD_MESSAGE_LIMIT),
        String(width),
      ).toBe(true);
      expect(pieces.join("").split("x").length - 1, String(width)).toBeGreaterThanOrEqual(width);
    }
  });

  it("leaves the room it is asked to, for a heading that goes above the first piece", () => {
    const answer = Array.from({ length: 60 }, (_, index) => `Point ${index + 1}: `.padEnd(99, "y")).join("\n");
    expect(splitForDiscord(answer, 1900).every((piece) => forDiscord(piece).length <= 1900)).toBe(true);
  });
});

describe("a home path in what is posted", () => {
  const home = os.homedir();
  const account = path.basename(home);

  // The gate sees a piece at a time, and half a path is not a path to it.
  it("is redacted before an answer is cut, so a cut that falls inside one leaks none of it", () => {
    const line = `${"w".repeat(1990)} ${path.join(home, "Documents", "notes.md")} and on`;
    const pieces = splitForDiscord(line);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map(forDiscord).join("")).not.toContain(account);
  });

  it("is redacted in an embed's description and fields, and in what a menu shows", () => {
    const where = path.join(home, "Documents", "ledger");
    const embed = detail(`Title in ${where}`, `Runs in ${where}`, [{ name: `Folder ${where}`, value: where }]).toJSON();
    expect(JSON.stringify(embed)).not.toContain(account);

    expect(JSON.stringify(optionForDiscord({ label: where, value: where, description: `in ${where}` }))).toBe(
      JSON.stringify({ label: redactHome(where), value: where, description: `in ${redactHome(where)}` }),
    );
    expect(choicesForDiscord([{ name: `run in ${where}`, value: "x" }])[0]!.name).not.toContain(account);
  });
});

describe("splitForDiscord", () => {
  // Escaping lengthens a piece, and Discord refuses one over the limit, so an answer cut before escaping may never appear.
  it("cuts pieces that still fit once stray markers in them are escaped", () => {
    const answer = Array.from({ length: 200 }, () => "word my_var_name other_var_name and 2 * 3 then").join("\n");
    expect(chunkForDiscord(answer).some((piece) => forDiscord(piece).length > DISCORD_MESSAGE_LIMIT)).toBe(true);

    const pieces = splitForDiscord(answer);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((piece) => forDiscord(piece).length).every((length) => length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
    expect(pieces.join("\n")).toBe(answer);
  });

  it("fits even a text made of nothing but markers", () => {
    const pieces = splitForDiscord("_".repeat(5000));
    expect(pieces.every((piece) => forDiscord(piece).length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
  });

  it("leaves a text that needs no escaping cut at the full limit", () => {
    const plain = Array.from({ length: 300 }, () => "plain words only").join("\n");
    expect(splitForDiscord(plain)).toEqual(chunkForDiscord(plain));
  });
});

describe("fitForDiscord", () => {
  it("fits the start of a text made of nothing but markers, with the mark that says it was cut", () => {
    const first = fitForDiscord("_".repeat(5000), 1000);
    expect(first.endsWith("…")).toBe(true);
    expect(forDiscord(first).length).toBeLessThanOrEqual(1000);
  });

  it("leaves a text that fits whole uncut, and keeps one cut within the room with its mark", () => {
    expect(fitForDiscord("x".repeat(990), 1000)).toBe("x".repeat(990));
    const cut = fitForDiscord(Array.from({ length: 200 }, () => "plain words").join("\n"), 1000);
    expect(cut.endsWith("\n…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(1000);
  });
});

describe("no account's path reaches Discord, whoever's it is and however it is spelled", () => {
  const users = ["C:", "Users"].join("\\");
  const home = [users, "Pat Doe"].join("\\");
  const shortHome = [users, "PATDOE" + "~1"].join("\\");
  const ownHome = homePatterns([home, shortHome]);
  const slashed = (value: string) => value.split("\\").join("/");

  it("turns every spelling of the running account's home into ~", () => {
    const flattened = "C--Users-Pat-Doe-Documents-projects-ledger";
    const cases: Array<[string, string]> = [
      [
        `tail -40 "${slashed(shortHome)}/AppData/Local/Temp/claude/${flattened}/abc/tasks/x.output"`,
        `tail -40 "~/AppData/Local/Temp/claude/~-Documents-projects-ledger/abc/tasks/x.output"`,
      ],
      [`~/.claude/projects/${flattened}/memory/notes.md`, "~/.claude/projects/~-Documents-projects-ledger/memory/notes.md"],
      [`open file:///${slashed(home).replaceAll(" ", "%20")}/notes.md`, "open file:///~/notes.md"],
      [`cd ${home}\\ledger`, "cd ~\\ledger"],
    ];
    for (const [text, expected] of cases) expect(redactPaths(text, ownHome)).toBe(expected);
  });

  it("hides the account in anyone else's home path by its shape alone", () => {
    const cases: Array<[string, string]> = [
      [[users, "Sam", "repo", "x.ts"].join("\\"), [users, "…", "repo", "x.ts"].join("\\")],
      [[users, "SAMUEL" + "~1", "x"].join("\\"), [users, "…", "x"].join("\\")],
      ["/c/" + "Users/" + "Sam/x", "/c/Users/…/x"],
      ["/home/" + "sam/src", "/home/…/src"],
      ["/Users/" + "sam/Desktop", "/Users/…/Desktop"],
      [`"${slashed(users)}/Jo Ann/notes"`, `"${slashed(users)}/…/notes"`],
    ];
    for (const [text, expected] of cases) expect(redactPaths(text, ownHome)).toBe(expected);
  });

  it("leaves shared folders, look-alike names and web addresses alone, and settles after one pass", () => {
    const untouched = [
      [users, "Public", "Documents"].join("\\"),
      "/Users/" + "Shared/x",
      "https://example.com/home/about",
      "C--Users-Pat-Doe2-elsewhere",
      "the Users folder",
    ];
    for (const text of untouched) expect(redactPaths(text, ownHome)).toBe(text);
    const once = redactPaths(`${home}\\a and ${[users, "Sam", "b"].join("\\")}`, ownHome);
    expect(redactPaths(once, ownHome)).toBe(once);
  });

  // WSL spells a Windows home under /mnt/c and Cygwin under /cygdrive/c, and a command run through either carries that spelling.
  it("knows the home as WSL and Cygwin spell it, and at the end of a sentence", () => {
    const cases: Array<[string, string]> = [
      [`cd '/mnt${slashed(home).replace("C:", "/c")}/Documents/projects/x'`, "cd '~/Documents/projects/x'"],
      [`ls /cygdrive${slashed(home).replace("C:", "/c")}/Documents`, "ls ~/Documents"],
      [`It is in ${home}.`, "It is in ~."],
      [`${[`${home}.bak`, "x"].join("\\")} is another account's`, `${[users, "…", "x"].join("\\")} is another account's`],
      ["/mnt/c/" + "Users/" + "Sam/x", "/mnt/c/Users/…/x"],
    ];
    for (const [text, expected] of cases) expect(redactPaths(text, ownHome)).toBe(expected);
  });

  it("hides another account named where the path ends, without taking the sentence after it", () => {
    const cases: Array<[string, string]> = [
      [`${[users, "Sam"].join("\\")}.`, `${[users, "…"].join("\\")}.`],
      [`in ${[users, "Sam"].join("\\")}, then see src/a.ts`, `in ${[users, "…"].join("\\")}, then see src/a.ts`],
      [[users, "Sam"].join("\\"), [users, "…"].join("\\")],
      ["It is in /home/" + "sam.", "It is in /home/…."],
      ["(/Users/" + "sam), then /home/" + "sam: done", "(/Users/…), then /home/…: done"],
      ["/home/" + "sam.lee/x", "/home/…/x"],
    ];
    for (const [text, expected] of cases) expect(redactPaths(text, ownHome)).toBe(expected);
  });

  it("does not take a web address or a flag for a POSIX home", () => {
    const rootHome = homePatterns(["/root"]);
    expect(redactPaths("see https://example.org/root and --root", rootHome)).toBe("see https://example.org/root and --root");
    expect(redactPaths("cd /root/x && ls /root/.claude/projects/-root-projects", rootHome)).toBe(
      "cd ~/x && ls ~/.claude/projects/~-projects",
    );

    const named = homePatterns(["/home/" + "pat"]);
    const address = "https://example.org/home/" + "pat/about";
    expect(redactPaths(address, named)).toBe(address);
  });

  // A home one folder below the root is called root, app or data, which are ordinary folder names and flags as well.
  it("takes a home one folder below the root for the home only where a path starts", () => {
    const rootHome = homePatterns(["/root"]);
    const untouched = [
      "edit packages/root/index.ts",
      "cd /app/root/src",
      "github.com/acme/root is the repository",
      "pass -root to the tool",
      ["C:", "work", "root", "file.txt"].join("\\"),
    ];
    for (const text of untouched) expect(redactPaths(text, rootHome), text).toBe(text);
    expect(redactPaths('run "/root/bin/tool" in /root', rootHome)).toBe('run "~/bin/tool" in ~');
  });

  // A sentence goes on after a path that ends at the account's name, and its words are not part of the name.
  it("hides another account's name without taking the words after it", () => {
    const sam = [users, "sam"].join("\\");
    const hidden = [users, "…"].join("\\");
    const cases: Array<[string, string]> = [
      [`open ${sam} then read the file in docs/readme.md please`, `open ${hidden} then read the file in docs/readme.md please`],
      [`${sam} holds it and/or the other one`, `${hidden} holds it and/or the other one`],
      [`cd ${sam} && ls src/x`, `cd ${hidden} && ls src/x`],
      [`He said "look in ${sam} and tell me now" twice`, `He said "look in ${hidden} and tell me now" twice`],
      [`${[users, "Jo Ann", "notes"].join("\\")} is hers`, `${[users, "…", "notes"].join("\\")} is hers`],
      [`${slashed(users)}/sam\\x`, `${slashed(users)}/…\\x`],
    ];
    for (const [text, expected] of cases) expect(redactPaths(text, ownHome), text).toBe(expected);
  });

  // A path is written straight after a compiler flag, behind a UNC host and under a volume, with no space before its first slash.
  it("knows a POSIX home whatever is written right before it", () => {
    const named = homePatterns(["/home/" + "pat"]);
    const cases: Array<[string, string]> = [
      ["gcc -I/home/" + "pat/include -L/home/" + "pat/lib main.c", "gcc -I~/include -L~/lib main.c"],
      ["\\\\wsl$\\Ubuntu\\home\\" + "pat\\proj", "\\\\wsl$\\Ubuntu~\\proj"],
      ["/System/Volumes/Data/home/" + "pat/notes.md", "/System/Volumes/Data~/notes.md"],
      ["file://localhost/home/" + "pat/report.html", "file://localhost~/report.html"],
      ["../../home/" + "pat/x and /home/" + "pat/x", "../..~/x and ~/x"],
    ];
    for (const [text, expected] of cases) expect(redactPaths(text, named)).toBe(expected);
  });

  it("finds the short spelling of the home folder from the temp folder, and nothing when there is none", () => {
    const tail = "\\AppData\\Local\\Temp";
    expect(shortPrefix(home, `${shortHome}${tail}`, `${home}${tail}`)).toBe(shortHome);
    expect(shortPrefix(home, `${home}${tail}`, `${home}${tail}`)).toBeNull();
    expect(shortPrefix("/home/" + "pat", "/tmp", "/tmp")).toBeNull();
  });
});

describe("redactHome", () => {
  it("rewrites a home path in prose the model wrote", () => {
    const text = `I wrote it to ${path.join(os.homedir(), "Desktop", "out.md")}`;
    const shown = redactHome(text);
    expect(shown).not.toContain(path.basename(os.homedir()));
    expect(shown).toContain("~");
  });

  it("catches both separators, either case, and the Git Bash spelling of a Windows home", () => {
    const account = path.basename(os.homedir());
    const forward = os.homedir().split(path.sep).join("/");
    // Git Bash and MSYS tools spell a Windows home with a lowercase drive letter and forward slashes.
    const msys = forward.replace(/^([A-Za-z]):/, (_, letter: string) => `/${letter.toLowerCase()}`);
    for (const variant of [forward, forward.toUpperCase(), os.homedir(), msys]) {
      expect(redactHome(`ran in ${variant}/x`)).not.toContain(account);
      expect(redactHome(`ran in ${variant}/x`)).toContain("~/x");
    }
  });

  it("leaves text without a home path alone", () => {
    expect(redactHome("nothing to redact here")).toBe("nothing to redact here");
  });
});

describe("embeds", () => {
  it("fits a list that would not fit in a plain message", () => {
    const long = "x".repeat(3000);
    const embed = detail("Conversations", long).toJSON();
    expect(embed.description?.length).toBe(3000);
    expect(EMBED_DESCRIPTION_LIMIT).toBeGreaterThan(2000);
  });

  it("trims anything past what Discord accepts rather than being refused", () => {
    const embed = detail("t", "y".repeat(9000), [{ name: "f", value: "z".repeat(4000) }]).toJSON();
    expect(embed.description?.length).toBe(EMBED_DESCRIPTION_LIMIT);
    expect(embed.fields?.[0]?.value.length).toBe(EMBED_FIELD_LIMIT);
  });

  it("leaves out a field with nothing in it", () => {
    const embed = detail("t", "d", [
      { name: "Set", value: "yes" },
      { name: "Empty", value: "   " },
    ]).toJSON();
    expect(embed.fields?.map((field) => field.name)).toEqual(["Set"]);
  });
});

describe("displayPath", () => {
  it("writes a path under home as a tilde path, so no account name is posted", () => {
    const shown = displayPath(path.join(os.homedir(), "Documents", "code", "thing"));
    expect(shown).toBe("~/Documents/code/thing");
    expect(shown).not.toContain(path.basename(os.homedir()));
  });

  it("leaves a path outside home alone", () => {
    const outside = process.platform === "win32" ? "D:\\srv\\app" : "/srv/app";
    expect(displayPath(outside)).toBe(outside);
  });

  it("writes home itself as a tilde rather than spelling it out", () => {
    expect(displayPath(os.homedir())).toBe("~");
  });

  it("does not mistake a sibling of home for a child of it", () => {
    expect(displayPath(`${os.homedir()}-backup`)).toBe(`${os.homedir()}-backup`);
  });
});

describe("a preview of a file with one very long line", () => {
  it("cuts the line, so a minified file does not run to a hundred messages", () => {
    const shown = describeToolUse(say, "Write", { file_path: "/tmp/bundle.min.js", content: "x".repeat(200_000) });
    expect(shown!.length).toBeLessThan(400);
    const edited = describeToolUse(say, "Edit", {
      file_path: "/tmp/bundle.min.js",
      old_string: "a",
      new_string: "y".repeat(5000),
    });
    expect(edited!.length).toBeLessThan(400);
  });
});

describe("describeToolUse", () => {
  it("shows an edit as a diff block with the removed and added lines under the file's path", () => {
    const shown = describeToolUse(say, "Edit", {
      file_path: "/srv/app/src/thing.ts",
      old_string: "const alpha = 1;\nconst beta = 2;",
      new_string: "const alpha = 10;",
    });
    expect(shown).toBe("`/srv/app/src/thing.ts`\n```diff\n- const alpha = 1;\n- const beta = 2;\n+ const alpha = 10;\n```");
  });

  // Discord reads the underscores in a plain path as italics, which run into the fence and break it.
  it("keeps a path with underscores out of Markdown, whichever tool drew it", () => {
    const input = { file_path: "/srv/app/memory/project_backup_notes.md", old_string: "a", new_string: "b", content: "c" };
    expect(describeToolUse(say, "Edit", input)?.split("\n")[0]).toBe("`/srv/app/memory/project_backup_notes.md`");
    expect(describeToolUse(say, "MultiEdit", { ...input, edits: [{ old_string: "a", new_string: "b" }] })?.split("\n")[0]).toBe(
      "`/srv/app/memory/project_backup_notes.md`",
    );
    expect(describeToolUse(say, "Write", input)?.split("\n")[0]).toBe("`/srv/app/memory/project_backup_notes.md` (1 line)");
  });

  it("counts the lines a written file has, not the line break that ends it", () => {
    const written = (content: string) =>
      describeToolUse(say, "Write", { file_path: "/srv/app/notes.md", content })?.split("\n")[0];
    expect(written("one\ntwo\n")).toContain("(2 lines)");
    expect(written("one\ntwo")).toContain("(2 lines)");
    expect(written("one\r\n")).toContain("(1 line)");
    expect(written("")).toContain("(0 lines)");
  });

  it("shows a written file in a block tagged with its language, capped, saying how much is left", () => {
    const shown = describeToolUse(say, "Write", { file_path: "/srv/app/big.py", content: Array(40).fill("x = 1").join("\n") });
    expect(shown).toContain("(40 lines)");
    expect(shown).toContain("```python\n");
    expect(shown?.split("\n").filter((line) => line === "x = 1")).toHaveLength(24);
    expect(shown).toContain("... 16 more lines");
    expect(describeToolUse(say, "Write", { file_path: "/srv/app/notes.unknownext", content: "a" })).toContain("```\na\n```");
  });

  it("shows a command as a prompt line in a shell block and keeps the rest of the tools counted only", () => {
    expect(describeToolUse(say, "Bash", { command: "npm   test\n  --run" })).toBe("```bash\n$ npm test --run\n```");
    expect(describeToolUse(say, "PowerShell", { command: "Get-Date" })).toBe("```powershell\n$ Get-Date\n```");
    expect(describeToolUse(say, "Read", { file_path: "/srv/app/x.ts" })).toBeNull();
    expect(describeToolUse(say, "Grep", { pattern: "x" })).toBeNull();
  });

  it("never lets a fence inside the content close the block early", () => {
    const shown = describeToolUse(say, "Edit", { file_path: "/srv/app/README.md", old_string: "```js", new_string: "```ts" });
    expect(shown?.match(/```/g)).toHaveLength(2);
  });
});

// Discord closes an open marker wherever the next one sits, fences included, so nothing may be left open.

describe("stray markup never reaches past its own text", () => {
  const fence = "```";
  const block = `${fence}bash\n$ ls\n${fence}`;

  it("makes a backtick left open by an escaped one literal, so the block after it survives", () => {
    const remark = "The chip `[Guide \\`intro\\`](#top)` loses its underline.";
    expect(defuseStrayMarkup(`${remark}\n\n${block}`)).toBe(
      `The chip \`[Guide \\\`intro\\\`](#top)\\\` loses its underline.\n\n${block}`,
    );
  });

  it("makes an underscore literal when its italics would close inside the block below", () => {
    const text = `Renamed old_name in the notes\n\n${fence}diff\n- keep_it\n${fence}`;
    expect(defuseStrayMarkup(text)).toBe(`Renamed old\\_name in the notes\n\n${fence}diff\n- keep_it\n${fence}`);
  });

  it("does the same for every marker that has to close: bold, underline, strikethrough, spoiler, link", () => {
    for (const marker of ["**", "__", "~~", "||"]) {
      const out = defuseStrayMarkup(`left ${marker}open\n\n${block}`);
      expect(out.endsWith(block)).toBe(true);
      expect(out).not.toContain(`left ${marker}open`);
    }
    expect(defuseStrayMarkup(`see [the notes\n\n${block}`)).toBe(`see \\[the notes\n\n${block}`);
  });

  it("leaves markup that closes where it opens, and tokens Discord takes whole, exactly as written", () => {
    const untouched = [
      "**bold**, *soft*, _soft_, __under__, ~~gone~~, ||hidden||, `code`, ``a ` b``",
      "- item\n* item\n  * nested",
      "[a guide](<https://example.org/a_b>) and https://example.org/x_y and <t:1700000000:t> and <@123>",
      "already \\*escaped\\* and \\_this\\_ too",
      `${fence}js\nconst left_open = \`x;\n${fence}`,
    ];
    for (const text of untouched) expect(defuseStrayMarkup(text)).toBe(text);
  });

  it("is idempotent, so guarding at the sink after guarding a remark changes nothing", () => {
    const samples = [
      "a `b and c_d and **e\n\n```\nx_y\n```\n\nthen f_g `h`",
      "snake_case_name and [x] done and 2 * 3",
      "The chip `[Guide \\`intro\\`](#top)` loses its underline.",
    ];
    for (const sample of samples) {
      const once = defuseStrayMarkup(sample);
      expect(defuseStrayMarkup(once)).toBe(once);
    }
  });

  it("seals each remark in the trail on its own, and still recognises the echoed answer", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("The chip `[Guide \\`intro\\`](#top)` loses its underline.");
    status.note(block);
    await status.settle();
    expect(sink.messages[0]).toContain(`\\\` loses its underline.\n\n${block}`);

    const echo = new StatusMessage(say, recordingSink(), () => 0);
    echo.note("Renamed old_name only.");
    echo.dropEcho("Renamed old_name only.");
    expect(echo.hasNotes()).toBe(false);
  });

  it("seals each exchange /sync posts, since they share a message", () => {
    const at = new Date("2026-09-13T14:32:00Z");
    const out = formatExchanges(say, [
      { at, role: "user", text: "why is `this open" },
      { at, role: "assistant", text: block },
    ]);
    expect(out).toContain("why is \\`this open");
    expect(out.endsWith(block)).toBe(true);
  });
});

// The shapes below are the ones real turns produced: two agents beside a background command, and one agent sent back to work.

describe("chunkForDiscord with a smaller limit", () => {
  it("honours the limit it is given", () => {
    const chunks = chunkForDiscord(Array.from({ length: 10 }, (_, index) => `line ${index} ${"w".repeat(100)}`).join("\n"), 300);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(300);
  });
});

describe("convertTables", () => {
  // Discord has no table markup, so a two-column table reads best as a list with the key in bold.
  it("turns a two-column table into a list, keeping inline formatting", () => {
    const table = [
      "Deployed:",
      "",
      "| Surface | Check |",
      "|---|---|",
      "| api | new wording served |",
      "| wiki | every chunk `application/javascript` |",
    ].join("\n");
    expect(convertTables(table)).toBe(
      ["Deployed:", "", "- **api**: new wording served", "- **wiki**: every chunk `application/javascript`"].join("\n"),
    );
  });

  it("turns a wider table into an aligned code block without inline markup", () => {
    const table = ["| Name | Size | Note |", "|:---|---:|---|", "| `a.ts` | 12 | **big** |", "| b.ts | 3 | small |"].join("\n");
    expect(convertTables(table)).toBe(
      ["```", "Name  Size  Note", "----  ----  -----", "a.ts  12    big", "b.ts  3     small", "```"].join("\n"),
    );
  });

  it("leaves text without a header separator alone", () => {
    const notATable = "a | b\n| just a pipe | in prose |\nend";
    expect(convertTables(notATable)).toBe(notATable);
  });

  // A block planted inside a block would end the outer one early and leave a stray fence behind.
  it("leaves a table quoted inside a code block as the code it is", () => {
    const quoted = ["Write it like this:", "```md", "| a | b | c |", "|---|---|---|", "| 1 | 2 | 3 |", "```", "and then:"].join(
      "\n",
    );
    expect(convertTables(quoted)).toBe(quoted);
    const after = `${quoted}\n| a | b |\n|---|---|\n| 1 | 2 |`;
    expect(convertTables(after)).toBe(`${quoted}\n- **1**: 2`);
  });

  it("keeps a pipe that is written as escaped, or sits inside inline code, in its cell", () => {
    const table = ["| Step | Command |", "|---|---|", "| count | `ls | wc -l` |", "| either | a \\| b |"].join("\n");
    expect(convertTables(table)).toBe(["- **count**: `ls | wc -l`", "- **either**: a | b"].join("\n"));
  });

  it("drops emphasis inside a block but not a star that multiplies", () => {
    const table = ["| Sum | Works out to | Note |", "|---|---|---|", "| 2 * 3 * 4 | 24 | *exact* |"].join("\n");
    expect(convertTables(table)).toContain("2 * 3 * 4  24            exact");
  });

  it("loses nothing a table says: a cell past the second, and a heading with no rows under it", () => {
    const ragged = ["| Key | Value |", "|---|---|", "| port | 8080 | default |"].join("\n");
    expect(convertTables(ragged)).toBe("- **port**: 8080 · default");
    expect(convertTables("| Key | Value |\n|---|---|")).toBe("- **Key**: Value");
  });
});

describe("repo links against a real repository", () => {
  // A blob URL names the committed tree, so a file that is only on disk would link to a 404.
  it("links a committed file and leaves an untracked one plain", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "claudetalk-links-"));
    // Without this a contributor whose git signs every commit would be asked for a key here.
    const run = (...args: string[]) =>
      execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
    run("init", "-q");
    run("config", "user.email", "tests@example.invalid");
    run("config", "user.name", "Tests");
    run("remote", "add", "origin", "https://example.com/acme/ledger.git");
    await fs.writeFile(path.join(repo, "committed.md"), "tracked\n");
    await fs.writeFile(path.join(repo, "local-only.md"), "not tracked\n");
    run("add", "committed.md");
    run("commit", "-q", "-m", "initial");

    const links = await resolveReferences(repo, "See `committed.md` and `local-only.md`.");
    expect(links?.file("committed.md")).toContain("/blob/");
    expect(links?.file("local-only.md")).toBeNull();
    await fs.rm(repo, { recursive: true, force: true });
  });

  // A conversation can work in a folder below the repository's root, and a blob link is written from the root.
  it("links a file named from a folder inside the repository by its path from the root", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "links-subfolder-"));
    const run = (...args: string[]) =>
      execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
    run("init", "-q");
    run("config", "user.email", "tests@example.invalid");
    run("config", "user.name", "Tests");
    run("remote", "add", "origin", "https://example.com/acme/ledger.git");
    const inside = path.join(repo, "packages", "app");
    await fs.mkdir(path.join(inside, "src"), { recursive: true });
    await fs.writeFile(path.join(inside, "src", "entry.ts"), "export {};\n");
    run("add", ".");
    run("commit", "-q", "-m", "initial");

    const links = await resolveReferences(inside, "See `src/entry.ts`.");
    expect(links?.file("src/entry.ts", "3")).toMatch(/\/blob\/[0-9a-f]{40}\/packages\/app\/src\/entry\.ts#L3$/);
    await fs.rm(repo, { recursive: true, force: true });
  });
});

describe("repo links", () => {
  const verified = {
    head: "abc1234abc1234abc1234abc1234abc1234abc12",
    prefix: "",
    commits: new Set(["e2ea070", "2d560e0"]),
    branches: new Set(["main", "feat/drain-on-stop"]),
    tags: new Set(["v0.14.0"]),
    files: new Set(["src/discord/turnFlow.ts", "README.md", "pkg/__init__.py"]),
  };
  const links = referenceLinks("https://github.com/someone/project", verified);
  const base = "https://github.com/someone/project";

  it("reads the web page out of every spelling of a remote", () => {
    expect(remoteWebUrl("git@github.com:someone/project.git")).toBe(base);
    expect(remoteWebUrl("https://github.com/someone/project.git")).toBe(base);
    expect(remoteWebUrl("https://github.com/someone/project")).toBe(base);
    expect(remoteWebUrl("ssh://git@gitlab.example.com:2222/team/thing.git")).toBe("https://gitlab.example.com/team/thing");
    // The port of an http remote is where the forge's pages are served too; an ssh one's is only ssh's.
    expect(remoteWebUrl("https://forge.example.com:8443/team/thing.git")).toBe("https://forge.example.com:8443/team/thing");
    expect(remoteWebUrl("http://forge.lan:3000/team/thing")).toBe("http://forge.lan:3000/team/thing");
    expect(remoteWebUrl("/srv/git/bare-repo.git")).toBeNull();
  });

  it("links a commit hash only when the repo knows it, keeping the embed suppressed", () => {
    expect(linkReferences("Pushed `e2ea070` and 2d560e0.", links)).toBe(
      `Pushed [e2ea070](<${base}/commit/e2ea070>) and [2d560e0](<${base}/commit/2d560e0>).`,
    );
    expect(linkReferences("Not a commit: `deadbee` nor cafef00d.", links)).toBe("Not a commit: `deadbee` nor cafef00d.");
  });

  // "#3" is as often the third point someone raised as a tracker item, and a link to the wrong item misleads.
  it("links a number only when the words before it name a change request", () => {
    expect(linkReferences("Landed as PR #8.", links)).toBe(`Landed as PR [#8](<${base}/issues/8>).`);
    expect(linkReferences("Pull requests #4, #5 and #6 merged.", links)).toBe(
      `Pull requests [#4](<${base}/issues/4>), [#5](<${base}/issues/5>) and [#6](<${base}/issues/6>) merged.`,
    );
    const plain = [
      "Let me speak concretely to issue #3.",
      "Landed as #8.",
      "That fixes #2 on your list, and step #4 is next.",
      "The PR covers points #1 and #2.",
    ];
    for (const text of plain) expect(linkReferences(text, links)).toBe(text);
  });

  it("sends a named merge request to the host's own page for one", () => {
    const gitlab = referenceLinks("https://gitlab.com/acme/ledger", verified);
    expect(linkReferences("MR #7 is up.", gitlab)).toBe("MR [#7](<https://gitlab.com/acme/ledger/-/merge_requests/7>) is up.");
  });

  it("links branches, tags and files with their lines", () => {
    expect(linkReferences("On `feat/drain-on-stop`, tagged `v0.14.0`.", links)).toBe(
      `On [feat/drain-on-stop](<${base}/tree/feat/drain-on-stop>), tagged [v0.14.0](<${base}/releases/tag/v0.14.0>).`,
    );
    expect(linkReferences("See `src/discord/turnFlow.ts:283` and src/discord/turnFlow.ts:10-12.", links)).toBe(
      `See [src/discord/turnFlow.ts:283](<${base}/blob/${verified.head}/src/discord/turnFlow.ts#L283>) and ` +
        `[src/discord/turnFlow.ts:10-12](<${base}/blob/${verified.head}/src/discord/turnFlow.ts#L10-L12>).`,
    );
  });

  it("leaves fenced code, existing links, wrapped urls and unknown names alone", () => {
    const fenced = "```\ngit show e2ea070\n```";
    expect(linkReferences(fenced, links)).toBe(fenced);
    const already = `[e2ea070](<${base}/commit/e2ea070>) and <${base}/pull/8> and \`src/missing.ts\` and \`nothing\``;
    expect(linkReferences(already, links)).toBe(already);
  });

  // A bare URL keeps working inside angle brackets, and Discord then hangs no embed under the message.
  it("wraps bare urls and links domain names, with the sentence's punctuation left outside", () => {
    expect(linkPlain("See https://example.org/docs/page, then example.com.")).toBe(
      "See <https://example.org/docs/page>, then [example.com](<https://example.com>).",
    );
    expect(linkPlain("package.json and index.ts are files, node.js too")).toBe(
      "package.json and index.ts are files, node.js too",
    );
  });

  // .sh and .app end a file name far more often than a site's, and a link to a stranger's domain misleads.
  it("leaves a script or an app bundle named in prose as text, and still links a site under the same ending", () => {
    const files = "Run deploy.sh and then install.sh, or open Info.app.";
    expect(linkPlain(files)).toBe(files);
    expect(linkReferences(files, links)).toBe(files);
    expect(linkPlain("It is up at ledger.example.app and get.example.sh/install.")).toBe(
      "It is up at [ledger.example.app](<https://ledger.example.app>) and [get.example.sh/install](<https://get.example.sh/install>).",
    );
  });

  it("keeps the markup and brackets around a url out of its target", () => {
    expect(linkPlain("**https://example.com/docs**")).toBe("**<https://example.com/docs>**");
    expect(linkPlain('_https://example.com_ and "https://example.com/a"')).toBe(
      '_<https://example.com>_ and "<https://example.com/a>"',
    );
    expect(linkPlain("[see https://example.com/b]")).toBe("[see <https://example.com/b>]");
    expect(linkPlain("(at https://example.com/c).")).toBe("(at <https://example.com/c>).");
  });

  it("keeps a closing bracket the url itself opened", () => {
    expect(linkPlain("See https://example.org/wiki/Ledger_(book).")).toBe("See <https://example.org/wiki/Ledger_(book)>.");
    expect(linkPlain("See [the book](https://example.org/wiki/Ledger_(book)).")).toBe(
      "See [the book](<https://example.org/wiki/Ledger_(book)>).",
    );
  });

  it("keeps any bracket the url itself opened, and still leaves out one that wraps it", () => {
    expect(linkPlain("GET https://api.example.com/v1/users/{id}")).toBe("GET <https://api.example.com/v1/users/{id}>");
    expect(linkPlain("Listening on http://[::1]")).toBe("Listening on <http://[::1]>");
    expect(linkPlain("See docs.example.com/api/{version}.")).toBe(
      "See [docs.example.com/api/{version}](<https://docs.example.com/api/{version}>).",
    );
    expect(linkPlain("{at https://example.com/d}")).toBe("{at <https://example.com/d>}");
  });

  // A trail's remarks pass the gate when they are noted and are linked afterwards, so an escape is already in the text by then.
  it("does not escape again what the gate escaped already, and keeps the escape out of the address", () => {
    expect(linkPlain(forDiscord("Cloning github.com/acme/my_repo now."))).toBe(
      "Cloning [github.com/acme/my\\_repo](<https://github.com/acme/my_repo>) now.",
    );
  });

  it("writes a folder above the working directory into a file link as a url holds it", () => {
    const inFolder = (prefix: string) => referenceLinks(base, { ...verified, prefix }).file("README.md", "3");
    expect(inFolder("my app/")).toBe(`${base}/blob/${verified.head}/my%20app/README.md#L3`);
    expect(inFolder("C#/what?/")).toBe(`${base}/blob/${verified.head}/C%23/what%3F/README.md#L3`);
    expect(inFolder("packages/app/")).toBe(`${base}/blob/${verified.head}/packages/app/README.md#L3`);
  });

  // Discord draws __init__ inside link text as underline, and the reader sees a file called init.
  it("escapes a marker in a file name it links, so the name reads as it is written", () => {
    expect(linkReferences("Edit `pkg/__init__.py`.", links)).toBe(
      `Edit [pkg/\\_\\_init\\_\\_.py](<${base}/blob/${verified.head}/pkg/__init__.py>).`,
    );
  });

  it("wraps the target of a link written in the answer, and leaves a wrapped or relative one alone", () => {
    const written = "The guide is in [Scripting Patterns](https://example.org/wiki/scripting).";
    const wrapped = "The guide is in [Scripting Patterns](<https://example.org/wiki/scripting>).";
    expect(linkPlain(written)).toBe(wrapped);
    expect(linkReferences(written, links)).toBe(wrapped);
    expect(linkPlain(wrapped)).toBe(wrapped);
    expect(linkPlain("See [the notes](docs/notes.md).")).toBe("See [the notes](docs/notes.md).");
  });

  // The usual way a commit is quoted is hash and subject in one code span; the hash is the reference.
  it("links the hash out of a code span that quotes a commit with its subject", () => {
    expect(linkReferences("On top of `e2ea070 fix(validator): reject a location`.", links)).toBe(
      `On top of [e2ea070](<${base}/commit/e2ea070>) \`fix(validator): reject a location\`.`,
    );
    expect(linkReferences("On top of `deadbee fix: nothing`.", links)).toBe("On top of `deadbee fix: nothing`.");
    expect([...collectReferences("`e2ea070 fix: subject`").hashes]).toEqual(["e2ea070"]);
  });

  // A slash in a code span is not a repository: media types, key paths and ratios all look the same.
  it("leaves an owner/repo-shaped code span alone", () => {
    const text = "Forked from `someone-else/thing`, served as `application/javascript`.";
    expect(linkReferences(text, links)).toBe(text);
  });

  it("uses each host's own path shapes, including GitLab's merge requests", () => {
    const gitlab = referenceLinks("https://gitlab.com/team/thing", verified);
    expect(gitlab.commit("e2ea070")).toBe("https://gitlab.com/team/thing/-/commit/e2ea070");
    expect(gitlab.file("README.md", "3")).toBe(`https://gitlab.com/team/thing/-/blob/${verified.head}/README.md#L3`);
    expect(linkReferences("Merged as !12.", gitlab)).toBe(
      "Merged as [!12](<https://gitlab.com/team/thing/-/merge_requests/12>).",
    );
    expect(linkReferences("Merged as !12.", links)).toBe("Merged as !12.");
    const bitbucket = referenceLinks("https://bitbucket.org/team/thing", verified);
    expect(bitbucket.commit("e2ea070")).toBe("https://bitbucket.org/team/thing/commits/e2ea070");
    expect(bitbucket.ref("main")).toBe("https://bitbucket.org/team/thing/branch/main");
  });

  it("collects only what the text mentions, so nothing else is looked up", () => {
    const found = collectReferences("Fixed in `e2ea070`, see `src/x.ts:4` on `main`; #12 too.");
    expect([...found.hashes]).toEqual(["e2ea070"]);
    expect([...found.files]).toEqual(["src/x.ts"]);
    expect(found.names.has("main")).toBe(true);
  });
});

describe("truncate", () => {
  // The limit handed to it is nearly always one Discord enforces, and a result three characters over it is refused.
  it("is never longer than the limit it is given, its ellipsis included", () => {
    for (const length of [99, 100, 101, 150, 5000]) expect(truncate("x".repeat(length), 100).length).toBeLessThanOrEqual(100);
    expect(truncate("x".repeat(101), 100)).toBe(`${"x".repeat(97)}...`);
    expect(truncate("short", 100)).toBe("short");
  });

  it("lets a menu be drawn whose option and placeholder are longer than Discord allows", async () => {
    const sink = channelSink(fakeDiscordChannel("menu-limits").channel);
    const menu = {
      id: "question:0",
      placeholder: "p".repeat(200),
      multiple: false,
      options: [{ value: "0", label: "l".repeat(150), description: "d".repeat(150) }],
    };
    const handle = await sink.askWithMenus!("Pick one", [menu], []);
    await handle.close("Picked.");
  });
});

describe("redactHome matches the home folder, not words that happen to share its letters", () => {
  it("hides a path under the home folder", () => {
    expect(redactHome(`see ${path.join(os.homedir(), "code", "thing")}`)).toMatch(/see ~[\\/]code[\\/]thing/);
  });

  // A longer name is some other account at most, so it may lose its name but never becomes this home.
  it("never mistakes a longer name that merely starts with the home path for the home itself", () => {
    const longer = `${os.homedir()}ger`;
    expect(redactHome(longer)).not.toContain("~");
  });

  it("does not touch the home folder's bare name in prose", () => {
    const word = path.basename(os.homedir());
    expect(redactHome(`the ${word} cause`)).toBe(`the ${word} cause`);
  });
});
