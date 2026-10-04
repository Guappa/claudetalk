import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveClaudeBin,
  claudeProjectsDir,
  assertSpawnable,
  expandShortPath,
  isWithin,
  killTree,
  samePath,
  turnSpawnOptions,
} from "../src/platform.ts";
import { bindingsPathFrom, loadConfig } from "../src/config.ts";
import { acquireInstanceLock, isLockHeld, lockPathBeside, STALE_AFTER_MS } from "../src/instanceLock.ts";
import { execFile, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { requestStop, stopRequestPath, takeStopRequest, watchForStop } from "../src/stopSignal.ts";

describe("platform", () => {
  it("prefers CLAUDE_BIN when set", () => {
    expect(resolveClaudeBin({ CLAUDE_BIN: "/opt/claude" })).toBe("/opt/claude");
  });

  // A .cmd shim is what npm installs on Windows, and Node cannot start one without a shell.
  it("finds a real executable on the PATH ahead of a script shim, and guesses only when there is none", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "on-path-"));
    const real = path.join(dir, process.platform === "win32" ? "claude.exe" : "claude");
    await fs.writeFile(path.join(dir, "claude.cmd"), "@echo off");
    await fs.writeFile(real, "");
    await fs.chmod(real, 0o755);

    expect(resolveClaudeBin({ PATH: dir })).toBe(real);
    expect(resolveClaudeBin({ PATH: await fs.mkdtemp(path.join(os.tmpdir(), "empty-path-")) })).toBe("claude");
  });

  it("rejects a script shim on Windows with an actionable message", () => {
    if (process.platform !== "win32") return;
    expect(() => assertSpawnable("C:/npm/claude.cmd")).toThrow(/CLAUDE_BIN/);
  });

  it("accepts a real executable", () => {
    expect(() => assertSpawnable("C:/Users/x/.local/bin/claude.exe")).not.toThrow();
  });

  it("resolves the projects directory under the user home", () => {
    expect(claudeProjectsDir()).toBe(path.join(os.homedir(), ".claude", "projects"));
  });
});

describe("loadConfig", () => {
  const valid = {
    DISCORD_BOT_TOKEN: "t",
    DISCORD_GUILD_ID: "g",
    DISCORD_OWNER_IDS: "100000000000000001,987654321098765432",
    PROJECTS_ROOT: "/home/u/projects",
  };

  it("parses a comma separated owner list", () => {
    expect(loadConfig(valid).ownerIds).toEqual(["100000000000000001", "987654321098765432"]);
  });

  it("names the missing variable when one is absent", () => {
    expect(() => loadConfig({ ...valid, DISCORD_BOT_TOKEN: undefined })).toThrow(/DISCORD_BOT_TOKEN/);
  });

  // Owners are the root of every access decision, so a bad list has to stop the bridge starting.
  it("refuses to start with no owner", () => {
    expect(() => loadConfig({ ...valid, DISCORD_OWNER_IDS: undefined })).toThrow(/DISCORD_OWNER_IDS/);
    expect(() => loadConfig({ ...valid, DISCORD_OWNER_IDS: " , " })).toThrow(/DISCORD_OWNER_IDS/);
  });

  it("pings after two minutes away unless PING_AFTER_SECONDS says otherwise, and refuses what is not a count of seconds", () => {
    expect(loadConfig(valid).pingAfterMs).toBe(120_000);
    expect(loadConfig({ ...valid, PING_AFTER_SECONDS: "0" }).pingAfterMs).toBe(0);
    expect(loadConfig({ ...valid, PING_AFTER_SECONDS: " 45 " }).pingAfterMs).toBe(45_000);
    expect(() => loadConfig({ ...valid, PING_AFTER_SECONDS: "2m" })).toThrow(/PING_AFTER_SECONDS is "2m"/);
  });

  it("takes the denial rules from TOOL_DENIALS, and names them all when one is wrong", () => {
    expect([...loadConfig(valid).toolDenials]).toHaveLength(6);
    expect([...loadConfig({ ...valid, TOOL_DENIALS: "none" }).toolDenials]).toEqual([]);
    expect(() => loadConfig({ ...valid, TOOL_DENIALS: "secrets,typos" })).toThrow(/TOOL_DENIALS.*"typos".*deletes, force-push/);
  });

  it("refuses an owner id that is not a Discord id", () => {
    expect(() => loadConfig({ ...valid, DISCORD_OWNER_IDS: "not-a-snowflake" })).toThrow(/not a Discord user id/);
    expect(() => loadConfig({ ...valid, DISCORD_OWNER_IDS: "12345" })).toThrow(/not a Discord user id/);
  });

  it("names which entry is wrong when only one of several is", () => {
    const broken = { ...valid, DISCORD_OWNER_IDS: "100000000000000001,oops" };
    expect(() => loadConfig(broken)).toThrow(/oops/);
  });
});

