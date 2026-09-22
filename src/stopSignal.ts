import fs from "node:fs/promises";
import path from "node:path";

const STOP_POLL_MS = 500;

// A signal cannot cross a session boundary, so a file is what reaches a bridge in session 0.
export function stopRequestPath(lockPath: string): string {
  return path.join(path.dirname(lockPath), "stop.request");
}

export async function requestStop(lockPath: string): Promise<void> {
  const target = stopRequestPath(lockPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, new Date().toISOString(), "utf8");
}

export async function takeStopRequest(lockPath: string): Promise<boolean> {
  const target = stopRequestPath(lockPath);
  try {
    await fs.rm(target);
    return true;
  } catch {
    return false;
  }
}

export function watchForStop(lockPath: string, onStop: () => void): NodeJS.Timeout {
  const timer = setInterval(() => {
    void takeStopRequest(lockPath).then((requested) => {
      if (requested) onStop();
    });
  }, STOP_POLL_MS);
  timer.unref();
  return timer;
}
