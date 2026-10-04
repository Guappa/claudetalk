import { errorMessage } from "./text.ts";

const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const TAGS_TIMEOUT_MS = 10_000;
const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

export type FetchTagNames = (slug: string) => Promise<string[]>;

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

// The tags come back in no promised order, and a repository can carry tags that are not versions.
export function newestVersion(tagNames: string[]): string | null {
  const versions = tagNames.filter((name) => VERSION_TAG.test(name)).map((name) => name.slice(1));
  return versions.reduce<string | null>(
    (newest, version) => (newest === null || isNewer(version, newest) ? version : newest),
    null,
  );
}

async function fetchTagNames(slug: string): Promise<string[]> {
  const response = await fetch(`https://api.github.com/repos/${slug}/tags?per_page=100`, {
    // GitHub refuses a request that names no client.
    headers: { Accept: "application/vnd.github+json", "User-Agent": "claudetalk-update-check" },
    signal: AbortSignal.timeout(TAGS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return ((await response.json()) as Array<{ name: string }>).map((tag) => tag.name);
}

// Knows whether a version newer than the running one has been tagged. It only reads a public list: nothing is downloaded and nothing is installed.
export class UpdateCheck {
  private readonly current: string;
  private readonly slug: string | null;
  private readonly fetchTags: FetchTagNames;
  private latest: string | null = null;

  constructor(current: string, slug: string | null, fetchTags: FetchTagNames = fetchTagNames) {
    this.current = current;
    this.slug = slug;
    this.fetchTags = fetchTags;
  }

  // Null while this is the newest version known, which is also the answer when the check is off or has not got through.
  newer(): string | null {
    return this.latest;
  }

  // A check that fails says so in the log and changes nothing: being offline is no reason to stop, and what was known stays known.
  async refresh(): Promise<void> {
    if (!this.slug) return;
    try {
      const newest = newestVersion(await this.fetchTags(this.slug));
      this.latest = newest && isNewer(newest, this.current) ? newest : null;
    } catch (error) {
      console.error(
        `The check for a newer version did not get through: ${errorMessage(error)}. UPDATE_CHECK=false in .env switches it off.`,
      );
    }
  }

  // Once now and once a day, saying in the host log of each newer version the first time it is seen.
  watch(): void {
    let told: string | null = null;
    const check = async (): Promise<void> => {
      await this.refresh();
      if (!this.latest || this.latest === told) return;
      told = this.latest;
      console.log(
        `v${told} is out; this bridge runs v${this.current}. Update a clone with git pull and a restart, a container by pulling the new image. ` +
          `What changed: https://github.com/${this.slug}/compare/v${this.current}...v${told}`,
      );
    };
    void check();
    setInterval(() => void check(), CHECK_EVERY_MS).unref();
  }
}
