import fs from "node:fs/promises";
import path from "node:path";

const STOP_POLL_MS = 500;

// "drain" lets running turns finish first; "now" cuts them short; "restart" waits until nothing is running and then leaves in a way that asks whatever started the bridge to start it again.
export type StopMode = "drain" | "now" | "restart";

// A restart asked for from inside a turn names the conversation, so the bridge that comes back knows where to say so.
export interface StopRequest {
  mode: StopMode;
  sessionId?: string;
}

// What a supervisor is told to start the bridge again on: the wrappers and the service definitions all read it.
export const RESTART_EXIT_CODE = 75;

// A signal cannot cross a session boundary, so a file is what reaches a bridge in session 0.
export function stopRequestPath(lockPath: string): string {
  return path.join(path.dirname(lockPath), "stop.request");
}

// Written beside and renamed over: the bridge polls the path and must never read a half-written request.
export async function requestStop(lockPath: string, mode: StopMode = "drain", sessionId?: string): Promise<void> {
  const target = stopRequestPath(lockPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, sessionId ? `${mode} ${sessionId}` : mode, "utf8");
  await fs.rename(temp, target);
}

// A request written by an older bridge holds a timestamp, which reads as a plain drain.
export async function takeStopRequest(lockPath: string): Promise<StopRequest | null> {
  const target = stopRequestPath(lockPath);
  try {
    const content = await fs.readFile(target, "utf8");
    await fs.rm(target);
    const [mode, sessionId] = content.trim().split(/\s+/);
    if (mode === "restart") return sessionId ? { mode, sessionId } : { mode };
    return { mode: mode === "now" ? "now" : "drain" };
  } catch {
    return null;
  }
}

export function watchForStop(lockPath: string, onStop: (request: StopRequest) => void): NodeJS.Timeout {
  const timer = setInterval(() => {
    void takeStopRequest(lockPath).then((request) => {
      if (request) onStop(request);
    });
  }, STOP_POLL_MS);
  timer.unref();
  return timer;
}

const IDLE_POLL_MS = 250;

// Calls back the first moment nothing is running, and takes nothing from anyone until then: a bridge that drained for a restart would refuse every conversation for as long as the longest turn anywhere ran. The function returned calls the wait off.
export function whenIdle(activeCount: () => number, onIdle: () => void, pollMs: number = IDLE_POLL_MS): () => void {
  const timer = setInterval(() => {
    if (activeCount() > 0) return;
    clearInterval(timer);
    onIdle();
  }, pollMs);
  timer.unref();
  return () => clearInterval(timer);
}
