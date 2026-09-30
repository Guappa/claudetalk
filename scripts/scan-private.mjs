#!/usr/bin/env node
// Fails on anything that would be a leak once this repository is public.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".claude", "coverage"]);
// The bridge's own state lives in data/ at the root and is never committed; a folder of that name anywhere else is ordinary.
const SKIP_AT_ROOT = new Set(["data"]);
// Everything is read but what cannot hold a path in words. A list of what to read left out the transcripts kept as fixtures, the files likeliest to be captured from a real session.
const BINARY = /\.(webp|png|jpe?g|gif|ico|pdf|zip|gz|woff2?)$/i;

// Shapes, not names: these mean the same thing in anyone's checkout.
export const SHAPES = [
  // A key's body takes hyphens and underscores after its prefix, as in sk-ant-api03-... and sk-proj-...
  [
    "a credential",
    /(gh[pousr]_[A-Za-z0-9]{16,}|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|(?<![A-Za-z0-9_-])[MNO][A-Za-z0-9_-]{22,27}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/,
  ],
  // A Windows path in source or JSON is written with its separators doubled.
  [
    "a real home directory",
    /([A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?!(?:your?|user|USER|me)[\\/])[A-Za-z0-9 ._-]{2,}[\\/]|\/home\/(?!(?:user|you|me)\/)[a-z0-9._-]{2,}\/|\/Users\/(?!(?:you|user|me)\/)[A-Za-z0-9 ._-]{2,}\/)/,
  ],
  ["an 8.3 short path", /[\\/][A-Za-z0-9]+~[0-9][\\/]/],
];

// A snowflake is just digits, so it is only a leak where prose would never need one.
export const DOC_ONLY = [["a Discord id", /[0-9]{17,20}/]];
const DOCS = new Set(["README.md", "CONTRIBUTING.md", ".env.example"]);

function localTerms() {
  const file = path.join(root, ".private-terms");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || (dir === root && SKIP_AT_ROOT.has(entry))) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

// What git would publish: every file it tracks, and every new one it does not ignore.
export function publishable() {
  try {
    const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
    });
    const files = listed.split("\0").filter((file) => file && existsSync(path.join(root, file)));
    return files.filter((file) => !BINARY.test(file)).map((file) => path.join(root, file));
  } catch {
    // Outside a checkout, an archive somebody downloaded for one, what is under the root is what there is to read.
    return walk(root).filter((file) => !BINARY.test(file));
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

export function scan() {
  const terms = localTerms();
  const findings = [];

  for (const file of publishable()) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (relative === "scripts/scan-private.mjs" || relative.endsWith("package-lock.json")) continue;

    const text = readFileSync(file, "utf8");
    const rules = [...SHAPES, ...(DOCS.has(relative) || relative.startsWith("docs/") ? DOC_ONLY : [])];

    for (const [label, pattern] of rules) {
      const match = pattern.exec(text);
      if (match) findings.push({ file: relative, line: lineOf(text, match.index), label });
    }

    const lower = text.toLowerCase();
    for (const term of terms) {
      const at = lower.indexOf(term.toLowerCase());
      if (at !== -1) {
        findings.push({ file: relative, line: lineOf(text, at), label: `a private term (${term.slice(0, 2)}***)` });
      }
    }
  }

  return { findings, termCount: terms.length };
}

// Compared as real paths: reached through a junction or a linked folder the two spell the same file differently, and the scan would do nothing and pass.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { findings, termCount } = scan();
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}  ${finding.label}`);
  }
  if (findings.length > 0) {
    console.error(`\n${findings.length} would leak once this repository is public. Remove them, or use an invented example.`);
    process.exit(1);
  }
  console.log(`Clean. Shapes checked everywhere, plus ${termCount} local terms from .private-terms.`);
}
