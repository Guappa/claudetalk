import { resolve } from "node:path";
import { checkBoot } from "../src/bootCheck.ts";
import { bindingsPathFrom } from "../src/config.ts";
import { isProcessAlive, lockPathBeside } from "../src/instanceLock.ts";
import { readJsonOr } from "../src/jsonFile.ts";
import { requestStop } from "../src/stopSignal.ts";

// Found the way the bridge finds it, from the same setting, or a BINDINGS_PATH elsewhere would have this looking in an empty folder.
const lockPath = resolve(lockPathBeside(bindingsPathFrom(process.env)));

const lock = await readJsonOr(lockPath, () => null);
if (typeof lock?.pid !== "number" || !isProcessAlive(lock.pid)) {
  console.error(`No bridge is running: there is no live lock at ${lockPath}. Start it the way it is normally started.`);
  process.exit(1);
}

// An older bridge reads a restart as a plain stop, and one started by hand has nothing to start it again: either would only be gone.
if (!lock.supervised) {
  console.error(
    `Not restarted: nothing would start bridge pid ${lock.pid} again once it stopped. It was started by hand, or it predates restarts, or its service was installed before them. ` +
      "Stop it with `npm run stop` and start it again; on Linux or macOS, run the autostart installer from the README first.",
  );
  process.exit(1);
}

const check = await checkBoot();
if (!check.ok) {
  console.error(
    check.timedOut
      ? "Not restarted: checking that the code here would start took over a minute and was given up. The bridge keeps running as it is."
      : `Not restarted: the code here would not start, so the bridge keeps running as it is. Fix what this names, then ask again.\n\n${check.output}`,
  );
  process.exit(1);
}

// Run from inside a turn, this names the conversation, so the bridge that comes back says so in its channel.
await requestStop(lockPath, "restart", process.env.CLAUDE_CODE_SESSION_ID);
console.log(
  `Restart asked of bridge pid ${lock.pid}. It restarts once the running turns have finished, a turn this was run from included, so there is nothing to wait for here.`,
);
