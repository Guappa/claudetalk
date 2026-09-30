// What went wrong and what it carried, never a sentence: whoever shows it words it in the reader's language.
export type ClaudeError =
  | { kind: "session-busy"; shortId: string }
  // The id a turn was told to resume is one Claude Code holds no transcript for.
  | { kind: "unknown-session" }
  | { kind: "stopped" }
  | { kind: "orphan-twice" }
  | { kind: "ended"; subtype: string; text: string }
  // Claude Code's own account of why it could not answer: a plan limit, an API error.
  | { kind: "reported"; text: string }
  | { kind: "could-not-run"; message: string };

const BUSY_PATTERN = /^Error: Session \S+ is running as a background session \(([^)]+)\)/m;
const UNKNOWN_SESSION_PATTERN = /No conversation found with session ID/i;

export function detectClaudeError(stdout: string): ClaudeError | null {
  const busy = BUSY_PATTERN.exec(stdout);
  if (busy?.[1]) return { kind: "session-busy", shortId: busy[1] };
  if (UNKNOWN_SESSION_PATTERN.test(stdout)) return { kind: "unknown-session" };
  return null;
}
