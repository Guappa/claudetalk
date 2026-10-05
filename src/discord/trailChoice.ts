import { orderedWriter, readJsonOr } from "../jsonFile.ts";
import { TRAIL_KINDS, type TrailKind } from "./toolTrail.ts";

// What a hide or a show may name beside a kind: every kind at once.
export const EVERY_KIND = "all";

// What was stored may come from a build that knew other kinds; only the ones this build draws are read back.
function knownKinds(stored: unknown): TrailKind[] {
  return Array.isArray(stored) ? TRAIL_KINDS.filter((kind) => stored.includes(kind)) : [];
}

const named = (choice: string | null): TrailKind[] => (choice === EVERY_KIND ? [...TRAIL_KINDS] : knownKinds([choice]));

// The kinds left hidden once one is hidden and one is shown, in that order, so hiding all and showing one leaves that one alone.
export function hiddenAfter(hidden: ReadonlySet<TrailKind>, hide: string | null, show: string | null): TrailKind[] {
  const next = new Set([...hidden, ...named(hide)]);
  for (const kind of named(show)) next.delete(kind);
  return TRAIL_KINDS.filter((kind) => next.has(kind));
}

// Which kinds of tool call the trail leaves out: a default for the whole bridge, which outlives a restart, under each conversation's own choice.
export class TrailChoice {
  private everywhere: TrailKind[] = [];
  private readonly filePath: string;
  private readonly write: (value: unknown) => Promise<void>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.write = orderedWriter(filePath);
  }

  async load(): Promise<void> {
    const stored = await readJsonOr<{ hidden?: unknown }>(this.filePath, () => ({}));
    this.everywhere = knownKinds(stored?.hidden);
  }

  // A conversation that has made its own choice keeps it; one that has made none follows the default.
  hiddenIn(own: string[] | undefined): ReadonlySet<TrailKind> {
    return new Set(own ? knownKinds(own) : this.everywhere);
  }

  async chooseEverywhere(hidden: TrailKind[]): Promise<void> {
    this.everywhere = hidden;
    await this.write({ hidden });
  }
}
