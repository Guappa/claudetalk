import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Tests make their folders under the system temp folder and remove none of them. One folder is made for the run, every test's land inside it, and it goes when the run ends.
export default function setup(): () => void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudetalk-tests-"));
  for (const name of ["TMPDIR", "TEMP", "TMP"]) process.env[name] = root;
  return () => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