describe("where the lock lives", () => {
  it("is beside the bindings, wherever the setting puts them", () => {
    expect(lockPathBeside(bindingsPathFrom({}))).toBe(path.join("data", "bridge.lock"));
    const elsewhere = path.join("srv", "bridge", "conversations.json");
    expect(lockPathBeside(bindingsPathFrom({ BINDINGS_PATH: ` ${elsewhere} ` }))).toBe(path.join("srv", "bridge", "bridge.lock"));
  });
});

describe("stop requests", () => {
  let lockPath: string;

  beforeEach(async () => {
    lockPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "stop-")), "bridge.lock");
  });

  it("is consumed exactly once, so a stale request cannot stop the next run", async () => {
    await requestStop(lockPath);
    expect(await takeStopRequest(lockPath)).toBe("drain");
    expect(await takeStopRequest(lockPath)).toBeNull();
  });

  it("reports nothing when no stop was asked for", async () => {
    expect(await takeStopRequest(lockPath)).toBeNull();
  });

  it("carries the mode, and reads an older timestamp request as a drain", async () => {
    await requestStop(lockPath, "now");
    expect(await takeStopRequest(lockPath)).toBe("now");
    await fs.writeFile(stopRequestPath(lockPath), "2026-01-01T00:00:00.000Z");
    expect(await takeStopRequest(lockPath)).toBe("drain");
  });

  it("keeps the request beside the lock, not inside it", async () => {
    await requestStop(lockPath);
    expect(path.dirname(stopRequestPath(lockPath))).toBe(path.dirname(lockPath));
    expect(stopRequestPath(lockPath)).not.toBe(lockPath);
  });

  it("calls back once the request appears", async () => {
    const stopped = vi.fn();
    const timer = watchForStop(lockPath, stopped);
    await requestStop(lockPath);
    await vi.waitFor(() => expect(stopped).toHaveBeenCalled(), { timeout: 3000 });
    clearInterval(timer);
  });
});

describe("a stop takes the whole tree", () => {
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  // A build or a dev server a turn started through Bash would otherwise outlive the turn that was stopped.
  it("ends the process a turn started and the one that started under it", async () => {
    const grandchildScript = "setInterval(() => undefined, 1000)";
    const childScript = `const { spawn } = require("node:child_process"); const grandchild = spawn(process.execPath, ["-e", ${JSON.stringify(grandchildScript)}], { stdio: "ignore" }); console.log(grandchild.pid); setInterval(() => undefined, 1000);`;
    const child = spawn(process.execPath, ["-e", childScript], turnSpawnOptions(os.tmpdir()));
    const grandchildPid = Number(
      await new Promise<string>((resolve) => child.stdout!.once("data", (chunk: Buffer) => resolve(chunk.toString()))),
    );
    expect(alive(child.pid!)).toBe(true);
    expect(alive(grandchildPid)).toBe(true);

    killTree(child.pid!);
    await vi.waitFor(() => expect([alive(child.pid!), alive(grandchildPid)]).toEqual([false, false]), { timeout: 5000 });
  });
});

