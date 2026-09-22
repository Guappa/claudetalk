import { randomUUID } from "node:crypto";
import type { Question, QuestionAnswers, QuestionOutcome } from "../claude/questions.ts";
import { count, truncate } from "../text.ts";
import { questionPickId, questionSkipId, questionSubmitId } from "./menus.ts";
import type { MessageSink, SinkAction, SinkMenu } from "./messageSink.ts";

// A question deserves more thought than a permission, and a phone is often the thing answering it.
const QUESTION_TIMEOUT_MS = 10 * 60_000;
const MESSAGE_LIMIT = 1900;
const PREVIEW_LIMIT = 300;

export const OTHER_VALUE = "other";

const STALE = "Those questions are already answered, expired, or from before a restart.";
const NO_MENUS = "This conversation cannot show questions, so Claude has to continue without an answer.";
const EXPIRED = `No answer in ${QUESTION_TIMEOUT_MS / 60_000} minutes, so Claude continues without one.`;
const SKIPPED = "Skipped: Claude continues without answers and says what it assumed.";
const ENDED = "The turn ended before this was answered.";

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

function describeQuestion(question: Question, index: number): string {
  const lines = [`**${index + 1}. ${question.header}** ${question.question}${question.multiSelect ? " Pick any that apply." : ""}`];
  for (const option of question.options) {
    if (option.preview) lines.push(`${option.label}:\n\`\`\`\n${truncate(option.preview, PREVIEW_LIMIT)}\n\`\`\``);
  }
  return lines.join("\n");
}

export function describeQuestions(questions: Question[]): string {
  const heading = questions.length === 1 ? "Claude has a question." : `Claude has ${count(questions.length, "question")}.`;
  return truncate([heading, ...questions.map(describeQuestion)].join("\n"), MESSAGE_LIMIT);
}

// Option values are positions, so a label that repeats or runs long never collides with another.
export function menusFor(askId: string, questions: Question[]): SinkMenu[] {
  return questions.map((question, index) => ({
    id: questionPickId(askId, index),
    placeholder: question.header || `Question ${index + 1}`,
    multiple: question.multiSelect,
    options: [
      ...question.options.map((option, position) => ({
        value: String(position),
        label: option.label,
        description: option.description,
      })),
      { value: OTHER_VALUE, label: "Other...", description: "Type an answer of your own" },
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

const UNANSWERED: Record<Exclude<Settled["kind"], "answered">, string> = {
  skipped: SKIPPED,
  expired: EXPIRED,
  ended: ENDED,
};

function describeSettled(settled: Settled, questions: Question[]): string {
  if (settled.kind !== "answered") return UNANSWERED[settled.kind];
  const summary = questions.map((question) => `${question.header} = ${settled.answers[question.question]}`).join(". ");
  return `Answered: ${summary}.`;
}

function outcomeFor(settled: Settled): QuestionOutcome {
  if (settled.kind === "answered") return { answered: true, answers: settled.answers };
  return { answered: false, reason: `${UNANSWERED[settled.kind]} Continue on your own judgement and say what you assumed.` };
}

function actionsFor(askId: string): SinkAction[] {
  return [
    { id: questionSubmitId(askId), label: "Submit" },
    { id: questionSkipId(askId), label: "Skip", tone: "danger" },
  ];
}

// One per turn, like approvals: what a turn asked dies with it.
export class QuestionPrompts {
  private readonly pending = new Map<string, Pending>();

  async ask(turnId: string, sink: MessageSink, questions: Question[]): Promise<QuestionOutcome> {
    if (!sink.askWithMenus) return { answered: false, reason: NO_MENUS };

    const id = randomUUID();
    const { promise: settled, resolve: settle } = Promise.withResolvers<Settled>();
    this.pending.set(id, { turnId, questions, picks: new Map(), settle });

    const timer = setTimeout(() => this.settle(id, { kind: "expired" }), QUESTION_TIMEOUT_MS);
    timer.unref();

    const handle = await sink.askWithMenus(describeQuestions(questions), menusFor(id, questions), actionsFor(id));
    const result = await settled;
    clearTimeout(timer);
    await handle.close(describeSettled(result, questions));
    return outcomeFor(result);
  }

  // Values are option positions, or the "other" marker whose text arrives separately.
  pick(askId: string, index: number, values: string[]): string | undefined {
    const waiting = this.pending.get(askId);
    if (!waiting) return STALE;
    const previous = waiting.picks.get(index);
    const chosen = values.filter((value) => value !== OTHER_VALUE);
    waiting.picks.set(index, values.includes(OTHER_VALUE) ? { chosen, other: previous?.other } : { chosen });
    return undefined;
  }

  answerFreeText(askId: string, index: number, text: string): string | undefined {
    const waiting = this.pending.get(askId);
    if (!waiting) return STALE;
    const previous = waiting.picks.get(index);
    waiting.picks.set(index, { chosen: previous?.chosen ?? [], other: text.trim() });
    return undefined;
  }

  submit(askId: string): string | undefined {
    const waiting = this.pending.get(askId);
    if (!waiting) return STALE;
    const missing = waiting.questions.findIndex((question, index) => !answerFor(question, waiting.picks.get(index)));
    if (missing >= 0) return `Question ${missing + 1} has no answer yet. Pick one, or press Skip to send none.`;
    this.settle(askId, { kind: "answered", answers: answersFor(waiting) });
    return undefined;
  }

  skip(askId: string): string | undefined {
    if (!this.pending.has(askId)) return STALE;
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
