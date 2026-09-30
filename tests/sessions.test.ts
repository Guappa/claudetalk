import { describe, it, expect, vi } from "vitest";
import { record } from "./helpers/records.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { longTmpDir } from "../src/platform.ts";
import { scanTranscript } from "../src/sessions/transcriptScanner.ts";
import { resolveByChannelName, resolveByFolder, resolveByName } from "../src/sessions/resolve.ts";
import {
  describeHidden,
  formatSessionList,
  newestPerName,
  sessionChoice,
  humanSize,
  humanAge,
  withoutScratch,
} from "../src/discord/commands/sessionList.ts";
import { displayName } from "../src/sessions/displayName.ts";
import { toChannelName } from "../src/channelName.ts";
import { sayIn } from "../src/i18n/index.ts";
import { readExchanges, readExchangesSince, lastExchanges } from "../src/sessions/exchanges.ts";
import { SessionIndex } from "../src/sessions/index.ts";
import { readTail } from "../src/sessions/transcriptTail.ts";
import { formatExchanges, describeDrift, latestThatFit } from "../src/discord/transcriptView.ts";

const say = sayIn("en");
const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);

describe("scanTranscript", () => {
  it("takes the last custom-title, not the first", async () => {
    expect((await scanTranscript(fixture("transcript-titled.jsonl"))).name).toBe("Server Notes");
  });

  it("reads cwd from inside the transcript", async () => {
    expect((await scanTranscript(fixture("transcript-titled.jsonl"))).cwd).toBe("/home/u/projects/deploy-scripts");
  });

  it("reports the last activity timestamp", async () => {
    const info = await scanTranscript(fixture("transcript-titled.jsonl"));
    expect(info.lastActivity?.toISOString()).toBe("2026-09-10T10:00:05.000Z");
  });

  it("marks a title-only stub as having no content", async () => {
    const info = await scanTranscript(fixture("transcript-stub.jsonl"));
    expect(info.name).toBe("Server Notes");
    expect(info.hasContent).toBe(false);
  });

  // Claude Code stamps each record with where its shell stands, so the last one is often a subfolder the session only visited.
  describe("the directory a session belongs to", () => {
    const transcriptIn = async (projectFolder: string, stamps: string[]): Promise<string> => {
      const folder = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "stamped-")), projectFolder);
      await fs.mkdir(folder, { recursive: true });
      const records = stamps.map((cwd) => JSON.stringify({ type: "user", cwd, timestamp: "2026-09-10T10:00:00.000Z" }));
      const file = path.join(folder, "session.jsonl");
      await fs.writeFile(file, `${records.join("\n")}\n`);
      return file;
    };

    it("is the one its folder is named after, not wherever the shell went last", async () => {
      const file = await transcriptIn("-srv-app", ["/srv/app", "/srv/app/scripts", "/srv/app/scripts"]);
      expect((await scanTranscript(file)).cwd).toBe("/srv/app");
    });

    it("is found above the shell's directory when the tail only shows the subfolder", async () => {
      const file = await transcriptIn("-srv-app", ["/srv/app/scripts/deep", "/srv/app/scripts"]);
      expect((await scanTranscript(file)).cwd).toBe("/srv/app");
    });

    it("reads a Windows path the same way, drive letter in either case", async () => {
      const file = await transcriptIn("C--work-my-app", ["c:\\work\\my app\\tools\\release"]);
      expect((await scanTranscript(file)).cwd).toBe("c:\\work\\my app");
    });

    // Claude Code cuts a folder's name at 200 characters and ends it with a hash of the whole path.
    it("is found for a path too long for its folder's name to hold", async () => {
      const started = `/srv/${"a-rather-long-folder-name-for-a-project/".repeat(5)}app`;
      const folder = `${started.replace(/[^A-Za-z0-9]/g, "-").slice(0, 200)}-87cf77`;
      const file = await transcriptIn(folder, [started, `${started}/scripts`]);
      expect((await scanTranscript(file)).cwd).toBe(started);

      const stamped = `c:\\work\\${"a rather long folder name for a project\\".repeat(5)}app`;
      const named = `C${stamped
        .slice(1)
        .replace(/[^A-Za-z0-9]/g, "-")
        .slice(0, 199)}-zgx6i8`;
      const onWindows = await transcriptIn(named, [`${stamped}\\tools\\release`]);
      expect((await scanTranscript(onWindows)).cwd).toBe(stamped);
    });

    it("falls back to the last directory stamped when none matches the folder's name", async () => {
      const file = await transcriptIn("somewhere-else", ["/srv/app", "/srv/app/scripts"]);
      expect((await scanTranscript(file)).cwd).toBe("/srv/app/scripts");
    });
  });

  it("returns empty info for a missing file rather than throwing", async () => {
    expect(await scanTranscript(fixture("does-not-exist.jsonl"))).toEqual({
      name: null,
      cwd: null,
      lastActivity: null,
      hasContent: false,
    });
  });
});

