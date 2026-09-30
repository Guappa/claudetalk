// What went wrong and what it carried, never a sentence: whoever shows it words it in the reader's language.
export type ClaudeError =
  | { kind: "session-busy"; shortId: string }
  | { kind: "stopped" }
  | { kind: "orphan-twice" }
  | { kind: "ended"; subtype: string; text: string }
  | { kind: "could-not-run"; message: string };

const BUSY_PATTERN = /^Error: Session \S+ is running as a background session \(([^)]+)\)/m;

export function detectClaudeError(stdout: string): ClaudeError | null {
  const busy = BUSY_PATTERN.exec(stdout);
  if (busy?.[1]) return { kind: "session-busy", shortId: busy[1] };
  return null;
}
