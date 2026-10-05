import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PENDING_TTL_MS, PendingCreates } from "../src/discord/pendingCreate.ts";
import { ConversationStore } from "../src/conversations.ts";
import { OperatorStore } from "../src/operators.ts";
import { ActiveTurns } from "../src/discord/activeTurns.ts";
import { sayIn } from "../src/i18n/index.ts";
import { bridgeCommandDefinitions } from "../src/discord/commands/registry.ts";
import { workingDirFor } from "../src/discord/policy.ts";
import { tierFor, canRunCommand, workspaceFor } from "../src/access.ts";
import { conversationOverwrites } from "../src/discord/channelAccess.ts";
import { PermissionFlagsBits } from "discord.js";

const say = sayIn("en");

describe("ConversationStore", () => {
  let file: string;

  beforeEach(async () => {
    file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "conv-")), "conversations.json");
  });

  // Loaded as empty, the next save would write that emptiness over every binding.
  it("refuses to load a file that does not parse, and leaves it exactly as it was", async () => {
    const damaged = '{ "conversations": { "keep": { "sessionId": "keep" } }, "channelIndex": { "c1": "keep" }, }';
    await fs.writeFile(file, damaged, "utf8");
    const store = new ConversationStore(file);

    await expect(store.load()).rejects.toThrow(/not valid JSON[\s\S]*Nothing was changed[\s\S]*move it aside/);
    expect(await fs.readFile(file, "utf8")).toBe(damaged);
  });

  it("starts empty when there is no file yet", async () => {
    const store = new ConversationStore(file);
    await store.load();
    expect(store.all()).toEqual([]);
  });

  // The trail choice is the reader's, not the session's, so it outlives a /clear and a restart like the conversation's other settings.
  it("keeps a conversation's trail choice across a restart and a start-over, and drops it on request", async () => {
    const store = new ConversationStore(file);
    await store.load();
    const first = await store.bindNew({ sessionId: "s1", cwd: os.tmpdir(), channelId: "c1", ownerId: "o1" });
    await store.setTrailHidden("s1", ["commands"]);

    const reloaded = new ConversationStore(file);
    await reloaded.load();
    expect(reloaded.bySession("s1")?.trailHidden).toEqual(["commands"]);
    expect(reloaded.bySession("s1")?.settings).toEqual({});

    const fresh = await store.startOver(first, "s2");
    expect(fresh.trailHidden).toEqual(["commands"]);
    await store.setTrailHidden("s2", undefined);
    expect(store.bySession("s2")?.trailHidden).toBeUndefined();
  });

  // Saves that overlap must not share a temporary file, or one loses its rename to the other.
  it("lands every save when several overlap, and ends holding the last state", async () => {
    const store = new ConversationStore(file);
    await store.load();
    for (let index = 0; index < 5; index += 1) {
      await store.bindNew({ sessionId: `s${index}`, cwd: "/tmp", channelId: `c${index}`, ownerId: "u1" });
    }
    for (let round = 0; round < 10; round += 1) {
      const stamp = new Date(Date.UTC(2026, 8, 1, 12, round)).toISOString();
      const saves = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => store.markSynced(`s${index}`, stamp)));
      expect(saves.filter((save) => save.status === "rejected")).toEqual([]);
    }
    const onDisk = JSON.parse(await fs.readFile(file, "utf8")) as { conversations: Record<string, { syncedThrough: string }> };
    expect(Object.values(onDisk.conversations).map((entry) => entry.syncedThrough)).toEqual(
      Array.from({ length: 5 }, () => new Date(Date.UTC(2026, 8, 1, 12, 9)).toISOString()),
    );
    expect((await fs.readdir(path.dirname(file))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  // A voice channel left in the index routes into whatever is bound under the same session next.
  it("forgets every channel of a conversation when its text channel is unbound", async () => {
    const store = new ConversationStore(file);
    await store.load();
    await store.bindNew({ sessionId: "s1", cwd: "/tmp", channelId: "text-1", ownerId: "u1" });
    await store.attachChannel("s1", "voice-1", "voice");
    await store.unbind("text-1");

    await store.bindNew({ sessionId: "s1", cwd: "/tmp", channelId: "text-2", ownerId: "u1" });
    expect(store.byChannel("voice-1")).toBeUndefined();
    expect(store.byChannel("text-2")?.sessionId).toBe("s1");
  });

  const conversation = {
    sessionId: "s1",
    cwd: "/tmp",
    boundAt: "2026-09-13T00:00:00Z",
    settings: { model: "opus" },
    channels: { text: "c-text" },
    ownerId: "owner1",
    memberIds: [] as string[],
  };

  it("starts empty when the file does not exist", async () => {
    const store = new ConversationStore(file);
    await store.load();
    expect(store.byChannel("c-text")).toBeUndefined();
  });

  it("round-trips a conversation through disk", async () => {
    const first = new ConversationStore(file);
    await first.load();
    await first.bind("c-text", { ...conversation });

    const second = new ConversationStore(file);
    await second.load();
    expect(second.byChannel("c-text")?.sessionId).toBe("s1");
    expect(second.byChannel("c-text")?.settings.model).toBe("opus");
  });

  it("resolves a voice channel to the same conversation as its text channel", async () => {
    const store = new ConversationStore(file);
    await store.load();
    await store.bind("c-text", { ...conversation });
    await store.attachChannel("s1", "c-voice", "voice");

    expect(store.byChannel("c-voice")?.sessionId).toBe("s1");
    expect(store.byChannel("c-text")?.sessionId).toBe("s1");
    expect(store.bySession("s1")?.channels.voice).toBe("c-voice");
  });

  it("unbinding the voice channel leaves the conversation intact", async () => {
    const store = new ConversationStore(file);
    await store.load();
    await store.bind("c-text", { ...conversation });
    await store.attachChannel("s1", "c-voice", "voice");
    await store.unbind("c-voice");

    expect(store.byChannel("c-text")?.sessionId).toBe("s1");
    expect(store.byChannel("c-voice")).toBeUndefined();
  });

  it("unbinding the text channel drops the conversation", async () => {
    const store = new ConversationStore(file);
    await store.load();
    await store.bind("c-text", { ...conversation });
    await store.unbind("c-text");
    expect(store.bySession("s1")).toBeUndefined();
  });

  it("leaves no temp file behind after writing", async () => {
    const store = new ConversationStore(file);
    await store.load();
    await store.bind("c-text", { ...conversation });
    expect(await fs.readdir(path.dirname(file))).toEqual(["conversations.json"]);
  });
});

