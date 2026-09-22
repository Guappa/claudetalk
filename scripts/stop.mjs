import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isProcessAlive } from "../src/instanceLock.ts";
import { requestStop, stopRequestPath } from "../src/stopSignal.ts";

const lockPath = resolve(process.env.BRIDGE_LOCK ?? "data/bridge.lock");
const WAIT_MS = 15_000;
const POLL_MS = 200;

let lock;
try {
  lock = JSON.parse(readFileSync(lockPath, "utf8"));
} catch {
  console.log(`No bridge lock at ${lockPath}. Nothing appears to be running.`);
  process.exit(0);
}

if (!isProcessAlive(lock.pid)) {
  console.log(`Bridge pid ${lock.pid} is already gone. Clearing the stale lock.`);
  rmSync(lockPath, { force: true });
  process.exit(0);
}

await requestStop(lockPath);

// The bridge clears the lock itself on a clean shutdown, so the lock going is the proof.
for (let waited = 0; waited < WAIT_MS; waited += POLL_MS) {
  if (!existsSync(lockPath)) {
    console.log(`Stopped bridge pid ${lock.pid}.`);
    process.exit(0);
  }
  await delay(POLL_MS);
}

rmSync(stopRequestPath(lockPath), { force: true });
console.error(
  `Bridge pid ${lock.pid} did not stop within ${WAIT_MS / 1000} seconds. It may be mid-turn, ` +
    `or running a version that predates stop requests. Try again, or stop the scheduled ` +
    `task and delete ${lockPath}.`,
);
process.exit(1);
