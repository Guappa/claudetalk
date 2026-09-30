import { describe, it, expect, vi } from "vitest";
import { actionId, askingSink, menuAskingSink, quietSink, type MenuAsk } from "./helpers/sinks.ts";
import { wait } from "./helpers/records.ts";
import os from "node:os";
import path from "node:path";
import { gate } from "../src/claude/runner.ts";
import { ApprovalPrompts, describeRequest } from "../src/discord/approvals.ts";
import { OTHER_VALUE, QUESTION_TIMEOUT_MS, QuestionPrompts, describeQuestions, menusFor } from "../src/discord/questions.ts";
import { parseQuestions, type Question } from "../src/claude/questions.ts";
import { parseCustomId, questionOtherId, questionPickId, questionSkipId, questionSubmitId } from "../src/discord/menus.ts";
import { sayIn } from "../src/i18n/index.ts";

const say = sayIn("en");

describe("ApprovalPrompts", () => {
  const OWNER = "owner-1";

  it("allows the tool once an owner approves", async () => {
    const prompts = new ApprovalPrompts();
    const decision = prompts.ask(
      say,
      "turn-1",
      askingSink((actions) => {
        prompts.decide(say, actionId(actions, "approve"), OWNER, "approve");
      }),
      [OWNER],
      "Bash",
      { command: "ls" },
    );

    expect(await decision).toEqual({ allow: true });
  });

  it("denies, and says so where the model can read it", async () => {
    const prompts = new ApprovalPrompts();
    const decision = await prompts.ask(
      say,
      "turn-1",
      askingSink((actions) => {
        prompts.decide(say, actionId(actions, "deny"), OWNER, "deny");
      }),
      [OWNER],
      "Bash",
      { command: "rm -rf /" },
    );

    expect(decision.allow).toBe(false);
    expect(decision.allow === false && decision.reason).toContain("Denied");
  });

  // A stranger with the button in front of them is still not an owner.
  it("refuses a decision from anyone but an owner", async () => {
    const prompts = new ApprovalPrompts();
    let refusal = "";
    const decision = prompts.ask(
      say,
      "turn-1",
      askingSink((actions) => {
        refusal = prompts.decide(say, actionId(actions, "approve"), "someone-else", "approve");
        prompts.decide(say, actionId(actions, "deny"), OWNER, "deny");
      }),
      [OWNER],
      "Bash",
      { command: "ls" },
    );

    expect(await decision).toEqual({ allow: false, reason: expect.stringContaining("Denied") });
    expect(refusal).toContain("Only an owner");
  });

  // Tools asked about side by side each put a prompt on screen before the first is answered.
  it("covers the prompts already open when the rest of the turn is approved, and asks again once that is withdrawn", async () => {
    const prompts = new ApprovalPrompts();
    const open: string[] = [];
    const sink = askingSink((actions) => void open.push(actionId(actions, "approve-all")));
    const first = prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "ls" });
    const second = prompts.ask(say, "turn-1", sink, [OWNER], "Edit", { file_path: "a.ts" });
    const elsewhere = prompts.ask(say, "turn-2", sink, [OWNER], "Bash", { command: "ls" });
    await vi.waitFor(() => expect(open).toHaveLength(3));

    prompts.decide(say, open[0]!, OWNER, "approve-all");
    expect(await Promise.all([first, second])).toEqual([{ allow: true }, { allow: true }]);
    expect(await prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "pwd" })).toEqual({ allow: true });
    expect(open).toHaveLength(3);

    prompts.revoke("turn-1");
    const again = prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "pwd" });
    await vi.waitFor(() => expect(open).toHaveLength(4));
    prompts.finish("turn-1");
    prompts.finish("turn-2");
    expect((await again).allow).toBe(false);
    expect((await elsewhere).allow).toBe(false);
  });

  it("stops asking for the rest of a turn once approved wholesale", async () => {
    const prompts = new ApprovalPrompts();
    let asks = 0;
    const sink = askingSink((actions) => {
      asks += 1;
      prompts.decide(say, actionId(actions, "approve-all"), OWNER, "approve-all");
    });

    expect(await prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "ls" })).toEqual({ allow: true });
    expect(await prompts.ask(say, "turn-1", sink, [OWNER], "Edit", { file_path: "a.ts" })).toEqual({ allow: true });
    expect(asks).toBe(1);
  });

  // The standing approval was given for one turn, so the next one starts from nothing.
  it("does not carry a wholesale approval into the next turn", async () => {
    const prompts = new ApprovalPrompts();
    let asks = 0;
    const sink = askingSink((actions) => {
      asks += 1;
      prompts.decide(say, actionId(actions, "approve-all"), OWNER, "approve-all");
    });

    await prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "ls" });
    prompts.finish("turn-1");
    await prompts.ask(say, "turn-2", sink, [OWNER], "Bash", { command: "ls" });
    expect(asks).toBe(2);
  });

  // Nobody at the phone is the usual end of a prompt, and the model is told it was time that refused it, not a person.
  it("denies once the time to answer is up, and says that is why", async () => {
    const closed: string[] = [];
    const sink = { ...quietSink(), ask: async () => ({ close: async (text: string) => void closed.push(text) }) };
    vi.useFakeTimers();
    try {
      const decision = new ApprovalPrompts().ask(say, "turn-1", sink, [OWNER], "Bash", { command: "ls" });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(await decision).toEqual({ allow: false, reason: expect.stringContaining("Nobody answered") });
    } finally {
      vi.useRealTimers();
    }
    expect(closed).toEqual(["No answer in 5 minutes, so it was denied."]);
  });

  // Claude Code runs the tool when the hook throws, so a prompt that cannot be posted has to come back as a refusal.
  it("denies when the prompt cannot be posted, and leaves nothing waiting on it", async () => {
    const prompts = new ApprovalPrompts();
    const sink = { ...quietSink(), ask: async () => Promise.reject(new Error("Missing Permissions")) };
    const decision = await prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "rm -rf /" });
    expect(decision).toEqual({ allow: false, reason: expect.stringContaining("could not be shown") });
  });

  // What the hook answers is what Claude Code acts on: allowed, allowed with the answers written in, refused with a reason, or nothing at all.
  it("answers Claude Code with the decision made in Discord, and with none for a tool that is only reading", async () => {
    const asked: string[] = [];
    const hooks = gate({
      approve: async (toolName) => {
        asked.push(toolName);
        return toolName === "Bash" ? { allow: true } : { allow: false, reason: "Denied from Discord." };
      },
      askQuestions: async () => ({ answered: true, answers: { "Which?": "One" } }),
    });
    const hook = hooks.PreToolUse![0]!.hooks[0]!;
    const decide = (tool_name: string, tool_input: Record<string, unknown> = {}) =>
      hook({ tool_name, tool_input } as never, undefined, { signal: new AbortController().signal });

    expect(await decide("Read", { file_path: "a.ts" })).toEqual({ continue: true });
    expect(asked).toEqual([]);
    expect(await decide("Bash", { command: "ls" })).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(await decide("Edit", { file_path: "a.ts" })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "Denied from Discord." },
    });
    const questions = {
      questions: [{ question: "Which?", header: "Pick", multiSelect: false, options: [{ label: "One", description: "" }] }],
    };
    expect(await decide("AskUserQuestion", questions)).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow", updatedInput: { ...questions, answers: { "Which?": "One" } } },
    });
  });

  it("refuses a tool when the gate itself fails, whatever failed inside it", async () => {
    const hooks = gate({
      approve: async () => {
        throw new Error("boom");
      },
    });
    const hook = hooks.PreToolUse![0]!.hooks[0]!;
    const output = await hook({ tool_name: "Bash", tool_input: { command: "ls" } } as never, undefined, {
      signal: new AbortController().signal,
    });
    expect(output).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });

    const asking = gate({
      askQuestions: async () => {
        throw new Error("boom");
      },
    });
    const answer = await asking.PreToolUse![0]!.hooks[0]!({ tool_name: "AskUserQuestion", tool_input: {} } as never, undefined, {
      signal: new AbortController().signal,
    });
    expect(answer).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  // Nobody denied it, so it must not read as denied.
  it("closes a prompt its turn outlived as ended, not as denied", async () => {
    const prompts = new ApprovalPrompts();
    const closed: string[] = [];
    const sink = { ...quietSink(), ask: async () => ({ close: async (outcome: string) => void closed.push(outcome) }) };
    const asking = prompts.ask(say, "turn-1", sink, [OWNER], "Bash", { command: "ls" });
    await wait(5);
    prompts.finish("turn-1");
    expect(await asking).toEqual({ allow: false, reason: expect.stringContaining("turn ended") });
    expect(closed).toEqual(["The turn ended before this was answered."]);
  });

  it("denies when the conversation has no way to show buttons", async () => {
    const prompts = new ApprovalPrompts();
    const decision = await prompts.ask(say, "turn-1", quietSink(), [OWNER], "Bash", { command: "ls" });
    expect(decision.allow).toBe(false);
  });

  it("names the tool and shows what it would run", () => {
    const text = describeRequest(say, "Bash", { command: "git push --force" });
    expect(text).toContain("Bash");
    expect(text).toContain("git push --force");
  });
});