describe("killTree", () => {
  // On POSIX both signals throw for a process that has exited, and a Stop that lands late must not.
  it("does nothing, and does not throw, for a process that is already gone", async () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    const pid = child.pid!;
    await new Promise((resolve) => child.once("exit", resolve));
    expect(() => killTree(pid)).not.toThrow();
  });
});

describe("acquireInstanceLock", () => {
  let lockPath: string;

  beforeEach(async () => {
    lockPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "lock-")), "bridge.lock");
  });

  // Read and then written, the lock goes to both of two bridges starting in the same instant; taking it has to be one step.
  it("lets only one of two processes starting together take the lock", async () => {
    const lockModule = pathToFileURL(path.join(import.meta.dirname, "..", "src", "instanceLock.ts")).href;
    const contender = `
      import { acquireInstanceLock } from ${JSON.stringify(lockModule)};
      try {
        await acquireInstanceLock(process.argv[1]);
        console.log("ACQUIRED");
        setTimeout(() => undefined, 1500);
      } catch {
        console.log("REFUSED");
      }`;
    const start = (): Promise<string> =>
      new Promise((resolve) => {
        const flags = ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", contender, lockPath];
        execFile(process.execPath, flags, (_error, stdout) => resolve(stdout.trim()));
      });

    const outcomes = await Promise.all([start(), start(), start()]);
    expect(outcomes.filter((outcome) => outcome === "ACQUIRED")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "REFUSED")).toHaveLength(2);
  }, 20_000);

  it("acquires a lock when none exists", async () => {
    const lock = await acquireInstanceLock(lockPath);
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).pid).toBe(process.pid);
    await lock.release();
    expect(await fs.stat(lockPath).catch(() => null)).toBeNull();
  });

  // The stop script reads this to know it is waiting on a turn rather than on a dead bridge.
  it("reports how many turns it is draining, keeping the moment the drain began", async () => {
    const lock = await acquireInstanceLock(lockPath);
    await lock.noteDraining(2);
    const first = JSON.parse(await fs.readFile(lockPath, "utf8")).draining;
    await lock.noteDraining(1);
    const second = JSON.parse(await fs.readFile(lockPath, "utf8")).draining;
    expect(first).toEqual({ since: expect.any(String), turns: 2 });
    expect(second).toEqual({ since: first.since, turns: 1 });
    await lock.release();
  });

  it("refuses when another live process is still beating", async () => {
    const now = new Date().toISOString();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: now, heartbeatAt: now }));
    await expect(acquireInstanceLock(lockPath, () => true)).rejects.toThrow(/already running/i);
  });

  it("takes over a lock whose pid was reused but whose heartbeat stopped", async () => {
    const old = new Date(Date.now() - STALE_AFTER_MS - 1000).toISOString();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: old, heartbeatAt: old }));
    const lock = await acquireInstanceLock(lockPath, () => true);
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).pid).toBe(process.pid);
    await lock.release();
  });

  it("names the lock file so a stale one can be cleared", async () => {
    const now = new Date().toISOString();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: now, heartbeatAt: now }));
    await expect(acquireInstanceLock(lockPath, () => true)).rejects.toThrow(lockPath);
  });

  it("takes over a lock whose process is gone", async () => {
    const now = new Date().toISOString();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: now, heartbeatAt: now }));
    const lock = await acquireInstanceLock(lockPath, () => false);
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).pid).toBe(process.pid);
    await lock.release();
  });

  it("never treats its own pid as a competing holder", () => {
    const now = new Date().toISOString();
    expect(isLockHeld({ pid: process.pid, startedAt: now, heartbeatAt: now }, Date.now(), () => true)).toBe(false);
  });

  it("takes over a corrupt lock file rather than wedging", async () => {
    await fs.writeFile(lockPath, "not json");
    const lock = await acquireInstanceLock(lockPath);
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).pid).toBe(process.pid);
    await lock.release();
  });

  // A bridge suspended past the stale limit wakes to find its lock taken, and two bridges answer every message twice.
  it("stands down when its heartbeat finds the lock is another bridge's, and leaves that lock as it is", async () => {
    const lock = await acquireInstanceLock(lockPath);
    const takenBy: unknown[] = [];
    lock.whenTaken((holder) => takenBy.push(holder.pid));
    await lock.beat();
    expect(takenBy).toEqual([]);

    const successor = JSON.stringify({ pid: 999999, startedAt: "x", heartbeatAt: new Date().toISOString() });
    await fs.writeFile(lockPath, successor);
    await lock.beat();
    await lock.noteDraining(1);
    await lock.beat();
    expect(takenBy).toEqual([999999]);
    expect(await fs.readFile(lockPath, "utf8")).toBe(successor);
    await lock.release();
    expect(await fs.readFile(lockPath, "utf8")).toBe(successor);
  });

  it("releases only its own lock", async () => {
    const lock = await acquireInstanceLock(lockPath);
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: "x" }));
    await lock.release();
    expect(await fs.readFile(lockPath, "utf8")).toContain("999999");
  });
});

