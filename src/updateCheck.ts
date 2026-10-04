import { errorMessage } from "./text.ts";

const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const GITHUB_TIMEOUT_MS = 10_000;
const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
// What a person running the bridge would notice: something new, or something put right.
const NOTICEABLE = /^(feat|fix)(?:\([^)]*\))?!?:\s*(.+)$/;

export type FetchTagNames = (slug: string) => Promise<string[]>;
// The messages of the commits between two tags, oldest first.
export type FetchCommitMessages = (slug: string, from: string, to: string) => Promise<string[]>;

// What there is to say of a newer version: how far ahead it is, and what its commits say changed.
export interface UpdateNews {
  version: string;
  current: string;
  behind: number;
  changes: string[];
  url: string;
}

// "git+https://github.com/owner/name.git" is how package.json writes it; a repository anywhere else is one this check cannot ask.
export function githubSlug(repository: string | undefined): string | null {
  const match = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(repository ?? "");
  return match ? match[1]! : null;
}

function parts(version: string): number[] | null {
  const match = VERSION_TAG.exec(version.startsWith("v") ? version : `v${version}`);
  return match ? match.slice(1).map(Number) : null;
}

// Compared number by number, so 0.10.0 is newer than 0.9.0; a version that is not three numbers is never newer or older than anything.
export function isNewer(candidate: string, than: string): boolean {
  const left = parts(candidate);
  const right = parts(than);
  if (!left || !right) return false;
  const differing = left.findIndex((part, index) => part !== right[index]);
  return differing >= 0 && left[differing]! > right[differing]!;
}

function versionsIn(tagNames: string[]): string[] {
  return tagNames.filter((name) => VERSION_TAG.test(name)).map((name) => name.slice(1));
}

// The tags come back in no promised order, and a repository can carry tags that are not versions.
export function newestVersion(tagNames: string[]): string | null {
  return versionsIn(tagNames).reduce<string | null>(
    (newest, version) => (newest === null || isNewer(version, newest) ? version : newest),
    null,
  );
}

// There is no changelog: the commits are the record, and their subjects are what is shown. Housekeeping is left out, and what is new comes before what was mended, since only the first few are read.
export function changesIn(commitMessages: string[]): string[] {
  const noticed = commitMessages.flatMap((message) => {
    const subject = NOTICEABLE.exec(message.split("\n", 1)[0]!.trim());
    return subject ? [{ added: subject[1] === "feat", text: subject[2]! }] : [];
  });
  return [...noticed.filter((change) => change.added), ...noticed.filter((change) => !change.added)].map((change) => change.text);
}

async function askGitHub<Answer>(path: string): Promise<Answer> {
  const response = await fetch(`https://api.github.com/repos/${path}`, {
    // GitHub refuses a request that names no client.
    headers: { Accept: "application/vnd.github+json", "User-Agent": "claudetalk-update-check" },
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return (await response.json()) as Answer;
}

async function fetchTagNames(slug: string): Promise<string[]> {
  return (await askGitHub<Array<{ name: string }>>(`${slug}/tags?per_page=100`)).map((tag) => tag.name);
}

async function fetchCommitMessages(slug: string, from: string, to: string): Promise<string[]> {
  const compared = await askGitHub<{ commits: Array<{ commit: { message: string } }> }>(
    `${slug}/compare/v${from}...v${to}?per_page=100`,
  );
  return compared.commits.map((entry) => entry.commit.message);
}

// Knows whether a version newer than the running one has been tagged. It only reads public lists: nothing is downloaded and nothing is installed.
export class UpdateCheck {
  private readonly current: string;
  private readonly slug: string | null;
  private readonly fetchTags: FetchTagNames;
  private readonly fetchMessages: FetchCommitMessages;
  private found: UpdateNews | null = null;

  constructor(
    current: string,
    slug: string | null,
    fetchTags: FetchTagNames = fetchTagNames,
    fetchMessages: FetchCommitMessages = fetchCommitMessages,
  ) {
    this.current = current;
    this.slug = slug;
    this.fetchTags = fetchTags;
    this.fetchMessages = fetchMessages;
  }

  // Null while this is the newest version known, which is also the answer when the check is off or has not got through.
  newer(): string | null {
    return this.found?.version ?? null;
  }

  news(): UpdateNews | null {
    return this.found;
  }

  // A check that fails says so in the log and changes nothing: being offline is no reason to stop, and what was known stays known.
  async refresh(): Promise<void> {
    if (!this.slug) return;
    try {
      const ahead = versionsIn(await this.fetchTags(this.slug)).filter((version) => isNewer(version, this.current));
      const newest = newestVersion(ahead.map((version) => `v${version}`));
      if (!newest) {
        this.found = null;
        return;
      }
      // Asked once per version: what lies between two tags does not change.
      const changes = this.found?.version === newest ? this.found.changes : await this.changesUpTo(this.slug, newest);
      const url = `https://github.com/${this.slug}/compare/v${this.current}...v${newest}`;
      this.found = { version: newest, current: this.current, behind: ahead.length, changes, url };
    } catch (error) {
      console.error(
        `The check for a newer version did not get through: ${errorMessage(error)}. UPDATE_CHECK=false in .env switches it off.`,
      );
    }
  }

  // The version is still worth saying when what changed could not be read, as it cannot for a running version that was never tagged.
  private async changesUpTo(slug: string, newest: string): Promise<string[]> {
    try {
      return changesIn(await this.fetchMessages(slug, this.current, newest));
    } catch {
      return [];
    }
  }

  // Once now and once a day, saying in the host log of each newer version the first time it is seen.
  watch(): void {
    let told: string | null = null;
    const check = async (): Promise<void> => {
      await this.refresh();
      if (!this.found || this.found.version === told) return;
      told = this.found.version;
      console.log(
        `v${told} is out; this bridge runs v${this.current}. Update a clone with git pull and a restart, a container by pulling the new image. ` +
          `What changed: ${this.found.url}`,
      );
    };
    void check();
    setInterval(() => void check(), CHECK_EVERY_MS).unref();
  }
}
