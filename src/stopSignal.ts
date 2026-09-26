import fs from "node:fs/promises";
import path from "node:path";

const STOP_POLL_MS = 500;

// "drain" lets running turns finish first; "now" cuts them short.
export type StopMode = "drain" | "now";

// A signal cannot cross a session boundary, so a file is what reaches a bridge in session 0.
export function stopRequestPath(lockPath: string): string {
  return path.join(path.dirname(lockPath), "stop.request");
}

// Written beside and renamed over: the bridge polls the path and must never read a half-written request.
export async function requestStop(lockPath: string, mode: StopMode = "drain"): Promise<void> {
  const target = stopRequestPath(lockPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, mode, "utf8");
  await fs.rename(temp, target);
}

// A request written by an older bridge holds a timestamp, which reads as a plain drain.
export async function takeStopRequest(lockPath: string): Promise<StopMode | null> {
  const target = stopRequestPath(lockPath);
  try {
    const content = await fs.readFile(target, "utf8");
    await fs.rm(target);
    return content.trim() === "now" ? "now" : "drain";
  } catch {
    return null;
  }
}

export function watchForStop(lockPath: string, onStop: (mode: StopMode) => void): NodeJS.Timeout {
  const timer = setInterval(() => {
    void takeStopRequest(lockPath).then((mode) => {
      if (mode) onStop(mode);
    });
  }, STOP_POLL_MS);
  timer.unref();
  return timer;
}
