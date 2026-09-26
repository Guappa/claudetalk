import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isProcessAlive } from "../src/instanceLock.ts";
import { requestStop, stopRequestPath } from "../src/stopSignal.ts";

const lockPath = resolve(process.env.BRIDGE_LOCK ?? "data/bridge.lock");
const mode = process.argv.includes("--now") ? "now" : "drain";
// The bridge has this long to either exit or report that it is waiting on a turn.
const ACK_MS = 15_000;
const POLL_MS = 200;

function readLock() {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

const lock = readLock();
if (!lock) {
  console.log(`No bridge lock at ${lockPath}. Nothing appears to be running.`);
  process.exit(0);
}

if (!isProcessAlive(lock.pid)) {
  console.log(`Bridge pid ${lock.pid} is already gone. Clearing the stale lock.`);
  rmSync(lockPath, { force: true });
  process.exit(0);
}

await requestStop(lockPath, mode);

// The bridge clears the lock itself on a clean shutdown, so the lock going is the proof.
let reported = -1;
for (let waited = 0; ; waited += POLL_MS) {
  if (!existsSync(lockPath)) {
    console.log(`Stopped bridge pid ${lock.pid}.`);
    process.exit(0);
  }
  const turns = readLock()?.draining?.turns;
  if (typeof turns === "number") {
    if (turns !== reported) {
      reported = turns;
      const cut = mode === "now" ? "" : " Run `npm run stop:now` to cut them short.";
      if (turns > 0) console.log(`Bridge pid ${lock.pid} is finishing ${turns} running turn(s) first.${cut}`);
    }
  } else if (waited >= ACK_MS) {
    break;
  }
  await delay(POLL_MS);
}

rmSync(stopRequestPath(lockPath), { force: true });
console.error(
  `Bridge pid ${lock.pid} did not answer within ${ACK_MS / 1000} seconds. It may be running a version ` +
    `that predates stop requests. Try again, or stop the scheduled task and delete ${lockPath}.`,
);
process.exit(1);
