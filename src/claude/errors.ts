export type ClaudeError =
  | { kind: "session-busy"; shortId: string; message: string }
  | { kind: "unknown"; message: string };

const BUSY_PATTERN = /^Error: Session \S+ is running as a background session \(([^)]+)\)/m;

export function detectClaudeError(stdout: string): ClaudeError | null {
  const busy = BUSY_PATTERN.exec(stdout);
  if (busy?.[1]) return { kind: "session-busy", shortId: busy[1], message: busy[0] };
  return null;
}
