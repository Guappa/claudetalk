import { errorMessage } from "../text.ts";
import { askSession } from "./runner.ts";

export interface ModelChoice {
  // What a conversation's setting holds and a turn is started with.
  value: string;
  name: string;
  description: string;
}

// What a session answers when asked which models it offers.
interface ModelSession {
  supportedModels(): Promise<Array<{ value: string; displayName: string; description: string }>>;
}

export type OpenModelSession = <Answer>(cwd: string, ask: (session: ModelSession) => Promise<Answer>) => Promise<Answer>;

// Claude Code takes each of these for the newest model of its kind, so they hold on any version and before it has been asked.
const ALIASES: ModelChoice[] = ["fable", "opus", "sonnet", "haiku"].map((alias) => ({
  value: alias,
  name: alias,
  description: "",
}));

// The list follows Claude Code's version and the account, and asking costs a process and a couple of seconds.
const FRESH_FOR_MS = 6 * 60 * 60 * 1000;
const ASK_AGAIN_AFTER_FAILING_MS = 5 * 60 * 1000;

// "default" stands for no choice at all, which a conversation already holds by setting none.
const NO_CHOICE = "default";

// The models Claude Code offers on this host, asked of Claude Code itself so that a new one needs no release of the bridge.
export class ModelCatalog {
  private readonly cwd: string;
  private readonly open: OpenModelSession;
  private readonly now: () => number;
  private offered: ModelChoice[] = [];
  private staleAt = 0;
  private asking: Promise<void> | null = null;

  constructor(cwd: string, open: OpenModelSession = askSession, now: () => number = Date.now) {
    this.cwd = cwd;
    this.open = open;
    this.now = now;
  }

  // What is known at once, since a suggestion has three seconds and asking takes about two; a list gone stale is asked for again behind the answer.
  choices(): ModelChoice[] {
    if (this.now() >= this.staleAt) void this.refresh();
    return this.offered.length > 0 ? this.offered : ALIASES;
  }

  // An alias holds whether or not Claude Code lists it.
  offers(value: string): boolean {
    return [...ALIASES, ...this.offered].some((model) => model.value === value);
  }

  refresh(): Promise<void> {
    this.asking ??= this.ask().finally(() => {
      this.asking = null;
    });
    return this.asking;
  }

  private async ask(): Promise<void> {
    try {
      const listed = await this.open(this.cwd, (session) => session.supportedModels());
      this.offered = listed
        .filter((model) => model.value !== NO_CHOICE)
        .map((model) => ({ value: model.value, name: model.displayName || model.value, description: model.description }));
      this.staleAt = this.now() + FRESH_FOR_MS;
    } catch (error) {
      this.staleAt = this.now() + ASK_AGAIN_AFTER_FAILING_MS;
      console.error(
        `Claude Code could not be asked which models it offers: ${errorMessage(error)}. ` +
          "/model suggests what it last knew, or the four aliases, and asks again in a few minutes. If this repeats, run `claude` in a terminal to see whether it starts.",
      );
    }
  }
}