describe("resolveByName", () => {
  const records = [
    record({ sessionId: "a", name: "Release Notes", lastActivity: new Date("2026-09-12T22:51:00Z") }),
    record({ sessionId: "b", name: "Release Notes", lastActivity: new Date("2026-09-02T06:55:00Z") }),
    record({ sessionId: "c", name: "project-notes", lastActivity: new Date("2026-09-13T17:12:00Z") }),
  ];

  it("matches case-insensitively", () => {
    expect(resolveByName(records, "release notes").match?.sessionId).toBe("a");
  });

  it("prefers the most recently active on a duplicate name", () => {
    const resolution = resolveByName(records, "Release Notes");
    expect(resolution.match?.sessionId).toBe("a");
    expect(resolution.match && "shadowed" in resolution && resolution.shadowed.map((record) => record.sessionId)).toEqual(["b"]);
  });

  it("resolves a unique prefix", () => {
    expect(resolveByName(records, "proj").match?.sessionId).toBe("c");
  });

  it("returns candidates when a prefix spans different names", () => {
    const extra = [...records, record({ sessionId: "d", name: "project-other" })];
    const resolution = resolveByName(extra, "project");
    expect(resolution.match).toBeNull();
    expect(resolution.match === null && resolution.candidates).toHaveLength(2);
  });

  it("returns nothing for a name that does not exist", () => {
    const resolution = resolveByName(records, "zzzz");
    expect(resolution.match).toBeNull();
    expect(resolution.match === null && resolution.candidates).toHaveLength(0);
  });
});

describe("resolveByFolder", () => {
  it("finds the conversations already working in a folder, newest first", () => {
    const older = {
      ...record({ sessionId: "old", name: "Old", cwd: "/p/app" }),
      lastActivity: new Date("2026-01-01T00:00:00Z"),
    };
    const newer = {
      ...record({ sessionId: "new", name: "New", cwd: "/p/app" }),
      lastActivity: new Date("2026-02-01T00:00:00Z"),
    };
    const elsewhere = record({ sessionId: "other", name: "Other", cwd: "/p/different" });

    const found = resolveByFolder([older, newer, elsewhere], "/p/app");
    expect(found.map((record) => record.sessionId)).toEqual(["new", "old"]);
  });

  it("treats a trailing separator and a relative hop as the same folder", () => {
    const one = record({ sessionId: "s", name: "One", cwd: "/p/app" });
    expect(resolveByFolder([one], "/p/app/").map((record) => record.sessionId)).toEqual(["s"]);
    expect(resolveByFolder([one], "/p/other/../app").map((record) => record.sessionId)).toEqual(["s"]);
  });

  it("ignores a conversation whose directory could not be read", () => {
    const noCwd = { ...record({ sessionId: "s", name: "x", cwd: "/p/app" }), cwd: null };
    expect(resolveByFolder([noCwd], "/p/app")).toEqual([]);
  });
});

