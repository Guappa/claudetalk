import { randomUUID } from "node:crypto";
import { QUESTIONS_UNANSWERED } from "../claude/prompts.ts";
import type { Question, QuestionAnswers, QuestionOutcome } from "../claude/questions.ts";
import type { Say } from "../i18n/index.ts";
import { truncate } from "../text.ts";
import { fitForDiscord } from "./outgoing.ts";
import { questionPickId, questionSkipId, questionSubmitId } from "./menus.ts";
import type { Delivery, MessageSink, SinkAction, SinkMenu } from "./messageSink.ts";

// A question deserves more thought than a permission, and a phone is often the thing answering it.
export const QUESTION_TIMEOUT_MS = 10 * 60_000;
const MESSAGE_LIMIT = 1900;
const PREVIEW_LIMIT = 300;

export const OTHER_VALUE = "other";

type Settled = { kind: "answered"; answers: QuestionAnswers } | { kind: "skipped" | "expired" | "ended" };

interface Pick {
  chosen: string[];
  other?: string;
}

interface Pending {
  turnId: string;
  questions: Question[];
  picks: Map<number, Pick>;
  settle: (settled: Settled) => void;
}

function describeQuestion(say: Say, question: Question, index: number): string {
  const asked = { number: index + 1, header: question.header, question: question.question };
  const lines: string[] = [say(question.multiSelect ? "questions.questionPickAny" : "questions.question", asked)];
  for (const option of question.options) {
    if (option.preview) lines.push(`${option.label}:\n\`\`\`\n${truncate(option.preview, PREVIEW_LIMIT)}\n\`\`\``);
  }
  return lines.join("\n");
}

export function describeQuestions(say: Say, questions: Question[]): string {
  const heading = say("questions.heading", { count: questions.length });
  const asked = questions.map((question, index) => describeQuestion(say, question, index));
  return fitForDiscord([heading, ...asked].join("\n"), MESSAGE_LIMIT);
}

// Option values are positions, so a label that repeats or runs long never collides with another.
export function menusFor(say: Say, askId: string, questions: Question[]): SinkMenu[] {
  return questions.map((question, index) => ({
    id: questionPickId(askId, index),
    placeholder: question.header || say("questions.placeholder", { number: index + 1 }),
    multiple: question.multiSelect,
    options: [
      ...question.options.map((option, position) => ({
        value: String(position),
        label: option.label.trim() || say("questions.unnamedOption"),
        description: option.description,
      })),
      { value: OTHER_VALUE, label: say("questions.other"), description: say("questions.otherDescription") },
    ],
  }));
}

function answerFor(question: Question, pick: Pick | undefined): string {
  if (!pick) return "";
  const labels = pick.chosen.map((value) => question.options[Number(value)]?.label ?? "").filter(Boolean);
  if (pick.other) labels.push(pick.other);
  return labels.join(", ");
}

function answersFor(pending: Pending): QuestionAnswers {
  const answers: QuestionAnswers = {};
  pending.questions.forEach((question, index) => {
    answers[question.question] = answerFor(question, pending.picks.get(index));
  });
  return answers;
}

function describeSettled(say: Say, settled: Settled, questions: Question[]): string {
  if (settled.kind === "answered") {
    const summary = questions.map((question) => `${question.header} = ${settled.answers[question.question]}`).join(". ");
    return say("questions.answered", { summary });
  }
  if (settled.kind === "expired") return say("questions.expired", { minutes: QUESTION_TIMEOUT_MS / 60_000 });
  return say(settled.kind === "skipped" ? "questions.skipped" : "questions.ended");
}

function outcomeFor(settled: Settled): QuestionOutcome {
  if (settled.kind === "answered") return { answered: true, answers: settled.answers };
  return { answered: false, reason: QUESTIONS_UNANSWERED[settled.kind] };
}

function actionsFor(say: Say, askId: string): SinkAction[] {
  return [
    { id: questionSubmitId(askId), label: say("questions.submit") },
    { id: questionSkipId(askId), label: say("questions.skip"), tone: "danger" },
  ];
}

// One per turn, like approvals: what a turn asked dies with it.
export class QuestionPrompts {
  private readonly pending = new Map<string, Pending>();

  async ask(say: Say, turnId: string, sink: MessageSink, questions: Question[], delivery?: Delivery): Promise<QuestionOutcome> {
    if (!sink.askWithMenus) return { answered: false, reason: QUESTIONS_UNANSWERED.unaskable };

    const id = randomUUID();
    const { promise: settled, resolve: settle } = Promise.withResolvers<Settled>();
    this.pending.set(id, { turnId, questions, picks: new Map(), settle });

    const timer = setTimeout(() => this.settle(id, { kind: "expired" }), QUESTION_TIMEOUT_MS);
    timer.unref();

    const handle = await sink
      .askWithMenus(describeQuestions(say, questions), menusFor(say, id, questions), actionsFor(say, id), delivery)
      .catch(() => null);
    if (!handle) {
      this.pending.delete(id);
      clearTimeout(timer);
      return { answered: false, reason: QUESTIONS_UNANSWERED.unshown };
    }
    const result = await settled;
    clearTimeout(timer);
    await handle.close(describeSettled(say, result, questions));
    return outcomeFor(result);
  }

  // Values are option positions, or the "other" marker whose text arrives separately.
  pick(say: Say, askId: string, index: number, values: string[]): string | undefined {
    const waiting = this.pending.get(askId);
    if (!waiting) return say("questions.stale");
    const previous = waiting.picks.get(index);
    const chosen = values.filter((value) => value !== OTHER_VALUE);
    waiting.picks.set(index, values.includes(OTHER_VALUE) ? { chosen, other: previous?.other } : { chosen });
    return undefined;
  }

  answerFreeText(say: Say, askId: string, index: number, text: string): string | undefined {
    const waiting = this.pending.get(askId);
    if (!waiting) return say("questions.stale");
    const previous = waiting.picks.get(index);
    waiting.picks.set(index, { chosen: previous?.chosen ?? [], other: text.trim() });
    return undefined;
  }

  submit(say: Say, askId: string): string | undefined {
    const waiting = this.pending.get(askId);
    if (!waiting) return say("questions.stale");
    const missing = waiting.questions.findIndex((question, index) => !answerFor(question, waiting.picks.get(index)));
    if (missing >= 0) return say("questions.unanswered", { number: missing + 1 });
    this.settle(askId, { kind: "answered", answers: answersFor(waiting) });
    return undefined;
  }

  skip(say: Say, askId: string): string | undefined {
    if (!this.pending.has(askId)) return say("questions.stale");
    this.settle(askId, { kind: "skipped" });
    return undefined;
  }

  finish(turnId: string): void {
    for (const [id, waiting] of this.pending) {
      if (waiting.turnId === turnId) this.settle(id, { kind: "ended" });
    }
  }

  private settle(askId: string, settled: Settled): void {
    const waiting = this.pending.get(askId);
    if (!waiting) return;
    this.pending.delete(askId);
    waiting.settle(settled);
  }
}
