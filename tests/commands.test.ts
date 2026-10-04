import { describe, it, expect, vi } from "vitest";
import { record, wait } from "./helpers/records.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildOptions } from "../src/claude/runner.ts";
import { PENDING_TTL_MS, Pending } from "../src/discord/pendingCreate.ts";
import { commandsChanged, type ClaudeEvent, type SessionCommand } from "../src/claude/events.ts";
import { commandChoices, describeRun, refusal } from "../src/discord/commands/run.ts";
import { CapabilityCache } from "../src/claude/capabilities.ts";
import { describeStop, preflight } from "../src/discord/turnFlow.ts";
import { classifyPrompt, describeNotRun } from "../src/discord/commands/typed.ts";
import { describeClear } from "../src/discord/commands/clear.ts";
import { STATE_EMOJI } from "../src/discord/reactions.ts";
import { describeStopTurn } from "../src/discord/turnFlow.ts";
import { stopActionId, stopAllActionId } from "../src/discord/menus.ts";
import { parsePluginList } from "../src/claude/pluginCatalog.ts";
import { pluginSelectOptions } from "../src/discord/commands/plugins.ts";
import { describeSkillMenus, menuPlaceholder, skillSelectMenus } from "../src/discord/commands/skills.ts";
import { MAX_CATEGORY_NAME, MENUS_PER_MESSAGE } from "../src/discord/limits.ts";
import {
  CLEAR_CANCEL,
  clearConfirmId,
  RUN_CANCEL,
  RUN_CONFIRM,
  PLUGIN_SELECT,
  PURGE_CANCEL,
  PURGE_CONFIRM,
  SKILL_SELECT,
  UNBIND_DELETE,
  UNBIND_KEEP,
  parseCustomId,
  pluginToggleId,
  skillSelectId,
} from "../src/discord/menus.ts";
import { describePurge, isBulkDeletable, purgeChannel } from "../src/discord/purge.ts";
import { CHANNELS_PER_CATEGORY, describeCategoryFull, findCategory, normaliseCategoryName } from "../src/discord/category.ts";
import { forkName } from "../src/discord/commands/fork.ts";
import { sayIn } from "../src/i18n/index.ts";
import { versionsFooter } from "../src/discord/commands/settings.ts";
import { TurnQueue, describeDepth, describeFull, describeQueued, MAX_QUEUE_DEPTH } from "../src/discord/turnQueue.ts";

const say = sayIn("en");

describe("a command typed as a message", () => {
  it("is known by a name holding an underscore or a dot, as plugins name theirs", () => {
    for (const typed of ["/my_plugin:do_it now", "/tools.v2 x", "/ledger:audit 2026"]) {
      expect(classifyPrompt(typed, [], []).kind, typed).toBe("passthrough");
    }
    expect(classifyPrompt("/1st", [], []).kind).toBe("turn");
  });

  // The refusal points at a command of the bridge's own, which has to exist.
  it("refuses only the settings the bridge has a command of its own for", () => {
    for (const owned of ["/model opus", "/effort high"]) expect(classifyPrompt(owned, [], []).kind, owned).toBe("bridge-owned");
    for (const passed of ["/autocompact", "/agent reviewer", "/fallback-model sonnet"]) {
      expect(classifyPrompt(passed, [], []).kind, passed).toBe("passthrough");
    }
  });
});