describe("displayName", () => {
  it("uses the conversation's own title when it has one", () => {
    expect(displayName(record({ sessionId: "s", name: "Deploy Scripts", cwd: "/p/thing" }))).toBe("Deploy Scripts");
  });

  it("names an untitled conversation after the folder it works in", () => {
    const untitled = { ...record({ sessionId: "s", name: "x", cwd: "/p/thing" }), name: null };
    expect(displayName(untitled)).toBe("thing");
  });

  it("never names one after the account, when it works in the home folder", () => {
    const untitled = { ...record({ sessionId: "s", name: "x", cwd: os.homedir() }), name: null };
    const shown = displayName(untitled);
    expect(shown).toBe("home");
    expect(shown).not.toContain(path.basename(os.homedir()));
  });

  it("falls back when there is no directory either", () => {
    const bare = { ...record({ sessionId: "s", name: "x", cwd: "/p" }), name: null, cwd: null };
    expect(displayName(bare)).toBe("(untitled)");
  });

  it("is what /resume names the channel and the reply after", () => {
    const sessionId = "4c241d90-c5ad-44e4-94d7-a8d374b00000";
    const untitled = { ...record({ sessionId, name: "x", cwd: "/p/kitchen-site" }), name: null };
    // Autocomplete submits the session id, so a name that falls back to it would call the channel a UUID.
    expect(displayName(untitled)).toBe("kitchen-site");
    expect(displayName(untitled)).not.toContain(sessionId);
  });

  it("lets an untitled conversation be found by its folder name", () => {
    const untitled = { ...record({ sessionId: "s", name: "x", cwd: "/p/kitchen-site" }), name: null };
    expect(displayName(untitled).toLowerCase().includes("kitchen")).toBe(true);
  });
});

describe("resolving an untitled conversation by name", () => {
  it("finds it by the folder it works in", () => {
    const untitled = { ...record({ sessionId: "s1", name: "x", cwd: "/p/kitchen-site" }), name: null };
    const other = record({ sessionId: "s2", name: "Other", cwd: "/p/other" });
    expect(resolveByName([untitled, other], "kitchen-site").match?.sessionId).toBe("s1");
    expect(resolveByName([untitled, other], "kitchen").match?.sessionId).toBe("s1");
  });

  it("still prefers an explicit title over a folder", () => {
    const titled = record({ sessionId: "s1", name: "Other", cwd: "/p/kitchen-site" });
    expect(resolveByName([titled], "Other").match?.sessionId).toBe("s1");
  });
});

describe("formatSessionList", () => {
  it("marks a live session", () => {
    const output = formatSessionList(say, [
      record({
        sessionId: "a",
        name: "Deploy Scripts",
        cwd: "/p/deploy-scripts",
        live: { pid: 1, cwd: "/p/deploy-scripts", kind: "interactive", sessionId: "a", status: "idle" },
      }),
    ]);
    expect(output).toContain("Deploy Scripts");
    expect(output).toContain("live (interactive, idle)");
  });

  // A UTC time that does not say so reads as local, and is hours off.
  it("gives the last activity as a Discord timestamp, so it shows in the reader's zone", () => {
    const lastActivity = new Date("2026-09-13T14:32:00Z");
    const output = formatSessionList(say, [record({ sessionId: "a", name: "Deploy Scripts", cwd: "/p/deploy", lastActivity })]);
    expect(output).toContain(`<t:${Math.floor(lastActivity.getTime() / 1000)}:f>`);
    expect(output).not.toContain("2026-09-13 14:32");
  });

  it("says so when there is nothing to list", () => {
    expect(formatSessionList(say, [])).toMatch(/no conversations/i);
  });
});

describe("toChannelName", () => {
  it("slugifies a conversation name", () => {
    expect(toChannelName("Release Notes")).toBe("release-notes");
  });

  it("collapses punctuation such as dots", () => {
    expect(toChannelName("project.notes v2")).toBe("project-notes-v2");
    expect(toChannelName("project-notes")).toBe("project-notes");
  });

  it("trims leading and trailing separators", () => {
    expect(toChannelName("  !! hello !!  ")).toBe("hello");
  });

  it("falls back rather than producing an empty channel name", () => {
    expect(toChannelName("!!!")).toBe("conversation");
  });
});