describe("turnSpawnOptions", () => {
  // The SDK speaks to the CLI over stdin, so closing it would cut the transport.
  it("pipes all three streams for the SDK transport", () => {
    expect(turnSpawnOptions("/tmp/x").stdio).toEqual(["pipe", "pipe", "pipe"]);
  });

  it("runs the turn in the conversation's directory, without a shell", () => {
    const options = turnSpawnOptions("/tmp/x");
    expect(options.cwd).toBe("/tmp/x");
    expect(options.shell).toBe(false);
  });
});

describe("samePath", () => {
  const asPlatform = (value: string, run: () => void): void => {
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value, configurable: true });
    try {
      run();
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  };

  it("treats case as identity on Linux, where two spellings are two folders", () => {
    asPlatform("linux", () => {
      expect(samePath("/home/u/Projects", "/home/u/projects")).toBe(false);
      expect(samePath("/home/u/Projects", "/home/u/Projects")).toBe(true);
    });
  });

  // Default APFS is case-insensitive, so a Mac would otherwise see one folder as two conversations.
  it("ignores case on macOS and Windows, where one folder has many spellings", () => {
    asPlatform("darwin", () => {
      expect(samePath("/Users/me/Projects", "/Users/me/projects")).toBe(true);
    });
    asPlatform("win32", () => {
      expect(samePath("C:/Users/me/Projects", "c:/users/me/projects")).toBe(true);
    });
  });
});

describe("8.3 short paths", () => {
  it("expands a short segment to the long name Windows knows it by", () => {
    if (process.platform !== "win32") return;
    const short = os.tmpdir();
    if (!/~\d/.test(short)) return;
    expect(expandShortPath(short)).not.toMatch(/~\d/);
  });

  it("leaves a path without a short segment exactly as written", () => {
    expect(expandShortPath("/p/thing")).toBe("/p/thing");
  });

  it("does nothing outside Windows, where a tilde is just a character", () => {
    if (process.platform === "win32") return;
    expect(expandShortPath("/tmp/RUNNER~1")).toBe("/tmp/RUNNER~1");
  });
});

describe("isWithin", () => {
  it("is true for a folder inside the parent and false for the parent itself", () => {
    expect(isWithin("/p", "/p/thing")).toBe(true);
    expect(isWithin("/p", "/p/thing/deeper")).toBe(true);
    expect(isWithin("/p", "/p")).toBe(false);
  });

  it("does not mistake a sibling that shares a prefix", () => {
    expect(isWithin("/p", "/pthing")).toBe(false);
    expect(isWithin("/p", "/q/p")).toBe(false);
  });

  it("follows the platform's idea of case", () => {
    if (process.platform === "linux") return;
    expect(isWithin("/P", "/p/thing")).toBe(true);
  });
});