describe("purgeChannel", () => {
  const fakeMessage = (id: string, deletable = true) => ({
    id,
    createdAt: new Date(),
    delete: vi.fn(async () => {
      if (!deletable) throw new Error("Unknown Message");
      return undefined;
    }),
  });

  const fakeChannel = (pages: ReturnType<typeof fakeMessage>[][], bulk: () => unknown) => ({
    messages: { fetch: vi.fn(async () => new Map((pages.shift() ?? []).map((message) => [message.id, message]))) },
    bulkDelete: vi.fn(async () => bulk()),
  });

  it("falls back to deleting one at a time when the bulk call throws", async () => {
    const messages = [fakeMessage("a"), fakeMessage("b")];
    const channel = fakeChannel([messages, []], () => {
      throw new Error("Unknown Message");
    });

    const result = await purgeChannel(channel as never);
    expect(result.bulkDeleted).toBe(2);
    expect(result.failed).toBe(0);
    for (const message of messages) expect(message.delete).toHaveBeenCalled();
  });

  it("counts one that is already gone as failed rather than giving up", async () => {
    const messages = [fakeMessage("a"), fakeMessage("b", false)];
    const channel = fakeChannel([messages, []], () => {
      throw new Error("Unknown Message");
    });

    const result = await purgeChannel(channel as never);
    expect(result.bulkDeleted).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("returns rather than throwing, so a caller can always report", async () => {
    const channel = fakeChannel([[fakeMessage("a")], []], () => {
      throw new Error("boom");
    });
    await expect(purgeChannel(channel as never)).resolves.toMatchObject({ bulkDeleted: 1 });
  });

  // A message that cannot be deleted stays at the top of the channel, and would be fetched again with every page read from the top.
  it("goes on past messages it cannot delete, and counts each of them once", async () => {
    const held = Array.from({ length: 1000 }, (_, index) => ({ ...fakeMessage(`m${index}`, index >= 10), gone: false }));
    const channel = {
      messages: {
        fetch: async ({ limit, before }: { limit: number; before?: string }) => {
          const left = held.filter((message) => !message.gone);
          const below = left.filter((message) => !before || Number(message.id.slice(1)) > Number(before.slice(1)));
          return new Map(below.slice(0, limit).map((message) => [message.id, message]));
        },
      },
      bulkDelete: async (wanted: typeof held) => {
        const deleted = wanted.filter((message) => Number(message.id.slice(1)) >= 10);
        for (const message of deleted) message.gone = true;
        return new Map(deleted.map((message) => [message.id, message]));
      },
    };

    const result = await purgeChannel(channel as never);
    expect(result).toEqual({ bulkDeleted: 990, slowDeleted: 0, failed: 10 });
    expect(held.filter((message) => !message.gone).map((message) => message.id)).toEqual(
      held.slice(0, 10).map((message) => message.id),
    );
  });
});

describe("categories", () => {
  const categories = [
    { id: "1", name: "Projects" },
    { id: "2", name: "Archive" },
  ];

  it("matches an existing category whatever the case", () => {
    expect(findCategory(categories, "projects")?.id).toBe("1");
    expect(findCategory(categories, "  ARCHIVE  ")?.id).toBe("2");
  });

  it("reports nothing to match when there is no such category", () => {
    expect(findCategory(categories, "Nope")).toBeNull();
    expect(findCategory(categories, "   ")).toBeNull();
  });

  it("keeps the case and spacing a category was given, unlike a channel name", () => {
    expect(normaliseCategoryName("  My Projects  ")).toBe("My Projects");
  });

  it("trims a name Discord would reject as too long", () => {
    expect(normaliseCategoryName("x".repeat(200)).length).toBe(MAX_CATEGORY_NAME);
  });

  it("explains a full category rather than letting Discord refuse opaquely", () => {
    const message = describeCategoryFull(say, "Projects");
    expect(message).toContain("Projects");
    expect(message).toContain(String(CHANNELS_PER_CATEGORY));
  });
});

describe("preflight", () => {
  const base = record({ sessionId: "s1", name: "Deploy Scripts", cwd: "/p" });

  it("allows a session nothing is holding", () => {
    expect(preflight(say, base).kind).toBe("ok");
  });

  it("offers takeover for a background holder", () => {
    const held = {
      ...base,
      live: { pid: 1, cwd: "/p", kind: "background" as const, sessionId: "s1", id: "abc123" },
    };
    const result = preflight(say, held);
    expect(result.kind).toBe("takeover-available");
    expect(result.kind === "takeover-available" && result.shortId).toBe("abc123");
  });

  it("refuses an interactive holder and names its directory", () => {
    const held = {
      ...base,
      live: { pid: 42, cwd: "/home/u/projects/deploy-scripts", kind: "interactive" as const, sessionId: "s1" },
    };
    const result = preflight(say, held);
    expect(result.kind).toBe("refused");
    expect(result.kind === "refused" && result.message).toContain("/home/u/projects/deploy-scripts");
  });

  // Closing a terminal that is working would cut its turn short, so only one that says it is idle is offered.
  it("offers takeover of a terminal that is idle, and of no other", () => {
    const terminal = { pid: 42, cwd: "/home/u/projects/deploy-scripts", kind: "interactive" as const, sessionId: "s1" };

    const idle = preflight(say, { ...base, live: { ...terminal, status: "idle" } });
    expect(idle).toMatchObject({ kind: "terminal-idle", pid: 42 });
    expect(idle.kind === "terminal-idle" && idle.message).toContain("`/takeover`");

    const busy = preflight(say, { ...base, live: { ...terminal, status: "busy" } });
    expect(busy.kind).toBe("refused");
    expect(busy.kind === "refused" && busy.message).toContain("a turn is running there");

    const silent = preflight(say, { ...base, live: terminal });
    expect(silent.kind).toBe("refused");
    expect(silent.kind === "refused" && silent.message).toContain("Close that terminal");
  });
});

describe("stopping one turn or all of them", () => {
  it("tells a stop button from a stop-all button", () => {
    expect(parseCustomId(stopActionId("s1"))).toEqual({ kind: "turn-stop", sessionId: "s1" });
    expect(parseCustomId(stopAllActionId("s1"))).toEqual({ kind: "turn-stop-all", sessionId: "s1" });
  });

  it("says what runs next when only the turn in flight was stopped", () => {
    expect(describeStopTurn(say, { stopped: true, queued: 0 })).toContain("Nothing was queued");
    expect(describeStopTurn(say, { stopped: true, queued: 1 })).toContain("1 message queued behind it runs next");
    expect(describeStopTurn(say, { stopped: true, queued: 3 })).toContain("3 messages queued behind it run next");
    expect(describeStopTurn(say, { stopped: false, queued: 0 })).toBe("Nothing is running here.");
  });

  // The fixed set: standard Unicode, one per state, and nothing else in the bridge uses emoji.
  it("has one standard emoji per turn state", () => {
    expect(Object.keys(STATE_EMOJI).sort()).toEqual(["done", "failed", "queued", "running", "stopped", "waiting"]);
    expect(new Set(Object.values(STATE_EMOJI)).size).toBe(6);
  });
});

describe("/run finds a conversation's commands", () => {
  const command = (name: string, description = "", extra: Partial<SessionCommand> = {}): SessionCommand => ({
    name,
    description,
    argumentHint: "",
    aliases: [],
    builtin: false,
    ...extra,
  });
  const known = [
    command("compact", "Free up context", { builtin: true, argumentHint: "<instructions>" }),
    command("code-review", "Review the current diff", { builtin: true, aliases: ["review"] }),
    command("ledger:code-review", "Review a pull request against the ledger rules", { argumentHint: "[pr]" }),
    command("ledger:audit", "Audit the books"),
    command("doctor", "Check the install", { builtin: true }),
    command("model", "Switch model", { builtin: true }),
  ];
  const runnable = (name: string) => classifyPrompt(`/${name}`, ["doctor"], []).kind === "passthrough";

  it("reads the list the session sends, tidying what a label cannot hold", () => {
    const event = {
      type: "system",
      subtype: "commands_changed",
      commands: [
        { name: "ledger:audit", description: "Audit\n  the books", argumentHint: " [year] ", aliases: ["books"] },
        { name: "compact", description: "Free up context", argumentHint: "", builtin: true },
        { description: "no name" },
      ],
    } as unknown as ClaudeEvent;
    expect(commandsChanged(event)).toEqual([
      { name: "ledger:audit", description: "Audit the books", argumentHint: "[year]", aliases: ["books"], builtin: false },
      { name: "compact", description: "Free up context", argumentHint: "", aliases: [], builtin: true },
    ]);
    expect(commandsChanged({ type: "system", subtype: "status", status: null })).toBeNull();
    const long = {
      type: "system",
      subtype: "commands_changed",
      commands: [{ name: "wordy", description: "y".repeat(400) }],
    } as unknown as ClaudeEvent;
    expect(commandsChanged(long)![0]!.description).toBe(`${"y".repeat(277)}...`);
  });

  it("offers what plugins and skills add before the built-ins, and never what the bridge would refuse", () => {
    expect(commandChoices(known, "", runnable)).toEqual([
      { name: "ledger:audit · Audit the books", value: "ledger:audit" },
      { name: "ledger:code-review [pr] · Review a pull request against the ledger rules", value: "ledger:code-review" },
      { name: "code-review · Review the current diff", value: "code-review" },
      { name: "compact <instructions> · Free up context", value: "compact" },
    ]);
  });

  it("ranks a name that starts with what was typed over one that contains it, over a description that mentions it", () => {
    const values = (typed: string) => commandChoices(known, typed, runnable).map((choice) => choice.value);
    expect(values("code")).toEqual(["code-review", "ledger:code-review"]);
    expect(values("/audit")).toEqual(["ledger:audit"]);
    expect(values("review")).toEqual(["ledger:code-review", "code-review"]);
    expect(values("context")).toEqual(["compact"]);
    expect(values("zzz")).toEqual([]);
  });

  it("keeps to Discord's limits however many commands there are", () => {
    const many = Array.from({ length: 60 }, (_, index) => command(`pack:command-${index}`, "y".repeat(300)));
    const choices = commandChoices(many, "", runnable);
    expect(choices).toHaveLength(25);
    for (const choice of choices) expect(choice.name.length).toBeLessThanOrEqual(100);
  });

  it("refuses what could not run, saying why, and lets the rest through", () => {
    expect(refusal(say, "ledger:audit", "/ledger:audit 2026", known, ["doctor"])).toBeNull();
    expect(refusal(say, "review", "/review", known, ["doctor"])).toBeNull();
    expect(refusal(say, "nope", "/nope", known, ["doctor"])).toContain("not a command this conversation has");
    expect(refusal(say, "nope", "/nope", [], ["doctor"])).toBeNull();
    expect(refusal(say, "doctor", "/doctor", known, ["doctor"])).toContain("interactive terminal");
    expect(refusal(say, "model", "/model opus", known, ["doctor"])).toContain("bot's own");
    expect(refusal(say, "rm -rf", "/rm -rf", known, ["doctor"])).toContain("not a command name");
    expect(refusal(say, "-", "/-", known, ["doctor"])).toContain("not known yet");
  });

  // Someone used to the terminal types the command; there it asks before starting, here it would not.
  it("turns away a typed command that asks first in a terminal, and says how to run it here", () => {
    for (const typed of ["/code-review ultra", "/review ultra --fix 12", "/ultrareview 12", "/CODE-REVIEW Ultra"]) {
      expect(classifyPrompt(typed, [], []).kind).toBe("asks-first");
    }
    const ultra = classifyPrompt("/code-review ultra --fix", [], []);
    expect(ultra.kind === "asks-first" && describeNotRun(say, ultra)).toContain("`/run command:code-review args:ultra --fix`");
    expect(ultra.kind === "asks-first" && describeNotRun(say, ultra)).toContain("billed");
    expect(ultra.kind === "asks-first" && describeNotRun(say, ultra)).toContain("waits for you to press Run");
    const bare = classifyPrompt("/ultrareview", [], []);
    expect(bare.kind === "asks-first" && describeNotRun(say, bare)).toContain("`/run command:ultrareview`");

    for (const typed of ["/code-review", "/code-review high --fix", "/code-review ultrawide", "/review 12"]) {
      expect(classifyPrompt(typed, [], []).kind).toBe("passthrough");
    }
  });

  it("lets /run take what a typed message may not, since /run is where it gets asked", () => {
    expect(refusal(say, "code-review", "/code-review ultra", known, ["doctor"])).toBeNull();
    expect(refusal(say, "ultrareview", "/ultrareview", [], ["doctor"])).toBeNull();
  });

  it("shows the exact line, what it does and what it takes before anything runs, with the cost where one is known", () => {
    expect(describeRun(say, "/ledger:code-review 12", known[2], null)).toBe(
      "Run this in the conversation?\n```\n/ledger:code-review 12\n```\n" +
        "Review a pull request against the ledger rules\nTakes: `[pr]`\nNothing starts until you press Run.",
    );
    const billed = describeRun(say, "/code-review ultra", known[1], "It starts a cloud review, which is billed.");
    expect(billed).toContain("**It starts a cloud review, which is billed.**");
    expect(describeRun(say, "/unlisted", undefined, null)).toBe(
      "Run this in the conversation?\n```\n/unlisted\n```\nNothing starts until you press Run.",
    );
  });

  it("holds what was asked for until its button is pressed, once, and not forever", () => {
    let now = 0;
    const pending = new Pending<{ prompt: string }>(() => now);
    pending.remember("m1", { prompt: "/compact" });
    expect(pending.take("m1")).toEqual({ prompt: "/compact" });
    expect(pending.take("m1")).toBeNull();
    pending.remember("m2", { prompt: "/compact" });
    now = PENDING_TTL_MS + 1;
    expect(pending.take("m2")).toBeNull();
    expect(parseCustomId(RUN_CONFIRM)).toEqual({ kind: "run-confirm" });
    expect(parseCustomId(RUN_CANCEL)).toEqual({ kind: "run-cancel" });
  });

  it("remembers a folder's commands across a restart, and writes only when they change", async () => {
    const file = path.join(os.tmpdir(), `claudetalk-commands-${process.pid}-${Math.random()}.json`);
    const cache = new CapabilityCache(file);
    await cache.load();
    expect(cache.commands("/srv/app")).toEqual([]);
    await cache.recordCommands("/srv/app", known);
    // A rewrite inside one clock tick leaves the same time on the file, so the write itself is counted, at the rename that lands it.
    const landed = vi.spyOn(fs, "rename");
    try {
      await cache.recordCommands("/srv/app", known);
      expect(landed).not.toHaveBeenCalled();
      await cache.recordCommands("/srv/app", [
        ...known,
        { name: "extra", description: "", argumentHint: "", aliases: [], builtin: false },
      ]);
      expect(landed).toHaveBeenCalledOnce();
    } finally {
      landed.mockRestore();
    }
    await cache.recordCommands("/srv/app", known);

    const reloaded = new CapabilityCache(file);
    await reloaded.load();
    expect(reloaded.commands("/srv/app")).toEqual(known);
    expect(reloaded.commands("/srv/other")).toEqual([]);
    await fs.rm(file, { force: true });
  });
});

describe("classifyPrompt", () => {
  const terminalOnly = ["doctor", "color", "reload-plugins"];

  it("treats ordinary text as a turn", () => {
    expect(classifyPrompt("what does this repo do?", terminalOnly, []).kind).toBe("turn");
  });

  it("passes a Claude Code slash command through", () => {
    expect(classifyPrompt("/compact", terminalOnly, []).kind).toBe("passthrough");
  });

  it("passes a namespaced skill command through", () => {
    expect(classifyPrompt("/superpowers:brainstorming", terminalOnly, []).kind).toBe("passthrough");
  });

  it("rejects a terminal-only command with an explanation", () => {
    const result = classifyPrompt("/doctor", terminalOnly, []);
    expect(result.kind).toBe("terminal-only");
    expect(result.kind === "terminal-only" && describeNotRun(say, result)).toContain("doctor");
  });

  it("refuses to pass through /model, which would silently revert", () => {
    const result = classifyPrompt("/model opus", terminalOnly, []);
    expect(result.kind).toBe("bridge-owned");
    expect(result.kind === "bridge-owned" && describeNotRun(say, result)).toContain("/model");
  });

  it("refuses to pass through /effort for the same reason", () => {
    expect(classifyPrompt("/effort high", terminalOnly, []).kind).toBe("bridge-owned");
  });

  it("does not treat a path at the start of a message as a command", () => {
    expect(classifyPrompt("/home/u/x is the path", terminalOnly, []).kind).toBe("turn");
  });

  describe("a command typed by one of its other names", () => {
    const listed = (name: string, aliases: string[]) => ({ name, aliases, description: "", argumentHint: "", builtin: true });
    const known = [listed("clear", ["reset", "new"]), listed("doctor", ["checkup"]), listed("code-review", ["review"])];

    it("is judged as the command it stands for", () => {
      expect(classifyPrompt("/reset", terminalOnly, known).kind).toBe("ambiguous");
      expect(classifyPrompt("/new", terminalOnly, known).kind).toBe("ambiguous");
      expect(classifyPrompt("/checkup", terminalOnly, known).kind).toBe("terminal-only");
      const review = classifyPrompt("/review ultra --fix", terminalOnly, known);
      expect(review.kind === "asks-first" && describeNotRun(say, review)).toContain(
        "`/run command:code-review args:ultra --fix`",
      );
    });

    // A conversation opened with /resume has no list until its first turn, and /reset there would start a session the channel cannot see.
    it("is still recognised before the folder's command list has been learned", () => {
      expect(classifyPrompt("/reset", terminalOnly, []).kind).toBe("ambiguous");
      expect(classifyPrompt("/new", terminalOnly, []).kind).toBe("ambiguous");
      expect(classifyPrompt("/review ultra", terminalOnly, []).kind).toBe("asks-first");
    });

    it("belongs to the command that has it as its own name before it is anyone's alias", () => {
      const withOwn = [...known, listed("new", [])];
      expect(classifyPrompt("/new", terminalOnly, withOwn)).toEqual({ kind: "passthrough", command: "new" });
    });
  });
});

describe("pluginSelectOptions", () => {
  const raw = JSON.stringify([
    { id: "superpowers@claude-plugins-official", version: "6.3.0", scope: "user", enabled: true, installPath: "/x" },
    { id: "code-review@claude-plugins-official", version: "1.0.0", scope: "user", enabled: false, installPath: "/y" },
  ]);

  it("shows the enabled state in the description", () => {
    const options = pluginSelectOptions(say, parsePluginList(raw));
    expect(options[0]!.description).toMatch(/enabled/);
    expect(options[1]!.description).toMatch(/disabled/);
  });

  it("keeps labels within the Discord 100 character limit", () => {
    const long = JSON.stringify([{ id: "x".repeat(200), version: "1", scope: "user", enabled: true, installPath: "/z" }]);
    expect(pluginSelectOptions(say, parsePluginList(long))[0]!.label.length).toBeLessThanOrEqual(100);
  });

  it("caps at the Discord 25 option limit", () => {
    const many = JSON.stringify(
      Array.from({ length: 40 }, (_, index) => ({
        id: `p${index}`,
        version: "1",
        scope: "user",
        enabled: true,
        installPath: "/z",
      })),
    );
    expect(pluginSelectOptions(say, parsePluginList(many))).toHaveLength(25);
  });

  it("returns an empty list for unparseable output", () => {
    expect(parsePluginList("not json")).toEqual([]);
  });
});

describe("parseCustomId", () => {
  it("reads a chosen plugin from the select menu", () => {
    const action = parseCustomId(PLUGIN_SELECT, "superpowers@claude-plugins-official");
    expect(action).toEqual({ kind: "plugin-chosen", id: "superpowers@claude-plugins-official" });
  });

  it("reads a chosen skill", () => {
    expect(parseCustomId(SKILL_SELECT, "superpowers:brainstorming")).toEqual({
      kind: "skill-chosen",
      skill: "superpowers:brainstorming",
    });
  });

  it("round-trips an enable button", () => {
    const id = pluginToggleId("superpowers@claude-plugins-official", true);
    expect(parseCustomId(id)).toEqual({
      kind: "plugin-toggle",
      id: "superpowers@claude-plugins-official",
      enable: true,
    });
  });

  it("round-trips a disable button", () => {
    const action = parseCustomId(pluginToggleId("code-review@x", false));
    expect(action.kind === "plugin-toggle" && action.enable).toBe(false);
  });

  it("keeps a custom id within the Discord 100 character limit", () => {
    expect(pluginToggleId("x".repeat(300), true).length).toBeLessThanOrEqual(100);
  });

  it("reports unknown for a stale custom id", () => {
    expect(parseCustomId("something:else").kind).toBe("unknown");
  });
});

describe("purge", () => {
  const now = Date.parse("2026-09-14T00:00:00Z");

  it("bulk deletes anything under fourteen days old", () => {
    expect(isBulkDeletable(new Date("2026-09-13T00:00:00Z"), now)).toBe(true);
  });

  it("refuses to bulk delete anything older, which Discord rejects", () => {
    expect(isBulkDeletable(new Date("2026-08-20T00:00:00Z"), now)).toBe(false);
  });

  it("reports a plain total", () => {
    expect(describePurge(say, { bulkDeleted: 42, slowDeleted: 0, failed: 0 }, true)).toContain("Deleted 42 messages");
  });

  it("says how many needed the slow path", () => {
    const text = describePurge(say, { bulkDeleted: 10, slowDeleted: 3, failed: 0 }, true);
    expect(text).toContain("Deleted 13 messages");
    expect(text).toContain("older than 14 days");
  });

  it("reports failures rather than hiding them", () => {
    expect(describePurge(say, { bulkDeleted: 5, slowDeleted: 0, failed: 2 }, true)).toContain("2 could not be deleted");
  });

  it("says the conversation survives when the channel is one", () => {
    expect(describePurge(say, { bulkDeleted: 1, slowDeleted: 0, failed: 0 }, true)).toContain("conversation itself is untouched");
  });

  it("says nothing about /sync in a channel that is not a conversation", () => {
    const text = describePurge(say, { bulkDeleted: 1, slowDeleted: 0, failed: 0 }, false);
    expect(text).not.toContain("/sync");
    expect(text).not.toContain("conversation");
    expect(text).toContain("Deleted 1 message");
  });

  it("handles an already empty channel", () => {
    expect(describePurge(say, { bulkDeleted: 0, slowDeleted: 0, failed: 0 }, true)).toMatch(/already empty/);
  });

  it("round-trips the confirm and cancel buttons", () => {
    expect(parseCustomId(PURGE_CONFIRM).kind).toBe("purge-confirm");
    expect(parseCustomId(PURGE_CANCEL).kind).toBe("purge-cancel");
  });
});

describe("/clear is not passed through", () => {
  it("points at the bridge's own command instead of starting a session the channel cannot see", () => {
    const result = classifyPrompt("/clear", ["doctor"], []);
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && describeNotRun(say, result)).toContain("own `/clear` command");
    expect(result.kind === "ambiguous" && describeNotRun(say, result)).toContain("/purge");
  });
});

describe("turn queue", () => {
  it("runs the first message immediately", () => {
    expect(new TurnQueue().admit("s1").kind).toBe("run-now");
  });

  // A dropped message stays in the lane until the turn ahead of it has ended, which can take a while after a stop.
  it("does not count messages it has already dropped", async () => {
    const queue = new TurnQueue();
    const running = Promise.withResolvers<void>();
    const turns = [queue.enqueue("s1", () => running.promise)];
    for (let queued = 0; queued < MAX_QUEUE_DEPTH - 1; queued += 1) turns.push(queue.enqueue("s1", async () => undefined));
    await wait(1);
    expect(queue.admit("s1")).toEqual({ kind: "full" });

    expect(queue.drain("s1")).toBe(MAX_QUEUE_DEPTH - 1);
    expect(queue.depth("s1")).toBe(1);
    expect(queue.total()).toBe(1);
    expect(queue.admit("s1")).toEqual({ kind: "queued", ahead: 1 });

    running.resolve();
    expect(await Promise.all(turns)).toEqual([true, false, false, false, false]);
    expect(queue.depth("s1")).toBe(0);
  });

  it("queues rather than dropping a message sent mid-turn", async () => {
    const queue = new TurnQueue();
    const order: string[] = [];
    const first = queue.enqueue("s1", async () => {
      await wait(30);
      order.push("first");
    });
    expect(queue.admit("s1")).toEqual({ kind: "queued", ahead: 1 });
    const second = queue.enqueue("s1", async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("keeps different conversations independent", async () => {
    const queue = new TurnQueue();
    const slow = queue.enqueue("s1", () => wait(40));
    expect(queue.admit("s2").kind).toBe("run-now");
    await slow;
  });

  it("refuses once the queue is full rather than growing without bound", async () => {
    const queue = new TurnQueue();
    const running = Array.from({ length: MAX_QUEUE_DEPTH }, () => queue.enqueue("s1", () => wait(20)));
    const outcome = queue.admit("s1");
    expect(outcome.kind).toBe("full");
    expect(outcome.kind === "full" && describeFull(say)).toContain("/stop");
    // The lane counts the running turn, so the refusal must not call all five of them queued.
    expect(outcome.kind === "full" && describeFull(say)).toContain("one running");
    await Promise.all(running);
  });

  it("a failed turn does not block what is queued behind it", async () => {
    const queue = new TurnQueue();
    const order: string[] = [];
    const failing = queue.enqueue("s1", async () => {
      await wait(10);
      throw new Error("turn blew up");
    });
    const after = queue.enqueue("s1", async () => {
      order.push("ran anyway");
    });
    await Promise.allSettled([failing, after]);
    expect(order).toEqual(["ran anyway"]);
  });

  it("empties itself so a later message runs immediately again", async () => {
    const queue = new TurnQueue();
    await queue.enqueue("s1", () => wait(5));
    expect(queue.depth("s1")).toBe(0);
    expect(queue.admit("s1").kind).toBe("run-now");
  });

  it("names how many are ahead", () => {
    expect(describeQueued(say, 1)).toContain("still running");
    expect(describeQueued(say, 3)).toContain("3 messages");
    expect(describeQueued(sayIn("sv"), 3)).toContain("3 meddelanden");
  });
});

describe("fork", () => {
  const base = { sessionId: "s1", cwd: "/tmp", prompt: "hi", settings: {}, resume: true };

  it("names the branch after the original by default", () => {
    expect(forkName("Release Notes")).toBe("Release Notes-fork");
  });

  it("uses a given name when there is one", () => {
    expect(forkName("Release Notes", "experiment")).toBe("experiment");
  });

  it("ignores a blank name", () => {
    expect(forkName("Release Notes", "   ")).toBe("Release Notes-fork");
  });

  it("never forks when creating a session, where there is nothing to fork from", () => {
    expect(buildOptions({ ...base, resume: false, fork: true }).forkSession).toBeUndefined();
  });
});

describe("stopping drains the queue", () => {
  it("skips what has not started and leaves the running turn to its own stop", async () => {
    const queue = new TurnQueue();
    const order: string[] = [];
    const first = queue.enqueue("s1", async () => {
      await wait(30);
      order.push("first");
    });
    const second = queue.enqueue("s1", async () => void order.push("second"));
    const third = queue.enqueue("s1", async () => void order.push("third"));

    // The first message starts on the next tick, which is the earliest a stop can reach a turn.
    await wait(1);
    expect(queue.drain("s1")).toBe(2);
    expect(await Promise.all([first, second, third])).toEqual([true, false, false]);
    expect(order).toEqual(["first"]);
  });

  it("drains nothing from a conversation with nothing queued", () => {
    expect(new TurnQueue().drain("s1")).toBe(0);
  });

  it("empties the lane after a drain so the next message runs at once", async () => {
    const queue = new TurnQueue();
    const first = queue.enqueue("s1", () => wait(10));
    const second = queue.enqueue("s1", () => wait(10));
    queue.drain("s1");
    await Promise.all([first, second]);
    expect(queue.admit("s1").kind).toBe("run-now");
  });

  it("tells the stopper how many messages went with the turn", () => {
    expect(describeStop(say, { stopped: true, dropped: 0 })).toMatch(/^Stopped\./);
    expect(describeStop(say, { stopped: true, dropped: 0 })).not.toContain("dropped");
    expect(describeStop(say, { stopped: true, dropped: 1 })).toContain("The message queued behind it was dropped");
    expect(describeStop(say, { stopped: true, dropped: 3 })).toContain("3 messages queued behind it were dropped");
    expect(describeStop(say, { stopped: false, dropped: 0 })).toBe("Nothing is running here.");
  });

  // Plain /stop ends only the turn in flight; dropping the queue takes /stop all:true, and the refusal says which is which.
  it("points the full-queue refusal at what each stop really does", async () => {
    const queue = new TurnQueue();
    const running = Array.from({ length: MAX_QUEUE_DEPTH }, () => queue.enqueue("s1", () => wait(5)));
    const outcome = queue.admit("s1");
    expect(outcome.kind === "full" && describeFull(say)).toContain("`/stop all:true` to drop the queue");
    expect(outcome.kind === "full" && describeFull(say)).toContain("`/stop` to end the one in flight");
    await Promise.all(running);
  });

  it("describes the lane for /queue", () => {
    expect(describeDepth(say, 0)).toBe("Nothing is running here.");
    expect(describeDepth(say, 1)).toContain("nothing queued");
    expect(describeDepth(say, 2)).toContain("1 message queued");
    expect(describeDepth(say, 4)).toContain("3 messages queued");
  });
});

describe("skills across several menus", () => {
  const names = (count: number) => Array.from({ length: count }, (_, index) => `skill-${String(index).padStart(3, "0")}`);

  it("splits sixty-three skills across three sorted menus and leaves none out", () => {
    const menus = skillSelectMenus(say, ["zeta", ...names(62)]);
    expect(menus.pages.map((page) => page.length)).toEqual([25, 25, 13]);
    expect(menus.pages[0]![0]!.label).toBe("skill-000");
    expect(menus.pages[2]!.at(-1)!.label).toBe("zeta");
    expect(menus.omitted).toBe(0);
  });

  it("stops at the five menus a message can hold and counts the rest", () => {
    const menus = skillSelectMenus(say, names(130));
    expect(menus.pages).toHaveLength(MENUS_PER_MESSAGE);
    expect(menus.omitted).toBe(5);
  });

  it("labels each menu by the range it covers", () => {
    const menus = skillSelectMenus(say, names(30));
    expect(menuPlaceholder(say, menus.pages[0]!)).toBe("skill-000 to skill-024");
    expect(menuPlaceholder(say, menus.pages[1]!)).toBe("skill-025 to skill-029");
    expect(menuPlaceholder(say, [{ label: "only", value: "only", description: "" }])).toBe("only");
  });

  it("tells the reader how many there are, and how to reach the ones that did not fit", () => {
    expect(describeSkillMenus(say, 63, skillSelectMenus(say, names(63)))).toBe(
      "63 skills available in this conversation, A to Z across 3 menus.",
    );
    expect(describeSkillMenus(say, 130, skillSelectMenus(say, names(130)))).toContain("The last 5 did not fit; send `/name`");
    expect(describeSkillMenus(say, 1, skillSelectMenus(say, ["one"]))).toBe("1 skill available in this conversation.");
  });

  it("reads a chosen skill from any page's menu", () => {
    expect(parseCustomId(skillSelectId(2), "superpowers:brainstorming")).toEqual({
      kind: "skill-chosen",
      skill: "superpowers:brainstorming",
    });
  });
});

describe("unbind offers to delete the channel", () => {
  it("round-trips both answers", () => {
    expect(parseCustomId(UNBIND_DELETE)).toEqual({ kind: "unbind-delete" });
    expect(parseCustomId(UNBIND_KEEP)).toEqual({ kind: "unbind-keep" });
  });
});

describe("clear asks before starting over", () => {
  it("round-trips both answers", () => {
    expect(parseCustomId(clearConfirmId("s1"))).toEqual({ kind: "clear-confirm", sessionId: "s1" });
    expect(parseCustomId(CLEAR_CANCEL)).toEqual({ kind: "clear-cancel" });
  });

  it("names what is kept and what is lost, and how to get the old one back", () => {
    const text = describeClear(say, "/srv/work/ledger");
    expect(text).toContain("none of what was said in this one");
    expect(text).toContain("/resume");
    expect(text).toContain("/purge");
  });
});

describe("the versions under /whoami", () => {
  it("names a newer bridge beside the running one, and only once one has been tagged", () => {
    const versions = { bundled: "2.1.9", host: "2.1.9" };
    expect(versionsFooter(say, "1.2.3 (abc1234)", versions, null)).toBe("bridge v1.2.3 (abc1234) · Claude Code 2.1.9");
    expect(versionsFooter(say, "1.2.3", versions, "9.9.9")).toBe("bridge v1.2.3 · v9.9.9 is out · Claude Code 2.1.9");
  });
});
