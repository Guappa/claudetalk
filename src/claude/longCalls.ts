import { parentToolUseId, type ClaudeEvent } from "./events.ts";
import { toolResultIds, toolUses } from "./streamParser.ts";

// A skill or an agent the turn waits on can run for minutes, and interrupting the turn throws away what it has done so far.
const LONG_TOOLS = new Set(["Skill", "Agent", "Task"]);

export interface LongCall {
  label: string;
  startedAt: number;
}

function labelOf(name: string, input: Record<string, unknown>): string {
  const skill = typeof input.skill === "string" ? input.skill : "";
  const description = typeof input.description === "string" ? input.description : "";
  if (name === "Skill" && skill) return `/${skill}`;
  return description || name;
}

// The session's own long calls still open, from the call to its result; an agent's calls inside it are the agent's business.
export class LongCalls {
  private readonly open = new Map<string, LongCall>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  observe(event: ClaudeEvent): void {
    if (parentToolUseId(event)) return;
    for (const use of toolUses(event)) {
      if (use.id && LONG_TOOLS.has(use.name))
        this.open.set(use.id, { label: labelOf(use.name, use.input), startedAt: this.now() });
    }
    for (const id of toolResultIds(event)) this.open.delete(id);
  }

  oldest(): LongCall | undefined {
    return this.open.values().next().value;
  }
}
