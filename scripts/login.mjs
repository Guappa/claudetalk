import { spawn } from "node:child_process";
import { assertSpawnable, resolveClaudeBin } from "../src/platform.ts";

// Signs in the Claude Code the bridge uses, the SDK's own build when no other is installed, so no separate install is needed to start.
const bin = resolveClaudeBin();
try {
  assertSpawnable(bin);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`Signing in with ${bin}`);

const child = spawn(bin, ["auth", "login", ...process.argv.slice(2)], { stdio: "inherit" });
child.on("error", (error) => {
  console.error(
    `Could not start ${bin}: ${error.message}. Run \`npm ci\`, which installs the Claude Code the Agent SDK ships, or set CLAUDE_BIN in .env to an installed claude.`,
  );
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