describe("the conversation store", () => {
  it("forgets the conversation a channel held when another is bound to it", async () => {
    const store = new ConversationStore(path.join(await fs.mkdtemp(path.join(os.tmpdir(), "conv-")), "conversations.json"));
    await store.load();
    await store.bindNew({ sessionId: "first", cwd: "/srv/app", channelId: "c1", ownerId: "o" });
    await store.bindNew({ sessionId: "second", cwd: "/srv/app", channelId: "c1", ownerId: "o" });

    expect(store.all().map((conversation) => conversation.sessionId)).toEqual(["second"]);
    expect(store.bySession("first")).toBeUndefined();
  });
});

describe("PendingCreates", () => {
  it("hands a request back exactly once", () => {
    const pending = new PendingCreates(() => 0);
    pending.remember("m1", { name: "App", cwd: "/p/app" });
    expect(pending.take("m1")?.name).toBe("App");
    expect(pending.take("m1")).toBeNull();
  });

  it("forgets a request nobody answered", () => {
    let now = 0;
    const pending = new PendingCreates(() => now);
    pending.remember("m1", { name: "App", cwd: "/p/app" });
    now = PENDING_TTL_MS + 1;
    expect(pending.take("m1")).toBeNull();
  });

  it("returns nothing for a button it never saw", () => {
    expect(new PendingCreates(() => 0).take("unknown")).toBeNull();
  });
});

// Paths are assembled from pieces: the private scan rightly refuses a literal home path or short name in the tree.