describe("readExchanges", () => {
  const transcript = () => fixture("transcript-exchanges.jsonl");

  it("returns only real prompts and replies", async () => {
    const exchanges = await readExchanges(transcript());
    expect(exchanges.map((exchange) => exchange.text)).toEqual([
      "first prompt from discord",
      "first reply",
      "typed in the terminal",
      "terminal reply",
      "a real question about the code",
      "a real answer",
    ]);
  });

  it("excludes slash command plumbing stored as user messages", async () => {
    const texts = (await readExchanges(transcript())).map((exchange) => exchange.text);
    expect(texts.some((text) => text.includes("command-name"))).toBe(false);
    expect(texts.some((text) => text.includes("local-command-stdout"))).toBe(false);
  });

  it("excludes task notifications and shell escapes", async () => {
    const texts = (await readExchanges(transcript())).map((exchange) => exchange.text);
    expect(texts.some((text) => text.includes("task-notification"))).toBe(false);
    expect(texts.some((text) => text.includes("bash-input"))).toBe(false);
  });

  it("excludes tool_use and tool_result records", async () => {
    const texts = (await readExchanges(transcript())).map((exchange) => exchange.text);
    expect(texts.some((text) => text.includes("data"))).toBe(false);
  });

  it("excludes injected and sidechain records", async () => {
    const texts = (await readExchanges(transcript())).map((exchange) => exchange.text);
    expect(texts).not.toContain("injected marker");
    expect(texts).not.toContain("subagent chatter");
  });

  it("returns only what happened after the watermark", async () => {
    const drift = await readExchanges(transcript(), new Date("2026-09-13T10:30:00Z"));
    expect(drift.map((exchange) => exchange.text)).toEqual([
      "typed in the terminal",
      "terminal reply",
      "a real question about the code",
      "a real answer",
    ]);
  });

  it("returns nothing when the watermark is current", async () => {
    expect(await readExchanges(transcript(), new Date("2026-09-13T23:00:00Z"))).toEqual([]);
  });

  it("returns the last N exchanges for a resume recap, skipping plumbing", async () => {
    const recent = await lastExchanges(transcript(), 2);
    expect(recent.map((exchange) => exchange.text)).toEqual(["a real question about the code", "a real answer"]);
  });

  it("returns nothing for a missing transcript rather than throwing", async () => {
    expect(await readExchanges(fixture("nope.jsonl"))).toEqual([]);
  });
});

describe("transcript view", () => {
  const exchanges = [
    { at: new Date("2026-09-13T14:32:00Z"), role: "user" as const, text: "check the nas" },
    { at: new Date("2026-09-13T14:33:00Z"), role: "assistant" as const, text: "mounted" },
  ];

  const stamp = (at: Date) => `<t:${Math.floor(at.getTime() / 1000)}:f>`;

  // A time alone reads as today's, and what is caught up on can be weeks old.
  it("labels the source, and the date and time as a Discord timestamp so it shows in the reader's zone", () => {
    const out = formatExchanges(say, exchanges);
    expect(out).toContain(`**You** · terminal · ${stamp(exchanges[0]!.at)}`);
    expect(out).toContain(`**Claude** · terminal · ${stamp(exchanges[1]!.at)}`);
  });

  it("uses a plain clock with its date where Discord will not render one", () => {
    const out = formatExchanges(say, exchanges, "plain");
    expect(out).toContain("**You** · terminal · 2026-09-13 14:32 UTC");
    expect(out).not.toContain("<t:");
  });

  // Cut inside a code block, the closing fence goes with the cut, and everything after the opening one is drawn as prose with its markers escaped.
  it("cuts a long exchange where a message ends, with its code block closed", () => {
    const fence = "```";
    const code = Array.from({ length: 80 }, (_, index) => `rate_per_unit[${index}] = *scaled* + __init__`).join("\n");
    const text = ["Here it is:", `${fence}python`, code, fence, "Done."].join("\n");
    const long = [{ at: new Date("2026-09-13T14:32:00Z"), role: "assistant" as const, text }];
    const shown = formatExchanges(say, long);
    expect(shown.length).toBeLessThan(1400);
    expect(shown).toContain(`${fence}python`);
    expect(shown.split(fence)).toHaveLength(3);
    expect(shown).toContain("rate_per_unit[0]");
    expect(shown).not.toContain("rate\\_per");
  });

  it("truncates a very long exchange", () => {
    const long = [{ at: new Date("2026-09-13T14:32:00Z"), role: "assistant" as const, text: "x".repeat(5000) }];
    expect(formatExchanges(say, long).length).toBeLessThan(1400);
  });

  // Catching up means where you left off; fifty-five messages inline is a wall, not a glance.
  it("keeps only the latest few messages that fit, newest last", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      at: new Date(Date.UTC(2026, 8, 13, 14, index)),
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `message ${index}`,
    }));
    expect(latestThatFit(say, many, 1880).map((exchange) => exchange.text)).toEqual([
      "message 6",
      "message 7",
      "message 8",
      "message 9",
    ]);

    const long = many.map((exchange) => ({ ...exchange, text: "y".repeat(1200) }));
    const fitted = latestThatFit(say, long, 1880);
    expect(fitted).toEqual([long[9]]);
    expect(latestThatFit(say, long.slice(0, 1), 10)).toEqual([long[0]]);
  });

  it("describes drift with a count, how long ago the last was, and its date", () => {
    const notice = describeDrift(say, { exchanges, reachesBack: true });
    expect(notice).toContain("2 messages");
    expect(notice).toContain(`The last was <t:${Math.floor(exchanges[1]!.at.getTime() / 1000)}:R>, ${stamp(exchanges[1]!.at)}.`);
    expect(notice).toContain("/sync");
    expect(notice).not.toContain("only the most recent");
  });

  it("uses the singular for one message", () => {
    expect(describeDrift(say, { exchanges: exchanges.slice(0, 1), reachesBack: true })).toContain("1 message happened");
  });

  // Only the end of a transcript is read, so a count of what happened since can fall short of what did.
  it("says the count is only the most recent when the transcript was not read back far enough", () => {
    expect(describeDrift(say, { exchanges, reachesBack: false })).toContain(
      "That counts only the most recent: the bridge reads back the last 3 MB of a transcript",
    );
  });
});

