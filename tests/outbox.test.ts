import { describe, it, expect, beforeEach, vi } from "vitest";
import { recordingSink } from "./helpers/sinks.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bridgeSystemNote } from "../src/claude/runner.ts";
import { OutboxDelivery } from "../src/discord/outboxDelivery.ts";
import { MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE, MAX_MESSAGE_BYTES } from "../src/discord/limits.ts";
import { sweepOutboxes } from "../src/discord/outboxWatcher.ts";
import { sayIn } from "../src/i18n/index.ts";
import { collectOutbox, describeSkipped, SETTLE_MS } from "../src/discord/outbox.ts";
import { OUTBOX_DIR, outboxPath } from "../src/outboxFolder.ts";

const say = sayIn("en");

describe("the outbox sweep", () => {
  it("delivers for the conversations after one whose delivery fails, and says the failure once", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sweep-"));
    for (const session of ["broken", "fine"]) {
      await fs.mkdir(outboxPath(cwd, session), { recursive: true });
      await fs.writeFile(path.join(outboxPath(cwd, session), "report.md"), "done");
      await fs.utimes(path.join(outboxPath(cwd, session), "report.md"), new Date(0), new Date(0));
    }
    const sent: string[] = [];
    const channel = (id: string) => ({
      id,
      isSendable: () => true,
      send: async () => {
        if (id === "c-broken") throw new Error("Missing Permissions");
        sent.push(id);
        return { id: `${id}-1` };
      },
    });
    const bridge = {
      store: { all: () => ["broken", "fine"].map((sessionId) => ({ sessionId, cwd, channels: { text: `c-${sessionId}` } })) },
      outbox: new OutboxDelivery(),
      language: { say },
      latestPosts: new Map<string, string>(),
    };
    const client = { channels: { fetch: async (id: string) => channel(id) } };
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const failing = new Set<string>();
      await sweepOutboxes(bridge as never, client as never, failing);
      await sweepOutboxes(bridge as never, client as never, failing);
      expect(sent).toEqual(["c-fine"]);
      expect(logged).toHaveBeenCalledOnce();
    } finally {
      logged.mockRestore();
    }
  });
});

describe("outbox settling", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sweep-"));
    await fs.mkdir(path.join(cwd, OUTBOX_DIR, "s1"), { recursive: true });
  });

  it("leaves a file that is still being written", async () => {
    await fs.writeFile(path.join(cwd, OUTBOX_DIR, "s1", "half.png"), "partial");
    const result = await collectOutbox(cwd, "s1", SETTLE_MS);
    expect(result.files).toEqual([]);
    expect(await fs.readdir(path.join(cwd, OUTBOX_DIR, "s1"))).toEqual(["half.png"]);
  });

  it("takes a file that has stopped changing", async () => {
    const file = path.join(cwd, OUTBOX_DIR, "s1", "done.png");
    await fs.writeFile(file, "complete");
    const old = new Date(Date.now() - SETTLE_MS * 2);
    await fs.utimes(file, old, old);
    const result = await collectOutbox(cwd, "s1", SETTLE_MS);
    expect(result.files.map((file) => file.name)).toEqual(["done.png"]);
  });

  it("still takes everything when no settling is asked for", async () => {
    await fs.writeFile(path.join(cwd, OUTBOX_DIR, "s1", "now.png"), "fresh");
    expect((await collectOutbox(cwd, "s1")).files.map((file) => file.name)).toEqual(["now.png"]);
  });
});

