import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const CHECK_TIMEOUT_MS = 60_000;
const SHOWN_CHARS = 1200;

// What the entry point is started with to be checked and not run.
export const CHECK_FLAG = "--check";

export type BootCheck = { ok: true } | { ok: false; timedOut: boolean; output: string };

const root = fileURLToPath(new URL("..", import.meta.url));

// Node lets a variable that is already set win over the file, and a running bridge got its own from that file when it started: left in, the check would read the settings of the last start and not of the next.
function withoutFileSettings(cwd: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let file: string;
  try {
    file = readFileSync(path.join(cwd, ".env"), "utf8");
  } catch {
    return env;
  }
  const fresh = { ...env };
  for (const key of Object.keys(parseEnv(file))) delete fresh[key];
  return fresh;
}

// The same entry under the same flags as a real start, stopped before it takes the lock or logs in: whatever would keep the bridge from coming up keeps this from passing.
export function checkBoot(cwd: string = root, env: NodeJS.ProcessEnv = process.env): Promise<BootCheck> {
  const { promise, resolve } = Promise.withResolvers<BootCheck>();
  const flags = ["--env-file-if-exists=.env", "--experimental-strip-types", "--disable-warning=ExperimentalWarning"];
  const child = spawn(process.execPath, [...flags, path.join(root, "src", "index.ts"), CHECK_FLAG], {
    cwd,
    env: withoutFileSettings(cwd, env),
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const said = { tail: "" };
  const keep = (chunk: Buffer): void => {
    said.tail = `${said.tail}${chunk.toString("utf8")}`.slice(-SHOWN_CHARS);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const timer = setTimeout(() => {
    child.kill();
    resolve({ ok: false, timedOut: true, output: said.tail.trim() });
  }, CHECK_TIMEOUT_MS);
  child.on("error", (error) => {
    clearTimeout(timer);
    resolve({ ok: false, timedOut: false, output: error.message });
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    resolve(code === 0 ? { ok: true } : { ok: false, timedOut: false, output: said.tail.trim() });
  });
  return promise;
}
