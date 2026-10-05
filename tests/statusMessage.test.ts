import { describe, it, expect, vi } from "vitest";
import { quietSink, recordingSink } from "./helpers/sinks.ts";
import os from "node:os";
import path from "node:path";
import { agentEvent, parentToolUseId, type ClaudeEvent } from "../src/claude/events.ts";
import { AgentBoard, agentsTitle } from "../src/discord/agentBoard.ts";
import type { MessageSink } from "../src/discord/messageSink.ts";
import { StatusMessage, formatElapsed, renderActivity, tickIntervalMs } from "../src/discord/statusMessage.ts";
import { describeSendNow, describeStopAgents } from "../src/discord/turnFlow.ts";
import { sendNowActionId, stopAgentsActionId } from "../src/discord/menus.ts";
import { parseCustomId } from "../src/discord/menus.ts";
import { sayIn } from "../src/i18n/index.ts";

const say = sayIn("en");

describe("StatusMessage", () => {
  it("shows the turn as working before anything has happened", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.stop();
    expect(sink.written.at(-1)).toBe("⏳ **Working** 0s");
  });

  it("replaces the activity log with the answer when the turn ends", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("Looking at the schema first.");
    await status.finish("Done.");
    expect(sink.written.at(-1)).toBe("Done.");
  });

  it("does not keep the answer in the trail it is about to be posted under", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("Weighing whether the field is optional.");
    status.note("It is optional, so the validator warns rather than fails.");
    status.dropEcho("It is optional, so the validator warns rather than fails.");
    await status.settle();

    expect(sink.messages.at(-1)).toContain("Weighing whether the field is optional.");
    expect(sink.messages.at(-1)).not.toContain("validator warns");
  });

  it("leaves no trail at all when the only thing said was the answer", () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    status.note("The tree is clean, nothing to back out.");
    status.dropEcho("The tree is clean, nothing to back out.");
    expect(status.hasNotes()).toBe(false);
  });

  it("matches a remark that was cut short against the full answer", () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    const long = "a".repeat(2500);
    status.note(long);
    status.dropEcho(long);
    expect(status.hasNotes()).toBe(false);
  });

  it("takes the answer back however many times it was said as a remark", () => {
    const status = new StatusMessage(say, recordingSink(), () => 0);
    const answer = `Summary of the change.\n\n${"z".repeat(2400)}`;
    status.note("Checking the diff first.");
    status.note(answer);
    status.note(answer);
    status.dropEcho(answer);
    expect(status.currentIsEmpty()).toBe(false);
    status.dropEcho("Checking the diff first.");
    expect(status.hasNotes()).toBe(false);
  });

  it("keeps a remark the answer does not repeat", () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    status.note("Checking the schema first.");
    status.dropEcho("Something else entirely.");
    expect(status.hasNotes()).toBe(true);
  });

  it("ignores an empty thought rather than logging a blank line", () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    status.note("   ");
    status.note("");
    expect(status.hasNotes()).toBe(false);
  });

  // The terminal scrolls; a trail that no longer fits carries on below instead of eliding what came first.
  it("continues in a new message once the trail would not fit, keeping every remark in order", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(
      say,
      sink,
      () => 0,
      () => [{ id: "stop", label: "Stop" }],
    );
    await status.start();
    const remarks = Array.from({ length: 12 }, (_, index) => `Remark ${index + 1}: ${"x".repeat(240)}`);
    for (const remark of remarks) status.note(remark);
    await status.settle();

    expect(sink.messages.length).toBeGreaterThan(1);
    const joined = sink.messages.join("\n");
    for (const remark of remarks) expect(joined).toContain(remark);
    expect(joined).not.toContain("...");
    for (const message of sink.messages) expect(message.length).toBeLessThan(2000);
    expect(sink.messages.map((message) => message.indexOf("Remark 12")).filter((at) => at >= 0)).toHaveLength(1);
    expect(sink.messages.at(-1)).toContain("**Worked**");
  });

  it("moves the trail below anything lasting posted beneath it, rather than writing above it", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("Before the question.");
    sink.othersBelow = true;
    status.note("After the question.");
    await status.settle();

    expect(sink.messages[0]).toBe("Before the question.");
    expect(sink.messages[1]).toContain("After the question.");
    expect(sink.messages[1]).not.toContain("Before the question.");
    expect(status.hasNotes()).toBe(true);
  });

  // Several remarks can land in one stream chunk before the queued move has run; they belong to the same new message.
  it("moves once for a burst of remarks arriving while the trail is still buried", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("Before.");
    sink.othersBelow = true;
    status.note("After one.");
    status.note("After two.");
    status.note("After three.");
    await status.settle();

    expect(sink.messages).toHaveLength(2);
    expect(sink.messages[1]).toContain("After one.");
    expect(sink.messages[1]).toContain("After three.");
  });

  it("leaves a plain marker, not a live heading, when it moves before any remark was made", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    sink.othersBelow = true;
    status.note("First remark, after an approval prompt.");
    await status.settle();

    expect(sink.messages[0]).toBe("**Started**");
    expect(sink.messages[0]).not.toContain("Working");
  });

  // Links are resolved once per message, when it is final, never on the two-second edits.
  it("finalizes a sealed segment and the settled trail, and nothing in between", async () => {
    const sink = recordingSink();
    const finalize = vi.fn(async (text: string) => text.replace("e2ea070", "[e2ea070](<url>)"));
    const status = new StatusMessage(
      say,
      sink,
      () => 0,
      () => [],
      undefined,
      finalize,
    );
    await status.start();
    status.note("Landed e2ea070.");
    sink.othersBelow = true;
    status.note("Then more.");
    await status.settle();

    expect(finalize).toHaveBeenCalledTimes(2);
    expect(sink.messages[0]).toBe("Landed [e2ea070](<url>).");
    expect(sink.messages[1]).toContain("**Worked**");
  });

  // A long remark is read while the turn runs, not after it: its head is sealed the moment it overflows, and one that turns out to be the answer is then already shown, so it is not posted beneath again.
  it("seals the head of a long last remark as soon as it overflows, and reports an answer that repeats it as shown", async () => {
    const sink = recordingSink();
    const answer = Array.from({ length: 40 }, (_, index) => `Point ${index + 1}: ${"y".repeat(90)}`).join("\n");
    vi.useFakeTimers();
    try {
      const status = new StatusMessage(say, sink);
      await status.start();
      status.note("Reading the three reports first.");
      status.note(answer);
      await vi.advanceTimersByTimeAsync(2500);

      expect(sink.messages.length).toBeGreaterThan(1);
      expect(sink.messages[0]).toContain("Point 1:");
      expect(sink.messages.at(-1)).toContain("**Working**");
      expect(sink.messages.join("\n")).not.toContain("...");

      expect(status.dropEcho(answer)).toBe("shown");
      await status.settle();
    } finally {
      vi.useRealTimers();
    }

    const trail = sink.messages.join("\n");
    expect(trail).toContain("Reading the three reports first.");
    for (let point = 1; point <= 40; point += 1) expect(trail).toContain(`Point ${point}:`);
    expect(trail.match(/Point 40:/g)).toHaveLength(1);
    for (const message of sink.messages) expect(message.length).toBeLessThan(2000);
  });

  // The answer repeats an earlier remark the trail already sealed in part, and says more: what is new in it has to reach the channel somewhere.
  it("posts an answer that repeats a sealed remark and adds to it, rather than taking it for shown", async () => {
    const sink = recordingSink();
    const earlier = Array.from({ length: 40 }, (_, index) => `Point ${index + 1}: ${"y".repeat(90)}`).join("\n");
    const answer = `${earlier}\n\nAnd here is the new conclusion nobody has seen yet.`;
    vi.useFakeTimers();
    try {
      const status = new StatusMessage(say, sink);
      await status.start();
      status.note(earlier);
      await vi.advanceTimersByTimeAsync(2500);
      status.note(answer);
      expect(status.dropEcho(answer)).toBe("dropped");
      await status.settle();
    } finally {
      vi.useRealTimers();
    }
  });

  // Escaping lengthens a remark, and a piece Discord refuses is never shown at all.
  it("cuts a remark full of markers into pieces that each fit once escaped", async () => {
    const sink = recordingSink();
    vi.useFakeTimers();
    try {
      const status = new StatusMessage(say, sink);
      await status.start();
      status.note("[ ".repeat(900));
      await vi.advanceTimersByTimeAsync(2500);
      await status.settle();
    } finally {
      vi.useRealTimers();
    }
    for (const text of sink.written) expect(text.length).toBeLessThanOrEqual(2000);
    expect(sink.messages.join("").split("\\[").length - 1).toBe(900);
  });

  // An answer still wholly in the live message is dropped from it as before, and one the trail never held is nothing to it.
  it("tells an answer dropped from the live message from one the trail never held", () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    status.note("Checking the diff first.");
    expect(status.dropEcho("Something else entirely.")).toBe("none");
    expect(status.dropEcho("Checking the diff first.")).toBe("dropped");
    expect(status.hasNotes()).toBe(false);
  });

  // The agents' tally rides under the heading and can leave a full-length piece no room; the piece then gets a message of its own rather than a cut.
  it("seals a lone piece that does not fit beside a long heading, rather than cutting it", async () => {
    const sink = recordingSink();
    const tally = `**Agents** · ${"reviewer running, ".repeat(20)}`;
    vi.useFakeTimers();
    try {
      const status = new StatusMessage(
        say,
        sink,
        undefined,
        () => [],
        undefined,
        undefined,
        () => tally,
      );
      await status.start();
      const piece = `Report: ${"z".repeat(1650)}`;
      status.note(piece);
      await vi.advanceTimersByTimeAsync(2500);
      await status.settle();
    } finally {
      vi.useRealTimers();
    }
    expect(sink.messages[0]).toBe(`Report: ${"z".repeat(1650)}`);
    expect(sink.messages.at(-1)).toContain("**Worked**");
    expect(sink.messages.join("\n")).not.toContain("...");
    for (const message of sink.messages) expect(message.length).toBeLessThan(2000);
  });

  // A link is several times the length of the reference it replaces, and the trail is measured before it is linked.
  it("settles with its references unlinked when linking them would take it past what a message holds", async () => {
    const sink = recordingSink();
    const edit = sink.edit;
    sink.edit = async (text, actions) => {
      if (text.length > 2000) throw new Error("Invalid Form Body: content must be 2000 or fewer in length");
      await edit(text, actions);
    };
    const linked = async (text: string): Promise<string> =>
      text.replaceAll("notes.md", `[notes.md](<https://example.com/${"p".repeat(110)}>)`);
    const status = new StatusMessage(
      say,
      sink,
      () => 0,
      () => [],
      undefined,
      linked,
    );
    await status.start();
    for (let remark = 1; remark <= 8; remark += 1) status.note(`Step ${remark}: read notes.md. ${"w".repeat(140)}`);
    await status.settle("done");

    const trail = sink.messages.at(-1)!;
    expect(trail).toContain("**Worked**");
    expect(trail).toContain("Step 8: read notes.md.");
    expect(trail).not.toContain("https://example.com");

    const brief = recordingSink();
    const short = new StatusMessage(
      say,
      brief,
      () => 0,
      () => [],
      undefined,
      linked,
    );
    await short.start();
    short.note("Read notes.md.");
    await short.settle("done");
    expect(brief.messages.at(-1)).toContain("https://example.com");
  });

  it("tells the turn each time the trail moves, so the interruption record can follow", async () => {
    const sink = recordingSink();
    const moved = vi.fn(async () => undefined);
    const status = new StatusMessage(
      say,
      sink,
      () => 0,
      () => [],
      moved,
    );
    await status.start();
    status.note("First.");
    sink.othersBelow = true;
    status.note("Second.");
    await status.settle();
    expect(moved).toHaveBeenCalledTimes(1);
  });
});