describe("outbox", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-"));
  });

  const writeOutbox = async (name: string, contents: string | Buffer): Promise<void> => {
    const dir = outboxPath(cwd, "s1");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), contents);
  };

  it("returns nothing when the turn wrote no files", async () => {
    const result = await collectOutbox(cwd, "s1");
    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("collects what the turn left for the person", async () => {
    await writeOutbox("report.md", "# findings");
    const result = await collectOutbox(cwd, "s1");
    expect(result.files.map((file) => file.name)).toEqual(["report.md"]);
    expect(result.files[0]!.data.toString()).toBe("# findings");
  });

  it("removes a file once it has been delivered, so it is never sent twice", async () => {
    await writeOutbox("once.txt", "x");
    await (await collectOutbox(cwd, "s1")).discard();
    expect((await collectOutbox(cwd, "s1")).files).toEqual([]);
  });

  it("keeps a collected file until delivery is confirmed", async () => {
    await writeOutbox("retry.txt", "x");
    await collectOutbox(cwd, "s1");
    expect((await collectOutbox(cwd, "s1")).files.map((file) => file.name)).toEqual(["retry.txt"]);
  });

  it("skips a file too large for Discord rather than failing the turn", async () => {
    await writeOutbox("huge.bin", Buffer.alloc(MAX_FILE_BYTES + 1));
    const result = await collectOutbox(cwd, "s1");
    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual(["huge.bin"]);
  });

  it("leaves a skipped file on disk so it is not lost", async () => {
    await writeOutbox("huge.bin", Buffer.alloc(MAX_FILE_BYTES + 1));
    await collectOutbox(cwd, "s1");
    expect(await fs.readdir(outboxPath(cwd, "s1"))).toEqual(["huge.bin"]);
  });

  // A file that only has to wait is not one that is too large, and saying so would be untrue.
  it("caps how many go in one message, and leaves the rest for the next without calling them too large", async () => {
    for (let i = 0; i < MAX_FILES_PER_MESSAGE + 3; i++) await writeOutbox(`f${i}.txt`, "x");
    const first = await collectOutbox(cwd, "s1");
    expect(first.files).toHaveLength(MAX_FILES_PER_MESSAGE);
    expect(first.skipped).toEqual([]);
    expect(first.deferred).toBe(3);

    await first.discard();
    const second = await collectOutbox(cwd, "s1");
    expect(second.files).toHaveLength(3);
    expect(second.deferred).toBe(0);
  });

  it("caps what one message weighs in all, keeping the files in the order they are named in", async () => {
    const each = MAX_FILE_BYTES - 1;
    const fit = Math.floor(MAX_MESSAGE_BYTES / each);
    for (let i = 0; i <= fit; i++) await writeOutbox(`part${i}.bin`, Buffer.alloc(each));
    await writeOutbox("z-small.txt", "x");

    const result = await collectOutbox(cwd, "s1");
    expect(result.files.map((file) => file.name)).toEqual(Array.from({ length: fit }, (_, index) => `part${index}.bin`));
    expect(result.deferred).toBe(2);
    expect(result.skipped).toEqual([]);
  });

  it("says where a skipped file still is", () => {
    expect(describeSkipped(say, ["huge.bin"], "s1")).toContain(".discord-outbox");
    expect(describeSkipped(say, [], "s1")).toBe("");
  });
});

describe("outbox tidiness", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-tidy-"));
  });

  it("removes the folder once everything in it has been sent", async () => {
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "a.txt"), "x");
    await (await collectOutbox(cwd, "s1")).discard();
    await expect(fs.stat(outboxPath(cwd, "s1"))).rejects.toThrow();
  });

  it("removes an empty folder a turn created but never used", async () => {
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await (await collectOutbox(cwd, "s1")).discard();
    await expect(fs.stat(outboxPath(cwd, "s1"))).rejects.toThrow();
  });

  it("keeps the folder when something was left behind", async () => {
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "huge.bin"), Buffer.alloc(MAX_FILE_BYTES + 1));
    await (await collectOutbox(cwd, "s1")).discard();
    expect(await fs.readdir(outboxPath(cwd, "s1"))).toEqual(["huge.bin"]);
  });
});