describe("ActiveTurns", () => {
  const anchor = { channelId: "chan-1", messageId: "msg-1" };

  async function freshFile(): Promise<string> {
    return path.join(await fs.mkdtemp(path.join(os.tmpdir(), "turns-")), "turns.json");
  }

  it("remembers a running turn on disk and forgets it when the turn ends", async () => {
    const file = await freshFile();
    const turns = new ActiveTurns(file);
    await turns.record("s1", anchor);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ s1: anchor });
    await turns.clear("s1");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({});
  });

  // A bridge that died mid-turn is a new process; what it finds on disk is the previous one's unfinished work.
  it("hands the previous process's unfinished turns to the next one, exactly once", async () => {
    const file = await freshFile();
    await new ActiveTurns(file).record("s1", anchor);

    const next = new ActiveTurns(file);
    await next.load();
    expect(await next.takeLeftovers()).toEqual([anchor]);
    expect(await next.takeLeftovers()).toEqual([]);

    const later = new ActiveTurns(file);
    await later.load();
    expect(await later.takeLeftovers()).toEqual([]);
  });

  it("starts empty when there is no file yet", async () => {
    const turns = new ActiveTurns(await freshFile());
    await turns.load();
    expect(await turns.takeLeftovers()).toEqual([]);
  });

  // Every session shares the one file, and two turns starting together must not trip over the same temp file.
  it("survives many sessions recording and clearing at once, and ends with the truth on disk", async () => {
    const file = await freshFile();
    const turns = new ActiveTurns(file);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => turns.record(`s${index}`, { channelId: "c", messageId: `m${index}` })),
    );
    await Promise.all(Array.from({ length: 10 }, (_, index) => turns.clear(`s${index}`)));
    const onDisk = JSON.parse(await fs.readFile(file, "utf8"));
    expect(Object.keys(onDisk).sort()).toEqual(Array.from({ length: 10 }, (_, index) => `s${index + 10}`).sort());
  });
});

describe("workingDirFor", () => {
  const bridge = (workspacesRoot?: string) =>
    ({
      ownerId: "host",
      config: { projectsRoot: path.resolve("/srv/projects"), workspacesRoot },
    }) as never;

  it("puts the host owner in the projects root", () => {
    expect(workingDirFor(bridge(), "owner", "host")).toBe(path.resolve("/srv/projects"));
  });

  it("puts an operator in their own workspace", () => {
    const dir = workingDirFor(bridge(path.resolve("/srv/ws")), "operator", "u1");
    expect(dir).toBe(path.join(path.resolve("/srv/ws"), "u1"));
  });

  it("joins a bare project name onto whichever root applies", () => {
    const dir = workingDirFor(bridge(path.resolve("/srv/ws")), "operator", "u1", "notes");
    expect(dir).toBe(path.join(path.resolve("/srv/ws"), "u1", "notes"));
  });

  // Nothing confines a conversation, so refusing a path would be friction without a boundary.
  it("lets any tier name an absolute path", () => {
    const dir = workingDirFor(bridge(path.resolve("/srv/ws")), "operator", "u1", path.resolve("/srv/other"));
    expect(dir).toBe(path.resolve("/srv/other"));
  });

  it("has nowhere to put an operator with no workspace root configured", () => {
    expect(workingDirFor(bridge(), "operator", "u1")).toBeNull();
    expect(say("create.ownersOnlyHere")).toContain("WORKSPACES_ROOT");
  });
});

describe("access tiers", () => {
  const ctx = { ownerIds: ["host", "cohost"], operatorIds: ["op"] };

  it("recognises an owner from the host's own list", () => {
    expect(tierFor(ctx, "host")).toBe("owner");
  });

  it("supports more than one owner", () => {
    expect(tierFor(ctx, "cohost")).toBe("owner");
  });

  it("recognises an operator", () => {
    expect(tierFor(ctx, "op")).toBe("operator");
  });

  it("rejects everybody else", () => {
    expect(tierFor(ctx, "nobody")).toBe("none");
  });

  it("lets an owner run anything", () => {
    expect(canRunCommand("owner", "operator")).toBe(true);
    expect(canRunCommand("owner", "invite")).toBe(true);
  });

  it("stops an operator changing who has access", () => {
    expect(canRunCommand("operator", "create")).toBe(true);
    expect(canRunCommand("operator", "operator")).toBe(false);
    expect(canRunCommand("operator", "invite")).toBe(false);
    expect(canRunCommand("operator", "uninvite")).toBe(false);
  });

  // Tier "none" is the only security boundary the bridge has: anyone past it runs as the host user.
  it("lets anyone below operator run nothing at all", () => {
    const everyCommand = [
      "ask",
      "sync",
      "whoami",
      "members",
      "skills",
      "stop",
      "create",
      "resume",
      "invite",
      "operator",
      "unbind",
      "purge",
      "clear",
      "takeover",
      "run",
    ];
    for (const command of everyCommand) {
      expect(canRunCommand("none", command)).toBe(false);
    }
  });
});