describe("renderActivity", () => {
  it("shows what Claude said, newest last, as paragraphs", () => {
    const rendered = renderActivity(say, ["Checking the schema first.", "It is a rounding bug."], 5000);
    const expected = ["⏳ **Working** 5s", "", "Checking the schema first.", "", "It is a rounding bug."];
    expect(rendered.split("\n")).toEqual(expected);
  });

  it("says only that it is working when nothing has been said yet", () => {
    expect(renderActivity(say, [], 12_000)).toBe("⏳ **Working** 12s");
  });

  it("counts the steps taken, so a quiet turn still shows it is getting somewhere", () => {
    expect(renderActivity(say, [], 272_000, 7)).toBe("⏳ **Working** 4m 32s · 7 steps");
    expect(renderActivity(say, [], 5000, 1)).toBe("⏳ **Working** 5s · 1 step");
  });

  it("leaves the count off before anything has been done", () => {
    expect(renderActivity(say, [], 5000, 0)).toBe("⏳ **Working** 5s");
  });

  it("shows the newest notes and elides the rest", () => {
    const notes = Array.from({ length: 40 }, (_, index) => `Note ${index}`);
    const paragraphs = renderActivity(say, notes, 0).split("\n\n");
    expect(paragraphs[1]).toBe("...");
    expect(paragraphs.at(-1)).toBe("Note 39");
  });

  it("stays inside a Discord message however much was said", () => {
    const notes = Array.from({ length: 40 }, (_, index) => `${index} `.repeat(120));
    expect(renderActivity(say, notes, 600_000).length).toBeLessThan(2000);
  });

  it("keeps a long remark whole while the budget has room for it", () => {
    const long = "word ".repeat(150).trim();
    const rendered = renderActivity(say, [long], 1000);
    expect(rendered).toContain(long);
    expect(rendered).not.toContain("...");
  });

  it("drops an older remark rather than cutting it in half", () => {
    const big = "a".repeat(1000);
    const rendered = renderActivity(say, [big, big], 1000);
    const paragraphs = rendered.split("\n\n");
    expect(paragraphs[1]).toBe("...");
    expect(paragraphs[2]).toBe(big);
  });

  it("cuts only when one remark alone is larger than the whole budget", () => {
    const huge = "b".repeat(4000);
    const rendered = renderActivity(say, [huge], 1000);
    expect(rendered.length).toBeLessThan(2000);
    expect(rendered.endsWith("...")).toBe(true);
  });

  it("does not cut commentary off after a few words", () => {
    const sentence =
      "Prices are identical to last week, but something else moved: 25 articles now have a " +
      "takeawayPrice that differs from price, where last week only three did.";
    expect(renderActivity(say, [sentence], 1000)).toContain("where last week only three did.");
  });

  it("counts elapsed time in minutes past a minute", () => {
    expect(formatElapsed(say, 72_000)).toBe("1m 12s");
    expect(formatElapsed(say, 9_000)).toBe("9s");
  });

  it("slows its edits as a turn drags on", () => {
    expect(tickIntervalMs(0)).toBe(2000);
    expect(tickIntervalMs(90_000)).toBe(5000);
    expect(tickIntervalMs(600_000)).toBe(15_000);
  });
});

