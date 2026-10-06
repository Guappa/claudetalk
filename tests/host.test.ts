import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveClaudeBin,
  bundledClaudeBin,
  sameExecutable,
  claudeProjectsDir,
  assertSpawnable,
  expandShortPath,
  isWithin,
  killTree,
  samePath,
  turnSpawnOptions,
} from "../src/platform.ts";
import { bindingsPathFrom, loadConfig } from "../src/config.ts";
import { UpdateCheck, changesIn, githubSlug, isNewer, newestVersion } from "../src/updateCheck.ts";
import { checkBoot } from "../src/bootCheck.ts";
import { buildName } from "../src/version.ts";
import { acquireInstanceLock, isLockHeld, lockPathBeside, STALE_AFTER_MS } from "../src/instanceLock.ts";
import { execFile, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { requestStop, stopRequestPath, takeStopRequest, watchForStop, whenIdle } from "../src/stopSignal.ts";

describe("platform", () => {
  it("prefers CLAUDE_BIN when set", () => {
    expect(resolveClaudeBin({ CLAUDE_BIN: "/opt/claude" })).toBe("/opt/claude");
  });

  // A .cmd shim is what npm installs on Windows, and Node cannot start one without a shell.
  it("finds a real executable on the PATH ahead of a script shim, then the SDK's build, and guesses only when there is neither", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "on-path-"));
    const real = path.join(dir, process.platform === "win32" ? "claude.exe" : "claude");
    await fs.writeFile(path.join(dir, "claude.cmd"), "@echo off");
    await fs.writeFile(real, "");
    await fs.chmod(real, 0o755);
    const emptyPath = await fs.mkdtemp(path.join(os.tmpdir(), "empty-path-"));

    expect(resolveClaudeBin({ PATH: dir }, () => "/sdk/claude")).toBe(real);
    expect(resolveClaudeBin({ PATH: emptyPath }, () => "/sdk/claude")).toBe("/sdk/claude");
    expect(resolveClaudeBin({ PATH: emptyPath }, () => null)).toBe("claude");
  });

  it("lets a script shim give way to the SDK's build, and keeps it only when there is nothing else", async () => {
    if (process.platform !== "win32") return;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shim-only-"));
    const shim = path.join(dir, "claude.cmd");
    await fs.writeFile(shim, "@echo off");

    expect(resolveClaudeBin({ PATH: dir }, () => "C:/sdk/claude.exe")).toBe("C:/sdk/claude.exe");
    expect(resolveClaudeBin({ PATH: dir }, () => null)).toBe(shim);
  });

  // npm installs the musl build alone on Alpine, so a lookup that knew only the glibc name would find nothing there.
  it("finds the SDK's build under either Linux package name, and nothing when neither is installed", () => {
    const installed = (names: string[]) => (specifier: string) => {
      if (!names.some((name) => specifier === `${name}/package.json`)) throw new Error("not installed");
      return `/app/node_modules/${specifier}`;
    };
    const glibc = "@anthropic-ai/claude-agent-sdk-linux-x64";

    expect(bundledClaudeBin(installed([glibc]), "linux", "x64")).toBe(path.join(`/app/node_modules/${glibc}`, "claude"));
    expect(bundledClaudeBin(installed([`${glibc}-musl`]), "linux", "x64")).toBe(
      path.join(`/app/node_modules/${glibc}-musl`, "claude"),
    );
    expect(bundledClaudeBin(installed([]), "linux", "x64")).toBeNull();
    expect(bundledClaudeBin(installed(["@anthropic-ai/claude-agent-sdk-darwin-arm64-musl"]), "darwin", "arm64")).toBeNull();
  });

  it("takes one build reached by two spellings for one build", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "same-bin-"));
    const bin = path.join(dir, "claude");
    await fs.writeFile(bin, "");

    expect(sameExecutable(bin, path.join(dir, ".", "claude"))).toBe(true);
    expect(sameExecutable(path.relative(process.cwd(), bin), bin)).toBe(true);
    expect(sameExecutable(bin, path.join(dir, "other"))).toBe(false);
    expect(sameExecutable(bin, null)).toBe(false);
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

  it("asks an owner before each step unless approvals are switched off", () => {
    expect(loadConfig(valid).toolApprovals).toBe(true);
    expect(loadConfig({ ...valid, CLAUDE_TOOL_APPROVALS: "false" }).toolApprovals).toBe(false);
  });

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

  it("leaves a turn unlimited unless CLAUDE_MAX_TURNS gives a count of model calls, and refuses what is not one", () => {
    expect(loadConfig(valid).maxTurns).toBeNull();
    expect(loadConfig({ ...valid, CLAUDE_MAX_TURNS: " 200 " }).maxTurns).toBe(200);
    expect(() => loadConfig({ ...valid, CLAUDE_MAX_TURNS: "0" })).toThrow(/CLAUDE_MAX_TURNS is "0"/);
    expect(() => loadConfig({ ...valid, CLAUDE_MAX_TURNS: "many" })).toThrow(/CLAUDE_MAX_TURNS is "many"/);
  });

  it("checks for a newer version unless UPDATE_CHECK says not to, and refuses what is neither true nor false", () => {
    expect(loadConfig(valid).updateCheck).toBe(true);
    expect(loadConfig({ ...valid, UPDATE_CHECK: "false" }).updateCheck).toBe(false);
    expect(() => loadConfig({ ...valid, UPDATE_CHECK: "no" })).toThrow(/UPDATE_CHECK is "no"/);
  });

  it("takes the denial rules from TOOL_DENIALS, and names them all when one is wrong", () => {
    expect([...loadConfig(valid).toolDenials]).toHaveLength(7);
    expect([...loadConfig({ ...valid, TOOL_DENIALS: "none" }).toolDenials]).toEqual([]);
    expect(() => loadConfig({ ...valid, TOOL_DENIALS: "secrets,typos" })).toThrow(
      /TOOL_DENIALS.*"typos".*deletes, writes, force-push/,
    );
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
    expect(await takeStopRequest(lockPath)).toEqual({ mode: "drain" });
    expect(await takeStopRequest(lockPath)).toBeNull();
  });

  it("reports nothing when no stop was asked for", async () => {
    expect(await takeStopRequest(lockPath)).toBeNull();
  });

  it("carries the mode, and reads an older timestamp request as a drain", async () => {
    await requestStop(lockPath, "now");
    expect(await takeStopRequest(lockPath)).toEqual({ mode: "now" });
    await fs.writeFile(stopRequestPath(lockPath), "2026-01-01T00:00:00.000Z");
    expect(await takeStopRequest(lockPath)).toEqual({ mode: "drain" });
  });

  // The conversation is how the bridge that comes back knows where to say so.
  it("carries a restart, and the conversation it was asked from when there is one", async () => {
    await requestStop(lockPath, "restart");
    expect(await takeStopRequest(lockPath)).toEqual({ mode: "restart" });
    await requestStop(lockPath, "restart", "3f0c1d2e-0000-4000-8000-000000000001");
    expect(await takeStopRequest(lockPath)).toEqual({ mode: "restart", sessionId: "3f0c1d2e-0000-4000-8000-000000000001" });
  });

  // A restart must take nothing from a conversation that did not ask for it, so it waits for idle and refuses nobody meanwhile.
  it("waits for a restart until nothing is running, however long that takes, and then goes once", () => {
    vi.useFakeTimers();
    try {
      const running = { turns: 2 };
      const restarted = vi.fn();
      whenIdle(() => running.turns, restarted, 250);

      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(restarted).not.toHaveBeenCalled();
      running.turns = 0;
      vi.advanceTimersByTime(250);
      expect(restarted).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5000);
      expect(restarted).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restart once the wait is called off", () => {
    vi.useFakeTimers();
    try {
      const restarted = vi.fn();
      const callOff = whenIdle(() => 0, restarted, 250);
      callOff();
      vi.advanceTimersByTime(5000);
      expect(restarted).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

  // The restart script reads this before it asks: a bridge nothing would start again must not be told to leave.
  it("says in the lock that it is supervised, and says nothing of it when it is not", async () => {
    const supervised = await acquireInstanceLock(lockPath, undefined, true);
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).supervised).toBe(true);
    await supervised.release();

    const byHand = await acquireInstanceLock(lockPath);
    expect(JSON.parse(await fs.readFile(lockPath, "utf8"))).not.toHaveProperty("supervised");
    await byHand.release();
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

describe("the check for a newer version", () => {
  // Given wherever a newer version is found, so that no test asks GitHub what changed.
  const nothingChanged = async (): Promise<string[]> => [];

  it("finds the repository in the address package.json gives, and none in an address that is not GitHub's", () => {
    expect(githubSlug("git+https://github.com/someone/some-bridge.git")).toBe("someone/some-bridge");
    expect(githubSlug("git@github.com:someone/some.bridge.git")).toBe("someone/some.bridge");
    expect(githubSlug("https://github.com/someone/some-bridge")).toBe("someone/some-bridge");
    expect(githubSlug("https://example.org/someone/some-bridge.git")).toBeNull();
    expect(githubSlug(undefined)).toBeNull();
  });

  it("compares versions number by number, and never ranks what is not a version", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.9.9", "0.10.0")).toBe(false);
    expect(isNewer("0.9.0", "0.9.0")).toBe(false);
    expect(isNewer("1.0.0-rc.1", "0.9.0")).toBe(false);
    expect(isNewer("1.0.0", "unknown")).toBe(false);
  });

  it("picks the newest version among tags in any order, leaving out tags that are not versions", () => {
    expect(newestVersion(["v0.9.0", "nightly", "v0.10.1", "v0.10.0", "v1.0.0-rc.1"])).toBe("0.10.1");
    expect(newestVersion(["nightly"])).toBeNull();
    expect(newestVersion([])).toBeNull();
  });

  it("names a newer version, and none while the running one is the newest tagged or ahead of the tags", async () => {
    const behind = new UpdateCheck("0.9.0", "someone/some-bridge", async () => ["v0.9.0", "v0.10.0"], nothingChanged);
    await behind.refresh();
    expect(behind.newer()).toBe("0.10.0");

    for (const current of ["0.10.0", "0.11.0"]) {
      const upToDate = new UpdateCheck(current, "someone/some-bridge", async () => ["v0.9.0", "v0.10.0"]);
      await upToDate.refresh();
      expect(upToDate.newer(), current).toBeNull();
    }
  });

  // There is no changelog to read from: the commits are the record, and housekeeping among them is nothing a person running the bridge would notice.
  it("takes what changed from the subjects of the commits that add or mend something, what was added first", () => {
    expect(
      changesIn([
        "feat(discord): add a thing\n\nA body that explains it.",
        "chore: bump version to 0.10.0",
        "fix: mend a thing",
        "docs: describe the thing",
        "feat!: change a thing's shape",
        "not a conventional subject",
      ]),
    ).toEqual(["add a thing", "change a thing's shape", "mend a thing"]);
  });

  it("says how far ahead the newest version is and what changed on the way, asking for that once per version", async () => {
    const asked: string[] = [];
    const check = new UpdateCheck(
      "0.9.0",
      "someone/some-bridge",
      async () => ["v0.9.0", "v0.11.0", "v0.10.0", "v0.8.0"],
      async (_slug, from, to) => {
        asked.push(`${from}...${to}`);
        return ["feat: add a thing", "test: cover the thing"];
      },
    );
    await check.refresh();
    await check.refresh();

    expect(check.news()).toEqual({
      version: "0.11.0",
      current: "0.9.0",
      behind: 2,
      changes: ["add a thing"],
      url: "https://github.com/someone/some-bridge/compare/v0.9.0...v0.11.0",
    });
    expect(asked).toEqual(["0.9.0...0.11.0"]);
  });

  // A running version that was never tagged has nothing to be compared from, and the newer version is no less out for that.
  it("still names the newer version when what changed cannot be read", async () => {
    const check = new UpdateCheck(
      "0.9.0",
      "someone/some-bridge",
      async () => ["v0.10.0"],
      async () => {
        throw new Error("GitHub answered 404");
      },
    );
    await check.refresh();
    expect(check.news()).toMatchObject({ version: "0.10.0", behind: 1, changes: [] });
  });

  // Being offline is no reason to stop, or to forget a version already heard of.
  it("keeps what it knew and carries on when the check does not get through", async () => {
    const answers: Array<() => Promise<string[]>> = [
      async () => ["v0.10.0"],
      async () => {
        throw new Error("offline");
      },
    ];
    const check = new UpdateCheck("0.9.0", "someone/some-bridge", () => answers.shift()!(), nothingChanged);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await check.refresh();
      await check.refresh();
      expect(check.newer()).toBe("0.10.0");
      expect(logged.mock.calls[0]![0]).toContain("offline");
      expect(logged.mock.calls[0]![0]).toContain("UPDATE_CHECK=false");
    } finally {
      logged.mockRestore();
    }
  });

  it("asks nothing when it has no repository to ask, which is how it is switched off", async () => {
    let asked = 0;
    const off = new UpdateCheck("0.9.0", null, async () => {
      asked += 1;
      return ["v9.9.9"];
    });
    await off.refresh();
    expect(asked).toBe(0);
    expect(off.newer()).toBeNull();
  });

  it("says in the host log of each newer version once, with where to read what changed, however often it is seen again", async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const tags = ["v0.10.0"];
      new UpdateCheck("0.9.0", "someone/some-bridge", async () => [...tags], nothingChanged).watch();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]![0]).toContain("https://github.com/someone/some-bridge/compare/v0.9.0...v0.10.0");

      tags.push("v0.11.0");
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(logged).toHaveBeenCalledTimes(2);
      expect(logged.mock.calls[1]![0]).toContain("v0.11.0 is out");
    } finally {
      logged.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("the check that the bridge would start", () => {
  // Every setting is given, so nothing is taken from the machine the test runs on; the claude named does not exist, which a start survives.
  async function scratch(): Promise<{ dir: string; env: NodeJS.ProcessEnv }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "boot-check-"));
    const env = {
      PATH: process.env.PATH,
      DISCORD_BOT_TOKEN: "t",
      DISCORD_GUILD_ID: "g",
      DISCORD_OWNER_IDS: "100000000000000001",
      PROJECTS_ROOT: dir,
      BINDINGS_PATH: path.join(dir, "data", "conversations.json"),
      CLAUDE_BIN: path.join(dir, "no-such-claude"),
    };
    return { dir, env };
  }

  it("passes for settings a start would accept, without taking the lock a running bridge holds", async () => {
    const { dir, env } = await scratch();
    expect(await checkBoot(dir, env)).toEqual({ ok: true });
    await expect(fs.access(path.join(dir, "data", "bridge.lock"))).rejects.toThrow();
  }, 60_000);

  it("fails with what the start would have said", async () => {
    const { dir, env } = await scratch();
    const check = await checkBoot(dir, { ...env, DISCORD_BOT_TOKEN: "" });
    expect(check).toMatchObject({ ok: false, timedOut: false });
    expect(check.ok ? "" : check.output).toContain("DISCORD_BOT_TOKEN is not set");
  }, 60_000);

  // A running bridge carries the settings it started with, and Node lets those win over the file: the check has to read the file as the next start will.
  it("reads the settings file as it stands now, over what the process asking was started with", async () => {
    const { dir, env } = await scratch();
    await fs.writeFile(path.join(dir, ".env"), "PING_AFTER_SECONDS=2m\n");
    const check = await checkBoot(dir, { ...env, PING_AFTER_SECONDS: "120" });
    expect(check.ok ? "" : check.output).toContain('PING_AFTER_SECONDS is "2m"');
  }, 60_000);
});

describe("what a running bridge calls its build", () => {
  // Fixes land on main between two tags without the version moving, so there the version alone names two different builds.
  it("is the version alone on the tagged release, and names the commit anywhere else", () => {
    expect(buildName("1.2.3", "v1.2.3", "abc1234")).toBe("1.2.3");
    expect(buildName("1.2.3", null, "abc1234")).toBe("1.2.3 (abc1234)");
    expect(buildName("1.2.3", "v1.2.2", "abc1234")).toBe("1.2.3 (abc1234)");
  });

  it("is the version alone where git has no answer, as in the image", () => {
    expect(buildName("1.2.3", null, null)).toBe("1.2.3");
    expect(buildName("1.2.3", null, "fatal: not a git repository")).toBe("1.2.3");
  });
});