describe("a transcript larger than the window read from its end", () => {
  const line = (record: Record<string, unknown>): string => `${JSON.stringify(record)}\n`;
  const said = (minute: number, text: string) =>
    line({ type: "user", timestamp: `2026-09-13T10:${String(minute).padStart(2, "0")}:00.000Z`, message: { content: text } });
  const bulk = (megabytes: number): string =>
    line({
      type: "assistant",
      timestamp: "2026-09-13T10:30:00.000Z",
      message: { content: [{ type: "tool_use", name: "x".repeat(megabytes * 1024 * 1024) }] },
    });
  const written = async (content: string): Promise<string> => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "long-transcript-")), "session.jsonl");
    await fs.writeFile(file, content);
    return file;
  };

  it("widens the window until it holds a whole record, so one huge last line is not an empty transcript", async () => {
    const file = await written(said(1, "first") + line({ type: "user", cwd: "/srv/app", pasted: "y".repeat(400) }));
    expect((await readTail(file, 64))?.text).toContain('"cwd":"/srv/app"');

    const heavy = await written(said(1, "first") + bulk(4));
    expect((await scanTranscript(heavy)).hasContent).toBe(true);
  });

  // Claude Code closes nearly every transcript with a line of its own, a title or a cost, after the last thing anyone said.
  it("widens past a line of bookkeeping to the message before it, however large that message is", async () => {
    const titled = line({ type: "custom-title", customTitle: "Heavy" });
    const pasted = line({
      type: "user",
      cwd: "/srv/app",
      timestamp: "2026-09-13T10:31:00.000Z",
      message: { content: "y".repeat(4 * 1024 * 1024) },
    });
    const file = await written(said(1, "first") + pasted + titled);

    const info = await scanTranscript(file);
    expect(info).toMatchObject({ name: "Heavy", cwd: "/srv/app", hasContent: true });
    expect((await readExchangesSince(file)).exchanges.length).toBeGreaterThan(0);
  });

  it("says whether what it read reaches back to the moment asked about", async () => {
    const file = await written(said(1, "before the gap") + bulk(2) + bulk(2) + said(40, "after the gap"));
    const sinceStart = await readExchangesSince(file, new Date("2026-09-13T10:00:00Z"));
    expect(sinceStart.exchanges.map((exchange) => exchange.text)).toEqual(["after the gap"]);
    expect(sinceStart.reachesBack).toBe(false);

    const sinceLate = await readExchangesSince(file, new Date("2026-09-13T10:35:00Z"));
    expect(sinceLate.exchanges.map((exchange) => exchange.text)).toEqual(["after the gap"]);
    expect(sinceLate.reachesBack).toBe(true);

    const small = await written(said(1, "one") + said(2, "two"));
    expect((await readExchangesSince(small)).reachesBack).toBe(true);
  });
});