describe("outbox delivery", () => {
  it("names a file it cannot attach once, not on every sweep", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-once-"));
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "huge.bin"), Buffer.alloc(MAX_FILE_BYTES + 1));
    const delivery = new OutboxDelivery();
    const sink = recordingSink();

    await delivery.deliver(say, cwd, "s1", sink);
    await delivery.deliver(say, cwd, "s1", sink);
    await delivery.deliver(say, cwd, "s1", sink);
    expect(sink.written.filter((line) => line.includes("huge.bin"))).toHaveLength(1);
  });

  it("names it again if it goes away and comes back", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-again-"));
    const big = path.join(outboxPath(cwd, "s1"), "huge.bin");
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(big, Buffer.alloc(MAX_FILE_BYTES + 1));
    const delivery = new OutboxDelivery();
    const sink = recordingSink();

    await delivery.deliver(say, cwd, "s1", sink);
    await fs.rm(big);
    await delivery.deliver(say, cwd, "s1", sink);
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(big, Buffer.alloc(MAX_FILE_BYTES + 1));
    await delivery.deliver(say, cwd, "s1", sink);
    expect(sink.written.filter((line) => line.includes("huge.bin"))).toHaveLength(2);
  });

  // Files left for a later sweep are lost to the channel if the conversation is cleared or unbound before it comes.
  it("sends what one message cannot hold in the next, in the same delivery", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-many-"));
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    const names = Array.from({ length: MAX_FILES_PER_MESSAGE + 2 }, (_, index) => `chart${String(index).padStart(2, "0")}.png`);
    for (const name of names) await fs.writeFile(path.join(outboxPath(cwd, "s1"), name), "x");
    const sink = recordingSink();

    expect(await new OutboxDelivery().deliver(say, cwd, "s1", sink)).toBe(names.length);
    expect(sink.files).toEqual(names);
    expect(sink.messages).toEqual([`${MAX_FILES_PER_MESSAGE} files`, "2 files"]);
    await expect(fs.stat(path.join(cwd, OUTBOX_DIR))).rejects.toThrow();
  });

  // Something else holding a file open keeps it from being removed once it is sent, on Windows for as long as it is held.
  it("sends a file it cannot remove once, and still sends every file beside it", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-held-"));
    const folder = outboxPath(cwd, "s1");
    await fs.mkdir(folder, { recursive: true });
    const names = Array.from({ length: MAX_FILES_PER_MESSAGE + 5 }, (_, index) => `chart${String(index).padStart(2, "0")}.png`);
    for (const name of names) await fs.writeFile(path.join(folder, name), "x");
    const held = path.join(folder, "chart02.png");
    const remove = fs.rm;
    const refusing = vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (String(target) === held) throw Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
      await remove(target, options);
    });

    try {
      const delivery = new OutboxDelivery();
      const sink = recordingSink();
      expect(await delivery.deliver(say, cwd, "s1", sink)).toBe(names.length);
      expect(sink.files).toEqual(names);
      expect(await fs.readdir(folder)).toEqual(["chart02.png"]);

      expect(await delivery.deliver(say, cwd, "s1", sink)).toBe(0);
      expect(sink.files).toEqual(names);

      await fs.writeFile(held, "written again, and longer");
      expect(await delivery.deliver(say, cwd, "s1", sink)).toBe(1);
      expect(sink.files.at(-1)).toBe("chart02.png");
    } finally {
      refusing.mockRestore();
    }
  });

  it("never sends one file twice when a sweep and the turn's delivery overlap", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-race-"));
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "report.md"), "done");
    const delivery = new OutboxDelivery();
    const sink = recordingSink();

    await Promise.all([delivery.deliver(say, cwd, "s1", sink), delivery.deliver(say, cwd, "s1", sink)]);
    expect(sink.files).toEqual(["report.md"]);
  });

  it("delivers for the caller queued behind one whose send failed, and keeps that file for it", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-failed-"));
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "report.md"), "done");
    const delivery = new OutboxDelivery();
    const refusing = {
      ...recordingSink(),
      sendFiles: async () => {
        throw new Error("the channel refused the upload");
      },
    };
    const sink = recordingSink();

    const failed = delivery.deliver(say, cwd, "s1", refusing);
    const behind = delivery.deliver(say, cwd, "s1", sink);
    await expect(failed).rejects.toThrow("refused the upload");
    expect(await behind).toBe(1);
    expect(sink.files).toEqual(["report.md"]);
  });

  it("keeps one conversation's files out of another's channel in the same folder", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-two-"));
    await fs.mkdir(outboxPath(cwd, "private"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "private"), "secret.md"), "x");
    await fs.writeFile(path.join(cwd, OUTBOX_DIR, "loose.md"), "x");
    const delivery = new OutboxDelivery();
    const sink = recordingSink();

    expect(await delivery.hasFiles(cwd, "public")).toBe(false);
    await delivery.deliver(say, cwd, "public", sink);
    expect(sink.files).toEqual([]);
    expect(await delivery.hasFiles(cwd, "private")).toBe(true);
  });

  it("removes the parent folder too once the last conversation's folder is empty", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "outbox-parent-"));
    await fs.mkdir(outboxPath(cwd, "s1"), { recursive: true });
    await fs.writeFile(path.join(outboxPath(cwd, "s1"), "a.txt"), "x");
    await (await collectOutbox(cwd, "s1")).discard();
    await expect(fs.stat(path.join(cwd, OUTBOX_DIR))).rejects.toThrow();
  });

  it("tells the session which folder is its own", () => {
    expect(bridgeSystemNote("11111111-2222-4333-8444-555555555555")).toContain(
      ".discord-outbox/11111111-2222-4333-8444-555555555555/",
    );
  });
});
