#!/usr/bin/env node
// Fails on anything that would be a leak once this repository is public.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "data", "dist", ".claude", "coverage"]);
const TEXT = /\.(ts|mts|mjs|js|json|md|yml|yaml|sh|ps1|txt|example)$/;

// Shapes, not names: these mean the same thing in anyone's checkout.
export const SHAPES = [
  ["a credential", /(gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{16,}|MT[A-Za-z0-9._-]{40,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/],
  ["a real home directory", /([A-Za-z]:[\\/]Users[\\/](?!<|your|user|USER|me\b)[A-Za-z0-9 ._-]{2,}[\\/]|\/home\/(?!user|you|me\b)[a-z0-9._-]{2,}\/|\/Users\/(?!you|user|me\b)[A-Za-z0-9 ._-]{2,}\/)/],
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
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (TEXT.test(entry)) found.push(full);
  }
  return found;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

export function scan() {
  const terms = localTerms();
  const findings = [];

  for (const file of walk(root)) {
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