describe("the session index", () => {
  const indexed = async (copies: Array<{ folder: string; minute: number }>) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "projects-"));
    for (const copy of copies) {
      await fs.mkdir(path.join(root, copy.folder), { recursive: true });
      const stamped = {
        type: "user",
        cwd: "/srv/app",
        timestamp: `2026-09-13T10:${String(copy.minute).padStart(2, "0")}:00.000Z`,
      };
      await fs.writeFile(path.join(root, copy.folder, "s1.jsonl"), `${JSON.stringify(stamped)}\n`);
    }
    return root;
  };
  const live = { pid: 4321, cwd: "/srv/app", kind: "interactive" as const, sessionId: "s1" };

  const SECOND = 1000;
  const clocked = async (listings: Array<(typeof live)[] | null>) => {
    const clock = { now: 0, asked: 0 };
    const listLive = async () => {
      clock.asked += 1;
      return listings.shift() ?? null;
    };
    const index = new SessionIndex(listLive, await indexed([{ folder: "-srv-app", minute: 1 }]), () => clock.now);
    return { index, clock };
  };

  // A listing that timed out is not word that nothing is live, and a turn let through on it would collide with an open terminal.
  it("does not take a listing that failed for nothing being live", async () => {
    const { index, clock } = await clocked([[live], null]);

    expect((await index.find("s1"))?.live).toEqual(live);
    clock.now = 6 * SECOND;
    expect((await index.find("s1"))?.live).toEqual(live);
  });

  // Every look at a conversation asks what is live, and a listing that fails costs a spawned process each time it is asked for.
  it("asks again only after a while when the listing fails, as it does when it works", async () => {
    const { index, clock } = await clocked([null, null, [live]]);

    for (const _look of [1, 2, 3]) expect((await index.find("s1"))?.live).toBeNull();
    expect(clock.asked).toBe(1);
    clock.now = 6 * SECOND;
    await index.find("s1");
    await index.find("s1");
    expect(clock.asked).toBe(2);
    clock.now = 12 * SECOND;
    expect((await index.find("s1"))?.live).toEqual(live);
  });

  // The terminal it names may have been closed long since, and a conversation must not be refused over it for as long as listings fail.
  it("stops believing the last listing that worked once it is a minute old", async () => {
    const { index, clock } = await clocked([[live]]);

    expect((await index.find("s1"))?.live).toEqual(live);
    clock.now = 50 * SECOND;
    expect((await index.find("s1"))?.live).toEqual(live);
    clock.now = 70 * SECOND;
    expect((await index.find("s1"))?.live).toBeNull();
  });

  it("does not keep a listing that was out while it was told to forget", async () => {
    const asked: Array<(sessions: (typeof live)[]) => void> = [];
    const listLive = () => new Promise<(typeof live)[]>((resolve) => asked.push(resolve));
    const index = new SessionIndex(listLive, await indexed([{ folder: "-srv-app", minute: 1 }]));

    const before = index.find("s1");
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    index.forgetLive();
    asked[0]!([live]);
    await before;

    const after = index.find("s1");
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    asked[1]!([]);
    expect((await after)?.live).toBeNull();
  });

  it("asks again at once after being told to forget what was live", async () => {
    const listings: Array<(typeof live)[] | null> = [[live], []];
    const index = new SessionIndex(async () => listings.shift() ?? null, await indexed([{ folder: "-srv-app", minute: 1 }]));

    expect((await index.find("s1"))?.live).toEqual(live);
    expect((await index.find("s1"))?.live).toEqual(live);
    index.forgetLive();
    expect((await index.find("s1"))?.live).toBeNull();
  });

  it("takes the copy written to last when one session has a transcript under two folders", async () => {
    const root = await indexed([
      { folder: "-srv-app", minute: 50 },
      { folder: "-srv-other", minute: 5 },
    ]);
    const found = await new SessionIndex(async () => [], root).find("s1");
    expect(found?.transcriptPath).toBe(path.join(root, "-srv-app", "s1.jsonl"));
  });

  // The id names a file under each project folder, and one from a button's custom id is not the bridge's to trust.
  it("looks for an id that is not a plain file name nowhere", async () => {
    const root = await indexed([{ folder: "-srv-app", minute: 1 }]);
    await fs.copyFile(path.join(root, "-srv-app", "s1.jsonl"), path.join(root, "s1.jsonl"));
    expect(await new SessionIndex(async () => [], root).find("../s1")).toBeNull();
  });
});