describe("QuestionPrompts", () => {
  const library: Question = {
    question: "Which library should we use for dates?",
    header: "Library",
    multiSelect: false,
    options: [
      { label: "date-fns", description: "Functions over plain dates" },
      { label: "Day.js", description: "Small and chainable" },
    ],
  };
  const features: Question = {
    question: "Which features do you want?",
    header: "Features",
    multiSelect: true,
    options: [
      { label: "Caching", description: "Keep results around" },
      { label: "Retries", description: "Try again on failure" },
      { label: "Metrics", description: "Count what happens" },
    ],
  };
  const askIdOf = (ask: MenuAsk) => actionId(ask.actions, "question:submit");

  it("turns picks into an answer per question, keyed by the question text", async () => {
    const prompts = new QuestionPrompts();
    let shown: MenuAsk | undefined;
    const outcome = await prompts.ask(
      say,
      "turn-1",
      menuAskingSink((ask) => {
        shown = ask;
        const askId = askIdOf(ask);
        prompts.pick(say, askId, 0, ["1"]);
        prompts.pick(say, askId, 1, ["0", "1"]);
        expect(prompts.submit(say, askId)).toBeUndefined();
      }),
      [library, features],
    );

    expect(outcome).toEqual({
      answered: true,
      answers: { [library.question]: "Day.js", [features.question]: "Caching, Retries" },
    });
    expect(shown?.closed).toEqual(["Answered: Library = Day.js. Features = Caching, Retries."]);
  });

  it("takes an answer in the asker's own words alongside the picks", async () => {
    const prompts = new QuestionPrompts();
    const outcome = await prompts.ask(
      say,
      "turn-1",
      menuAskingSink((ask) => {
        const askId = askIdOf(ask);
        prompts.pick(say, askId, 0, ["0", OTHER_VALUE]);
        prompts.answerFreeText(say, askId, 0, "  Retries with jitter ");
        prompts.submit(say, askId);
      }),
      [features],
    );

    expect(outcome.answered && outcome.answers[features.question]).toBe("Caching, Retries with jitter");
  });

  it("refuses to send while a question has nothing picked", async () => {
    const prompts = new QuestionPrompts();
    let complaint: string | undefined;
    const outcome = await prompts.ask(
      say,
      "turn-1",
      menuAskingSink((ask) => {
        const askId = askIdOf(ask);
        prompts.pick(say, askId, 0, ["0"]);
        complaint = prompts.submit(say, askId);
        prompts.pick(say, askId, 1, ["2"]);
        prompts.submit(say, askId);
      }),
      [library, features],
    );

    expect(complaint).toContain("Question 2");
    expect(outcome.answered).toBe(true);
  });

  it("lets the model continue without answers when skipped, and says so", async () => {
    const prompts = new QuestionPrompts();
    let shown: MenuAsk | undefined;
    const outcome = await prompts.ask(
      say,
      "turn-1",
      menuAskingSink((ask) => {
        shown = ask;
        prompts.skip(say, actionId(ask.actions, "question:skip"));
      }),
      [library],
    );

    expect(outcome.answered).toBe(false);
    expect(outcome.answered === false && outcome.reason).toContain("skipped");
    expect(shown?.closed[0]).toContain("Skipped");
  });

  it("settles what a turn asked when that turn ends", async () => {
    const prompts = new QuestionPrompts();
    const outcome = prompts.ask(
      say,
      "turn-1",
      menuAskingSink(() => prompts.finish("turn-1")),
      [library],
    );
    expect(await outcome).toEqual({ answered: false, reason: expect.stringContaining("turn ended") });
  });

  it("tells a late press that the questions are gone", async () => {
    const prompts = new QuestionPrompts();
    let askId = "";
    await prompts.ask(
      say,
      "turn-1",
      menuAskingSink((ask) => {
        askId = askIdOf(ask);
        prompts.skip(say, askId);
      }),
      [library],
    );

    expect(prompts.submit(say, askId)).toContain("already answered");
    expect(prompts.pick(say, askId, 0, ["0"])).toContain("already answered");
  });

  it("continues without an answer when the questions cannot be posted", async () => {
    const prompts = new QuestionPrompts();
    const sink = { ...quietSink(), askWithMenus: async () => Promise.reject(new Error("Unknown Channel")) };
    const outcome = await prompts.ask(say, "turn-1", sink, [library]);
    expect(outcome).toEqual({ answered: false, reason: expect.stringContaining("could not be shown") });
  });

  it("continues without an answer when the conversation cannot show menus", async () => {
    const outcome = await new QuestionPrompts().ask(say, "turn-1", quietSink(), [library]);
    expect(outcome.answered).toBe(false);
  });

  it("draws one menu per question with an entry for an answer of one's own", () => {
    const menus = menusFor(say, "ask-1", [library, features]);
    expect(menus.map((menu) => menu.id)).toEqual([questionPickId("ask-1", 0), questionPickId("ask-1", 1)]);
    expect(menus[0]?.multiple).toBe(false);
    expect(menus[1]?.multiple).toBe(true);
    expect(menus[0]?.options.map((option) => option.value)).toEqual(["0", "1", OTHER_VALUE]);
    expect(menus[1]?.options.at(-1)?.label).toBe("Other...");
  });

  it("numbers the questions and shows a preview as a block", () => {
    const withPreview: Question = {
      ...library,
      options: [{ label: "Day.js", description: "Small", preview: "dayjs().format()" }],
    };
    const text = describeQuestions(say, [withPreview, features]);
    expect(text).toContain("Claude has 2 questions.");
    expect(text).toContain("**1. Library**");
    expect(text).toContain("**2. Features**");
    expect(text).toContain("Pick any that apply.");
    expect(text).toContain("```\ndayjs().format()\n```");
  });

  it("types the tool input without trusting any field to be present", () => {
    const parsed = parseQuestions({
      questions: [{ question: "Red or blue?", header: "Colour", options: [{ label: "Red" }], multiSelect: "yes" }],
    });
    expect(parsed).toEqual([
      { question: "Red or blue?", header: "Colour", options: [{ label: "Red", description: "" }], multiSelect: false },
    ]);
    expect(parseQuestions({})).toEqual([]);
  });

  it("round-trips every question control id", () => {
    expect(parseCustomId(questionPickId("ask-1", 2))).toEqual({ kind: "question-pick", askId: "ask-1", index: 2 });
    expect(parseCustomId(questionOtherId("ask-1", 0))).toEqual({ kind: "question-other", askId: "ask-1", index: 0 });
    expect(parseCustomId(questionSubmitId("ask-1"))).toEqual({ kind: "question-submit", askId: "ask-1" });
    expect(parseCustomId(questionSkipId("ask-1"))).toEqual({ kind: "question-skip", askId: "ask-1" });
    expect(parseCustomId("question:pick:ask-1").kind).toBe("unknown");
  });
});