describe("agents in a turn", () => {
  const started = (taskId: string, toolUseId: string, description: string, agentType = "general-purpose"): ClaudeEvent =>
    ({
      type: "system",
      subtype: "task_started",
      task_id: taskId,
      tool_use_id: toolUseId,
      description,
      subagent_type: agentType,
      task_type: "local_agent",
    }) as ClaudeEvent;
  const progressed = (taskId: string, description: string, toolUses: number, totalTokens = 33_100): ClaudeEvent =>
    ({
      type: "system",
      subtype: "task_progress",
      task_id: taskId,
      description,
      usage: { total_tokens: totalTokens, tool_uses: toolUses, duration_ms: 1800 },
    }) as ClaudeEvent;
  const notified = (taskId: string, status: string, toolUses = 2): ClaudeEvent =>
    ({
      type: "system",
      subtype: "task_notification",
      task_id: taskId,
      status,
      summary: "Nothing wrong.",
      usage: { total_tokens: 38_100, tool_uses: toolUses, duration_ms: 4200 },
    }) as ClaudeEvent;

  it("reads an agent's start, progress and end off the stream, and leaves a background command out", () => {
    expect(agentEvent(started("t1", "use1", "Audit the access checks", "Explore"))).toEqual({
      kind: "started",
      taskId: "t1",
      toolUseId: "use1",
      description: "Audit the access checks",
      agentType: "Explore",
      remote: false,
    });
    const cloud = {
      type: "system",
      subtype: "task_started",
      task_id: "t8",
      description: "ultrareview: feat/ledger",
      task_type: "remote_agent",
    } as ClaudeEvent;
    expect(agentEvent(cloud)).toEqual({
      kind: "started",
      taskId: "t8",
      toolUseId: null,
      description: "ultrareview: feat/ledger",
      agentType: "cloud",
      remote: true,
    });
    expect(agentEvent(progressed("t1", "Reading access.ts", 3))).toEqual({
      kind: "progress",
      taskId: "t1",
      activity: "Reading access.ts",
      toolUses: 3,
      tokens: 33_100,
    });
    expect(agentEvent(notified("t1", "completed"))).toEqual({
      kind: "ended",
      taskId: "t1",
      outcome: "completed",
      toolUses: 2,
      tokens: 38_100,
      durationMs: 4200,
    });
    const shell = {
      type: "system",
      subtype: "task_started",
      task_id: "t9",
      description: "sleep",
      task_type: "local_bash",
    } as ClaudeEvent;
    expect(agentEvent(shell)).toBeNull();
    expect(parentToolUseId({ type: "assistant", message: { content: [] }, parent_tool_use_id: "use1" })).toBe("use1");
    expect(parentToolUseId({ type: "assistant", message: { content: [] } })).toBeNull();
  });

  const board = (sink: MessageSink, clock = { at: 0 }) => new AgentBoard(say, sink, "Agents: tidy the ledger", () => clock.at, 0);
  const feed = (target: AgentBoard, ...events: ClaudeEvent[]) => {
    for (const event of events) target.observe(agentEvent(event)!);
  };

  it("tallies the agents in the trail where there is no side room: the running by name, the finished as a count", async () => {
    const clock = { at: 0 };
    const agents = board(quietSink(), clock);
    expect(agents.block()).toBe("");

    feed(agents, started("t1", "use1", "Audit the access checks", "Explore"), started("t2", "use2", "Write the fixtures"));
    clock.at = 48_000;
    feed(agents, progressed("t1", "Reading access.ts", 9), progressed("t2", "Write the fixtures", 1, 900));
    await agents.flush();
    expect(agents.block()).toBe(
      "**Agents** · 2 running\n" +
        "- Explore · Audit the access checks · Reading access.ts · 9 tools · 33.1k tokens · 48s\n" +
        "- general-purpose · Write the fixtures · 1 tool · 900 tokens · 48s",
    );

    feed(agents, notified("t1", "completed"), notified("t2", "failed"));
    expect(agents.block()).toBe("**Agents** · 1 done · 1 failed");
  });

  it("names only the first few of a large fan-out and counts the rest", () => {
    const agents = board(quietSink());
    feed(agents, ...Array.from({ length: 7 }, (_, index) => started(`t${index}`, `use${index}`, `Part ${index}`)));
    const lines = agents.block().split("\n");
    expect(lines[0]).toBe("**Agents** · 7 running");
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe("- and 3 more");
    expect(lines[1]).toBe("- general-purpose · Part 0 · 0 tools · 0s");
  });

  // As in the terminal: that an agent is working, on what, and what it has spent. Never its own edits or report.
  it("keeps one roster message in the side room, every agent in it, rewritten as they change", async () => {
    const sink = recordingSink();
    const agents = board(sink);
    feed(agents, started("t1", "use1", "Audit the access checks", "Explore"), started("t2", "use2", "Write the fixtures"));
    // With a side room the trail says nothing about agents, not even in the moment before the room has opened.
    expect(agents.block()).toBe("");
    await agents.flush();
    expect(agents.block()).toBe("");
    expect(sink.detailTitles).toEqual(["Agents: tidy the ledger"]);
    expect(sink.details).toEqual([
      "**1 · Explore** · Audit the access checks\nrunning · 0 tools\n\n" +
        "**2 · general-purpose** · Write the fixtures\nrunning · 0 tools",
    ]);

    feed(agents, progressed("t1", "Reading access.ts", 3), notified("t2", "completed"));
    await agents.flush();
    expect(sink.details).toEqual([
      "**1 · Explore** · Audit the access checks\nReading access.ts · 3 tools · 33.1k tokens\n\n" +
        "**2 · general-purpose** · Write the fixtures\ndone in 4s · 2 tools · 38.1k tokens",
    ]);
    expect(agents.follows("use1")).toBe(true);
    expect(agents.follows("other")).toBe(false);
    expect(agents.follows(null)).toBe(false);
  });

  // Each agent can be on something different, so one agent's task would misname the rest.
  it("names the side room after what was asked of the turn, within what a thread name may hold", () => {
    expect(agentsTitle(say, "Rework the   ledger\nand its tests")).toBe("Agents: Rework the ledger and its tests");
    expect(agentsTitle(say, "/code-review high")).toBe("Agents: /code-review high");
    expect(agentsTitle(say, "   ")).toBe("Agents");
    expect(agentsTitle(say, "y".repeat(300)).length).toBeLessThanOrEqual(100);
  });

  it("starts a second roster message past ten agents, so none outgrows a message", async () => {
    const sink = recordingSink();
    const agents = board(sink);
    feed(agents, ...Array.from({ length: 12 }, (_, index) => started(`t${index}`, `use${index}`, `Part ${index}`)));
    await agents.flush();
    expect(sink.details).toHaveLength(2);
    expect(sink.details[0]!.split("\n\n")).toHaveLength(10);
    expect(sink.details[1]).toContain("**12 · general-purpose** · Part 11");
  });

  // An agent reported done and then sent back to work is running again, under the entry it already has.
  it("puts an agent that is sent back to work under the entry it already has, adding to what it had done", async () => {
    const sink = recordingSink();
    const agents = board(sink);
    feed(
      agents,
      started("t1", "use1", "Create, wait, delete"),
      progressed("t1", "Writing two.txt", 3),
      notified("t1", "completed", 3),
    );
    await agents.flush();
    expect(sink.details[0]).toContain("done in 4s · 3 tools");

    feed(agents, started("t1", "use2", "Create, wait, delete"));
    await agents.flush();
    expect(sink.details[0]).toContain("running · 3 tools");
    expect(agents.follows("use1")).toBe(true);
    expect(agents.follows("use2")).toBe(true);

    feed(agents, progressed("t1", "Running rm two.txt", 2), notified("t1", "completed", 2));
    await agents.flush();
    expect(sink.details).toEqual(["**1 · general-purpose** · Create, wait, delete\ndone in 8s · 5 tools · 38.1k tokens"]);
  });

  // Stopping the turn kills this process, which a task running in the cloud would never notice.
  it("knows what a stop would reach, and which of it runs in the cloud", () => {
    const agents = board(quietSink());
    expect(agents.stopLabel()).toBeNull();
    const cloud = {
      type: "system",
      subtype: "task_started",
      task_id: "t8",
      description: "ultrareview: feat/ledger",
      task_type: "remote_agent",
    } as ClaudeEvent;
    feed(agents, cloud);
    expect(agents.stopLabel()).toBe("Stop cloud task");
    feed(agents, started("t1", "use1", "Audit"), started("t2", "use2", "Write"));
    expect(agents.stopLabel()).toBe("Stop agents");
    expect(agents.running()).toEqual(["t8", "t1", "t2"]);
    expect(agents.runningRemote()).toEqual(["t8"]);
    feed(agents, notified("t1", "completed"), notified("t8", "stopped"));
    expect(agents.running()).toEqual(["t2"]);
    expect(agents.runningRemote()).toEqual([]);
    expect(parseCustomId(stopAgentsActionId("s1"))).toEqual({ kind: "turn-stop-agents", sessionId: "s1" });
    expect(parseCustomId(sendNowActionId("s1"))).toEqual({ kind: "turn-send-now", sessionId: "s1" });
    expect(describeSendNow(say, "nothing-waiting")).toContain("already taken");
    expect(describeSendNow(say, "sent")).toContain("cut short so it could read your message");
    expect(describeStopAgents(say, 0)).toContain("nothing to stop");
    expect(describeStopAgents(say, 2)).toContain("Asked 2 tasks to stop");
  });

  // An agent reported done with a command of its own still running is not done: it stays stoppable, and the roster says it is waiting.
  // A roster page Discord refuses is never written again, so the agents' thread would stand still at the last page that fit.
  it("keeps a full roster page of long-named agents within a message", async () => {
    const sink = recordingSink();
    const agents = board(sink);
    for (let index = 1; index <= 10; index += 1) {
      feed(
        agents,
        started(`t${index}`, `use${index}`, `${"d".repeat(96)} ${index}`, `some-plugin-with-a-long-name:${"x".repeat(40)}`),
      );
      feed(agents, progressed(`t${index}`, `Reading ${"f".repeat(40)}.ts`, 123, 45_700));
    }
    await agents.flush();
    expect(sink.details.length).toBeGreaterThan(0);
    for (const page of sink.details) expect(page.length).toBeLessThanOrEqual(2000);
  });

  it("treats an agent that left a command running as waiting, and reaches that command when stopping", async () => {
    const sink = recordingSink();
    const stopped: string[] = [];
    const agents = new AgentBoard(
      say,
      sink,
      "Agents: tidy the ledger",
      () => 0,
      0,
      (taskId) => void stopped.push(taskId),
    );
    const shell = {
      type: "system",
      subtype: "task_started",
      task_id: "b1",
      tool_use_id: "call1",
      description: "sleep",
      task_type: "local_bash",
      owned_by_subagent: true,
    } as ClaudeEvent;
    expect(agentEvent(shell)).toEqual({ kind: "background", taskId: "b1", toolUseId: "call1" });

    feed(agents, started("t1", "use1", "Build and wait"));
    agents.noteCall("use1", "call1");
    feed(agents, shell, notified("t1", "completed", 3));
    await agents.flush();
    expect(sink.details[0]).toBe(
      "**1 · general-purpose** · Build and wait\nwaiting on a background command · 3 tools · 38.1k tokens",
    );
    expect(agents.stopLabel()).toBe("Stop agents");
    expect(agents.running()).toEqual(["b1"]);

    expect(agents.claim()).toEqual(["b1"]);
    feed(agents, notified("b1", "stopped"));
    await agents.flush();
    expect(sink.details[0]).toContain("stopped after");
    expect(agents.stopLabel()).toBeNull();

    // The session may send a stopped agent back to work; it is stopped again, not left to run.
    feed(agents, started("t1", "use9", "Build and wait"));
    expect(stopped).toEqual(["t1"]);
  });

  it("opens no side room for a turn without agents, and still tallies where there is none to open", async () => {
    const idle = recordingSink();
    await board(idle).flush();
    expect(idle.detailTitles).toEqual([]);

    const agents = board(quietSink());
    feed(agents, started("t1", "use1", "Audit"));
    await agents.flush();
    expect(agents.block()).toBe("**Agents** · 1 running\n- general-purpose · Audit · 0 tools · 0s");
  });

  it("counts an agent still running when the turn ends as stopped, once", async () => {
    const sink = recordingSink();
    const agents = board(sink);
    feed(agents, started("t1", "use1", "Audit"));
    agents.end();
    agents.end();
    await agents.flush();
    expect(sink.details).toEqual(["**1 · general-purpose** · Audit\nstopped after 0s · 0 tools"]);
  });

  it("carries the tally under the trail's heading while it runs and when it is done", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(
      say,
      sink,
      () => 0,
      () => [],
      undefined,
      undefined,
      () => "**Agents** · 1 done",
    );
    await status.start();
    expect(sink.messages[0]).toBe("⏳ **Working** 0s\n\n**Agents** · 1 done");
    status.note("Looking at it.");
    await status.settle();
    expect(sink.messages[0]).toBe("✅ **Worked** 0s\n\n**Agents** · 1 done\n\nLooking at it.");
  });
});

