import fs from "node:fs";
import nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Vitest compiles with esbuild, which accepts syntax Node's type stripper rejects, so green tests do not prove the bridge starts.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

// The stripper itself is asked, as Node asks it when it loads a file: a syntax check run with the flag does not apply its rules.
export function refusal(source, strip = nodeModule.stripTypeScriptTypes) {
  try {
    strip(source, { mode: "strip" });
    return null;
  } catch (error) {
    return error.message;
  }
}

// A Node built without TypeScript support, as some distribution packages are, refuses every file alike, which reads as a fault in the code.
export function strippingUnavailable(strip = nodeModule.stripTypeScriptTypes) {
  try {
    strip("const probe: number = 1;", { mode: "strip" });
    return false;
  } catch (error) {
    return error.code === "ERR_NO_TYPESCRIPT";
  }
}

// Compared as real paths: reached through a junction or a linked folder the two spell the same file differently, and the check would do nothing and pass.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  if (typeof nodeModule.stripTypeScriptTypes !== "function") {
    console.error(
      `This check asks Node's type stripper directly, which Node ${process.versions.node} does not offer to a script. The bridge runs on it; the check needs Node 22.13 or newer. Run it again under a newer Node, for example \`nvm use 24\`.`,
    );
    process.exit(1);
  }

  if (strippingUnavailable()) {
    console.error(
      `This Node (${process.versions.node}, ${process.execPath}) was built without TypeScript support, so it cannot run the bridge, which loads its source as TypeScript. Distribution packages are sometimes built this way; Ubuntu's nodejs package is one. Install an upstream build instead, from nodejs.org, NodeSource, nvm or fnm, and run the check again.`,
    );
    process.exit(1);
  }

  const failures = sourceFiles(root).flatMap((file) => {
    const refused = refusal(fs.readFileSync(file, "utf8"));
    return refused === null ? [] : [`${path.relative(path.join(root, ".."), file)}\n${refused}`];
  });

  if (failures.length > 0) {
    console.error(failures.join("\n\n"));
    console.error(
      `\n${failures.length} file(s) would not load under Node's type stripper, which removes types and transforms nothing. The usual causes are a TypeScript parameter property, an enum or a namespace: write the field and its assignment out, or use a const object.`,
    );
    process.exit(1);
  }
  console.log("Every source file loads under Node's type stripper.");
}