describe("an approval names a file the way the rest of the bridge does", () => {
  it("shows a path under the home folder as ~/ with forward slashes", () => {
    const text = describeRequest(say, "Write", { file_path: path.join(os.homedir(), "Documents", "notes.txt") });
    expect(text).toContain("~/Documents/notes.txt");
    expect(text).not.toContain("\\");
  });

  it("still hides the home folder inside a command", () => {
    const text = describeRequest(say, "Bash", { command: `cat ${path.join(os.homedir(), "x.txt")}` });
    expect(text).not.toContain(path.basename(os.homedir()));
  });
});

describe("an approval belongs to the turn that asked", () => {
  const OWNER = "owner-1";

  it("ending one conversation's turn leaves another conversation's prompt waiting", async () => {
    const prompts = new ApprovalPrompts();
    let otherId = "";
    const remember = askingSink((actions) => {
      otherId = actionId(actions, "approve");
    });
    const other = prompts.ask(say, "turn-b", remember, [OWNER], "Bash", { command: "ls" });
    await new Promise((resolve) => setTimeout(resolve, 5));

    prompts.finish("turn-a");
    expect(prompts.decide(say, otherId, OWNER, "approve")).toBe("Approved once.");
    expect(await other).toEqual({ allow: true });
  });

  it("still denies its own turn's pending prompt when that turn ends", async () => {
    const prompts = new ApprovalPrompts();
    const own = prompts.ask(
      say,
      "turn-a",
      askingSink(() => undefined),
      [OWNER],
      "Bash",
      { command: "ls" },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    prompts.finish("turn-a");
    expect((await own).allow).toBe(false);
  });
});

describe("the gate's own clock", () => {
  // Claude Code stops waiting for a hook after ten minutes unless told otherwise, which is as long as a question waits.
  it("gives a hook longer than the bridge waits for an answer, so the bridge's reason is the one that arrives", () => {
    const hooks = gate({ approve: async () => ({ allow: true }) });
    expect(hooks.PreToolUse![0]!.timeout! * 1000).toBeGreaterThan(QUESTION_TIMEOUT_MS + 60_000);
  });
});