describe("session choices", () => {
  it("renders sizes at a readable scale", () => {
    expect(humanSize(512)).toBe("512 B");
    expect(humanSize(48 * 1024 ** 2)).toBe("48 MB");
    expect(humanSize(923_000_000)).toBe("880 MB");
    expect(humanSize(2 * 1024 ** 3)).toBe("2.0 GB");
  });

  it("renders ages at a readable scale", () => {
    const now = new Date("2026-09-14T12:00:00Z");
    expect(humanAge(say, new Date("2026-09-14T11:45:00Z"), now)).toBe("15m ago");
    expect(humanAge(say, new Date("2026-09-14T09:00:00Z"), now)).toBe("3h ago");
    expect(humanAge(say, new Date("2026-09-11T12:00:00Z"), now)).toBe("3d ago");
    expect(humanAge(say, null, now)).toBe("unknown");
  });

  it("submits the session id so duplicate names stay distinguishable", () => {
    const large = record({ sessionId: "id-a", name: "project-notes", sizeBytes: 48 * 1024 ** 2 });
    const small = record({ sessionId: "id-b", name: "project-notes", sizeBytes: 1024 });
    expect(sessionChoice(say, large).value).toBe("id-a");
    expect(sessionChoice(say, small).value).toBe("id-b");
    expect(sessionChoice(say, large).name).not.toBe(sessionChoice(say, small).name);
  });

  // Every untitled conversation in a folder takes that folder's name, so size and age alone
  // cannot tell two of them apart.
  it("tags an untitled conversation with its id", () => {
    const one = record({ sessionId: "4e5b4e8e-ec44-4942", name: null, cwd: "/p/claudetalk", sizeBytes: 1024 });
    const two = record({ sessionId: "89e4c5e6-ccfd-4880", name: null, cwd: "/p/claudetalk", sizeBytes: 1024 });
    expect(sessionChoice(say, one).name).toContain("4e5b4e8e");
    expect(sessionChoice(say, two).name).toContain("89e4c5e6");
    expect(sessionChoice(say, one).name).not.toBe(sessionChoice(say, two).name);
  });

  it("leaves a titled conversation's label alone", () => {
    const named = record({ sessionId: "4e5b4e8e-ec44-4942", name: "Deploy Scripts", sizeBytes: 1024 });
    expect(sessionChoice(say, named).name).not.toContain("4e5b4e8e");
    expect(sessionChoice(say, named).name).toBe("Deploy Scripts · 1 KB · unknown");
  });

  it("tags untitled conversations in the listing too", () => {
    const output = formatSessionList(say, [
      record({ sessionId: "4e5b4e8e-ec44-4942", name: null, cwd: "/p/claudetalk", sizeBytes: 1024 }),
    ]);
    expect(output).toContain("4e5b4e8e");
  });

  it("keeps only the newest of the conversations sharing a name", () => {
    const older = record({ sessionId: "old", name: null, cwd: "/p/notes", lastActivity: new Date("2026-09-01") });
    const newer = record({ sessionId: "new", name: null, cwd: "/p/notes", lastActivity: new Date("2026-09-10") });
    const collapsed = newestPerName([older, newer]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]![0].sessionId).toBe("new");
    expect(collapsed[0]![1]).toBe(1);
  });

  it("keeps conversations with different names apart", () => {
    const notes = record({ sessionId: "a", name: null, cwd: "/p/notes", lastActivity: new Date("2026-09-01") });
    const other = record({ sessionId: "b", name: null, cwd: "/p/other", lastActivity: new Date("2026-09-02") });
    expect(newestPerName([notes, other])).toHaveLength(2);
  });

  it("orders the collapsed list by recency", () => {
    const alpha = record({ sessionId: "a", name: "Alpha", lastActivity: new Date("2026-09-01") });
    const beta = record({ sessionId: "b", name: "Beta", lastActivity: new Date("2026-09-09") });
    expect(newestPerName([alpha, beta]).map(([newest]) => newest.sessionId)).toEqual(["b", "a"]);
  });

  it("says how many older ones a row stands in for", () => {
    const one = record({ sessionId: "4e5b4e8e-x", name: null, cwd: "/p/notes", sizeBytes: 1024 });
    expect(sessionChoice(say, one, 6).name).toContain("+6 older");
    expect(sessionChoice(say, one, 0).name).not.toContain("older");
  });

  it("shows the size so the primary conversation is obvious", () => {
    const big = record({ sessionId: "s", name: "project-notes", sizeBytes: 48 * 1024 ** 2 });
    expect(sessionChoice(say, big).name).toContain("48 MB");
  });

  it("keeps a label within the Discord 100 character limit", () => {
    const long = record({ sessionId: "s", name: "x".repeat(300), sizeBytes: 1024 ** 3 });
    expect(sessionChoice(say, long).name.length).toBeLessThanOrEqual(100);
  });

  it("lists sizes so an oversized transcript is visible", () => {
    const output = formatSessionList(say, [record({ sessionId: "s", name: "Big", sizeBytes: 923_000_000 })]);
    expect(output).toContain("880 MB");
  });
});

