export interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export type QuestionAnswers = Record<string, string>;
export type QuestionOutcome = { answered: true; answers: QuestionAnswers } | { answered: false; reason: string };
export type AskQuestions = (questions: Question[]) => Promise<QuestionOutcome>;

export const QUESTION_TOOL = "AskUserQuestion";

function parseOption(raw: unknown): QuestionOption {
  const record = (raw ?? {}) as Record<string, unknown>;
  const option: QuestionOption = { label: String(record.label ?? ""), description: String(record.description ?? "") };
  if (typeof record.preview === "string" && record.preview) option.preview = record.preview;
  return option;
}

// The tool's input is model output that Claude Code has already validated, so this only gives it a type.
export function parseQuestions(input: Record<string, unknown>): Question[] {
  const raw = Array.isArray(input.questions) ? input.questions : [];
  return raw.map((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    return {
      question: String(record.question ?? ""),
      header: String(record.header ?? ""),
      options: (Array.isArray(record.options) ? record.options : []).map(parseOption),
      multiSelect: record.multiSelect === true,
    };
  });
}