describe("workspaceFor", () => {
  it("gives each user their own folder under the root", () => {
    expect(workspaceFor("/srv/ws", "u1")).toBe(path.join("/srv/ws", "u1"));
    expect(workspaceFor("/srv/ws", "u1")).not.toBe(workspaceFor("/srv/ws", "u2"));
  });
});

describe("conversationOverwrites", () => {
  const audience = { everyoneRoleId: "everyone", botUserId: "bot", ownerId: "owner", memberIds: [] as string[] };

  it("hides the channel from everyone by default", () => {
    const [first] = conversationOverwrites(audience);
    expect(first!.id).toBe("everyone");
    expect(first!.deny).toContain(PermissionFlagsBits.ViewChannel);
  });

  it("keeps the bot able to post in its own private channel", () => {
    const bot = conversationOverwrites(audience).find((overwrite) => overwrite.id === "bot");
    expect(bot!.allow).toContain(PermissionFlagsBits.ViewChannel);
    expect(bot!.allow).toContain(PermissionFlagsBits.SendMessages);
  });

  it("gives the owner access", () => {
    const owner = conversationOverwrites(audience).find((overwrite) => overwrite.id === "owner");
    expect(owner!.allow).toContain(PermissionFlagsBits.ViewChannel);
  });

  it("gives each invited guest access", () => {
    const overwrites = conversationOverwrites({ ...audience, memberIds: ["g1", "g2"] });
    expect(overwrites.find((overwrite) => overwrite.id === "g1")).toBeDefined();
    expect(overwrites.find((overwrite) => overwrite.id === "g2")).toBeDefined();
  });

  it("never grants a guest channel management", () => {
    const guest = conversationOverwrites({ ...audience, memberIds: ["g1"] }).find((overwrite) => overwrite.id === "g1");
    expect(guest!.allow).not.toContain(PermissionFlagsBits.ManageChannels);
  });

  it("does not duplicate an owner who is also listed as a member", () => {
    const overwrites = conversationOverwrites({ ...audience, memberIds: ["owner"] });
    expect(overwrites.filter((overwrite) => overwrite.id === "owner")).toHaveLength(1);
  });
});

describe("command visibility", () => {
  const defs = bridgeCommandDefinitions();

  it("hides operator and owner commands from ordinary members", () => {
    const hidden = defs
      .filter((definition) => definition.default_member_permissions != null)
      .map((definition) => definition.name);
    expect(hidden).toContain("create");
    expect(hidden).toContain("invite");
    expect(hidden).toContain("purge");
  });

  it("hides every command, since nobody below operator may run one", () => {
    const open = defs.filter((definition) => definition.default_member_permissions == null).map((definition) => definition.name);
    expect(open).toEqual([]);
  });
});

describe("OperatorStore", () => {
  let filePath: string;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "operators-"));
    filePath = path.join(dir, "operators.json");
  });

  it("starts empty when nothing has been stored", async () => {
    const store = new OperatorStore(filePath);
    await store.load();
    expect(store.all()).toEqual([]);
    expect(store.has("u1")).toBe(false);
  });

  it("remembers someone across a reload", async () => {
    const store = new OperatorStore(filePath);
    await store.load();
    await store.add("u1");

    const reopened = new OperatorStore(filePath);
    await reopened.load();
    expect(reopened.has("u1")).toBe(true);
  });

  it("reports whether the call changed anything", async () => {
    const store = new OperatorStore(filePath);
    await store.load();
    expect(await store.add("u1")).toBe(true);
    expect(await store.add("u1")).toBe(false);
    expect(await store.remove("u1")).toBe(true);
    expect(await store.remove("u1")).toBe(false);
  });

  it("survives a corrupt file rather than refusing to start", async () => {
    await fs.writeFile(filePath, "{ not json", "utf8");
    const store = new OperatorStore(filePath);
    await store.load();
    expect(store.all()).toEqual([]);
  });

  it("ignores entries that are not ids", async () => {
    await fs.writeFile(filePath, JSON.stringify(["u1", 42, null, "u2"]), "utf8");
    const store = new OperatorStore(filePath);
    await store.load();
    expect(store.all()).toEqual(["u1", "u2"]);
  });
});