describe("StatusMessage formatting", () => {
  it("keeps a remark's paragraphs and code blocks instead of flattening them", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("First point.\n\n- one\n- two\n\n```diff\n- old\n+ new\n```");
    await status.settle();
    expect(sink.messages[0]).toContain("First point.\n\n- one\n- two\n\n```diff\n- old\n+ new\n```");
  });

  // A report the model writes mid-turn is shown whole, continued across messages, never cut with an ellipsis.
  it("continues a remark longer than a message across messages without cutting it", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    const paragraphs = Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}: ${"y".repeat(150)}`);
    status.note(paragraphs.join("\n\n"));
    await status.settle();
    const joined = sink.messages.join("\n");
    for (const paragraph of paragraphs) expect(joined).toContain(paragraph);
    expect(joined).not.toContain("...");
    for (const message of sink.messages) expect(message.length).toBeLessThan(2000);
  });

  // An answer with tables has to match its own remark, or it shows twice: raw pipes in the trail, boxes beneath.
  it("drops the echoed answer when it names a home path, is long enough to be cut up, or holds a table", async () => {
    const homePath = path.join(os.homedir(), "notes", "plan.md");
    const table = "| Kind | Tokens |\n|---|---|\n| System | 2.5k |\n| Tools | 8k |\n| Files | 5k |";
    const answer = `Context usage\n\n${table}\n\nMemory file: ${homePath}\n\n${"A long paragraph of remark. ".repeat(120)}`;
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("Looking it up.");
    status.note(answer);
    status.dropEcho(answer);
    await status.settle();
    expect(sink.messages.join("\n")).toContain("Looking it up.");
    expect(sink.messages.join("\n")).not.toContain("Context usage");
  });

  it("draws a table in a remark the way it draws one in an answer", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("| Kind | Tokens | Share |\n|---|---|---|\n| System | 2.5k | 1% |");
    await status.settle();
    expect(sink.messages[0]).toContain("```");
    expect(sink.messages[0]).not.toContain("|---|");
  });

  it("still drops the echoed answer when the remark kept its line breaks", () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    status.note("Two findings.\n\n- one\n- two");
    status.dropEcho("Two findings.\n\n- one\n- two");
    expect(status.hasNotes()).toBe(false);
  });

  it("puts the answer under the heading when the current message has no remarks of its own", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.note("Earlier remark.");
    sink.othersBelow = true;
    status.note("Later remark.");
    status.dropEcho("Later remark.");
    expect(status.currentIsEmpty()).toBe(true);
    expect(await status.finishWithHeading("Later remark.")).toBe(true);
    expect(sink.messages.at(-1)).toBe("✅ **Worked** 0s\n\nLater remark.");
    expect(await status.finishWithHeading("z".repeat(2000))).toBe(false);
  });
});

describe("a repeated status reads as one line", () => {
  it("does not grow the trail when the same status arrives again", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.noteOnce("Compacting the conversation, which can take a while.");
    status.noteOnce("Compacting the conversation, which can take a while.");
    status.noteOnce("Compacting the conversation, which can take a while.");
    await status.settle();
    expect(sink.written.at(-1)!.split("Compacting").length - 1).toBe(1);
  });

  it("still records the status again once something else has been said", async () => {
    const sink = recordingSink();
    const status = new StatusMessage(say, sink, () => 0);
    await status.start();
    status.noteOnce("Compacting.");
    status.note("Reading the schema.");
    status.noteOnce("Compacting.");
    await status.settle();
    expect(sink.written.at(-1)!.split("Compacting").length - 1).toBe(2);
  });
});