describe("scratch conversations stay out of the picker", () => {
  const scratch = record({ sessionId: "probe", cwd: path.join(longTmpDir(), "probe-1") });
  const real = record({ sessionId: "site", cwd: "/p/kitchen-site" });

  it("hides what works inside the temp folder and counts it", () => {
    const { shown, hidden } = withoutScratch([scratch, real]);
    expect(shown.map((record) => record.sessionId)).toEqual(["site"]);
    expect(hidden).toBe(1);
  });

  it("keeps a conversation with no directory, which is not scratch, just unknown", () => {
    const bare = record({ sessionId: "bare", cwd: null });
    expect(withoutScratch([bare]).shown).toEqual([bare]);
  });

  it("says how many were left out and how to see them", () => {
    expect(describeHidden(say, 0)).toBe("");
    expect(describeHidden(say, 1)).toContain("1 conversation in the temp folder is left out");
    expect(describeHidden(say, 3)).toContain("3 conversations in the temp folder are left out");
    expect(describeHidden(say, 3)).toContain("filter");
  });
});

describe("a channel named after a hyphenated conversation still binds to it", () => {
  const untitled = { ...record({ sessionId: "s", name: "x", cwd: "/p/claude-discord" }), name: null };

  it("matches by slug, which un-slugging would have lost", () => {
    expect(resolveByChannelName([untitled], "claude-discord").match?.sessionId).toBe("s");
  });

  it("finds a titled conversation by the slug of its title", () => {
    const titled = record({ sessionId: "t", name: "Deploy Scripts" });
    expect(resolveByChannelName([titled], "deploy-scripts").match?.sessionId).toBe("t");
  });

  // Binding hands the channel that conversation's folder and history, and every later message there becomes a turn in it.
  it("does not bind a channel whose name is only the start of a conversation's name", () => {
    const ledger = { ...record({ sessionId: "l", name: "x", cwd: "/srv/general-ledger" }), name: null };
    for (const channel of ["general", "gen", "general-"])
      expect(resolveByChannelName([ledger], channel).match, channel).toBeNull();
    expect(resolveByChannelName([ledger], "general-ledger").match?.sessionId).toBe("l");
  });
});
