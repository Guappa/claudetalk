import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Vitest compiles with esbuild, which accepts syntax Node's type stripper rejects, so green tests do not prove the bridge starts.
const root = path.join(import.meta.dirname, "..", "src");

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

const failures = [];
for (const file of sourceFiles(root)) {
  const checked = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--check", file], {
    encoding: "utf8",
  });
  if (checked.status !== 0) failures.push(`${path.relative(path.join(root, ".."), file)}\n${checked.stderr.trim()}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  console.error(
    `\n${failures.length} file(s) would not load under Node's type stripper. The usual causes are a TypeScript parameter property, an enum, or a file whose first statement is neither an import nor an export.`,
  );
  process.exit(1);
}
console.log("Every source file loads under Node's type stripper.");
