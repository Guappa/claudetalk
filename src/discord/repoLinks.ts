import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { isWithin } from "../platform.ts";

const execFileAsync = promisify(execFile);

// What the remote says a number is; "unknown" is a number it has nothing under.
type Numbered = "change" | "issue" | "unknown";

export interface ReferenceLinks {
  commit(hash: string): string | null;
  issue(number: string): string;
  merge(number: string): string | null;
  // Null where the remote was not asked or did not answer in time, so nothing is known of any number. Asked as a change request, a number is one or it is unknown.
  numbered(number: string, asChange: boolean): Numbered | null;
  ref(name: string): string | null;
  file(filePath: string, line?: string, end?: string): string | null;
}

export interface References {
  hashes: Set<string>;
  names: Set<string>;
  files: Set<string>;
}

// What the remote knows of the numbers people cite.
export interface Tracker {
  changes: Set<string>;
  // Issues found one at a time, where the remote could be asked for one.
  issues: Set<string>;
  // Issues and change requests share one count on GitHub and its kin, so every number below the highest change request is one or the other.
  shared: boolean;
  highest: number;
}

interface Verified {
  head: string;
  // Where the working directory sits inside the repository, empty at its root; a blob link is written from the root.
  prefix: string;
  commits: Set<string>;
  branches: Set<string>;
  tags: Set<string>;
  files: Set<string>;
  tracker: Tracker | null;
}

interface PathShapes {
  commit(hash: string): string;
  issue(number: string): string;
  merge(number: string): string | null;
  tag(name: string): string;
  branch(name: string): string;
  file(sha: string, filePath: string, line?: string, end?: string): string;
}

const lines = (line: string | undefined, end: string | undefined, join: string): string =>
  line ? `#L${line}${end ? `${join}${end}` : ""}` : "";

// Hosts differ only in path shapes; anything unknown gets GitHub's, which Gitea, Forgejo and Codeberg share.
function shapesFor(host: string): PathShapes {
  if (host.includes("gitlab")) {
    return {
      commit: (hash) => `/-/commit/${hash}`,
      issue: (number) => `/-/issues/${number}`,
      merge: (number) => `/-/merge_requests/${number}`,
      tag: (name) => `/-/tags/${name}`,
      branch: (name) => `/-/tree/${name}`,
      file: (sha, filePath, line, end) => `/-/blob/${sha}/${filePath}${lines(line, end, "-")}`,
    };
  }
  if (host === "bitbucket.org") {
    return {
      commit: (hash) => `/commits/${hash}`,
      issue: (number) => `/issues/${number}`,
      merge: (number) => `/pull-requests/${number}`,
      tag: (name) => `/src/${name}`,
      branch: (name) => `/branch/${name}`,
      file: (sha, filePath, line, end) => `/src/${sha}/${filePath}${line ? `#lines-${line}${end ? `:${end}` : ""}` : ""}`,
    };
  }
  return {
    commit: (hash) => `/commit/${hash}`,
    issue: (number) => `/issues/${number}`,
    // A bang number is GitLab's merge request spelling; on other hosts it is just text.
    merge: () => null,
    tag: (name) => `/releases/tag/${name}`,
    branch: (name) => `/tree/${name}`,
    file: (sha, filePath, line, end) => `/blob/${sha}/${filePath}${lines(line, end, "-L")}`,
  };
}

// The SSH, ssh:// and HTTPS spellings of a remote all name the same web page.
export function remoteWebUrl(remote: string): string | null {
  const trimmed = remote
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const scp = /^(?:[\w.-]+@)?([\w.-]+):([\w.-]+\/[\w.-]+)$/.exec(trimmed);
  if (scp?.[1] && scp[2]) return `https://${scp[1]}/${scp[2]}`;
  const url = /^(ssh|https?|git):\/\/(?:[\w.-]+@)?([\w.-]+)(?::(\d+))?\/([\w.-]+\/[\w.-]+)$/.exec(trimmed);
  if (!url) return null;
  const [, scheme, host, port, repository] = url;
  // A port on an ssh or git remote is that protocol's; on an http one it is where the site itself is served.
  const served = scheme!.startsWith("http") && port ? `${host}:${port}` : host;
  return `${scheme === "http" ? "http" : "https"}://${served}/${repository}`;
}

// A folder name can hold a space, a hash or a question mark, each of which means something else in a URL.
function inUrl(prefix: string): string {
  return prefix.split("/").map(encodeURIComponent).join("/");
}

export function referenceLinks(webUrl: string, verified: Verified): ReferenceLinks {
  const shapes = shapesFor(new URL(webUrl).host);
  return {
    commit: (hash) => (verified.commits.has(hash) ? `${webUrl}${shapes.commit(hash)}` : null),
    issue: (number) => `${webUrl}${shapes.issue(number)}`,
    merge: (number) => {
      const shape = shapes.merge(number);
      return shape ? `${webUrl}${shape}` : null;
    },
    numbered: (number, asChange) => {
      const tracker = verified.tracker;
      if (!tracker) return null;
      // Where issues have a count of their own, a hash number is an issue unless the words say otherwise, whatever change request carries the same number.
      if (tracker.changes.has(number) && (asChange || tracker.shared)) return "change";
      if (asChange || !tracker.shared) return "unknown";
      return tracker.issues.has(number) || Number(number) < tracker.highest ? "issue" : "unknown";
    },
    ref: (name) => {
      if (verified.tags.has(name)) return `${webUrl}${shapes.tag(name)}`;
      if (verified.branches.has(name)) return `${webUrl}${shapes.branch(name)}`;
      return null;
    },
    file: (filePath, line, end) =>
      verified.files.has(filePath)
        ? `${webUrl}${shapes.file(verified.head, `${inUrl(verified.prefix)}${filePath}`, line, end)}`
        : null,
  };
}

const HASH = /^[0-9a-f]{7,40}$/;
const FILE = /^((?:[\w.-]+\/)*[\w-][\w.-]*\.\w+)(?::(\d+)(?:-(\d+))?)?$/;
const NAME = /^[\w][\w.\-/]*$/;
// What can end a URL but far more often ends the sentence, the emphasis or the brackets around it.
const SELDOM_ENDS_A_URL = new Set([...".,;:!?)]}\"'*_~`"]);
// An extension a file is as likely to carry as a site is, so a bare name under one is left as the file name it probably is.
const ALSO_EXTENSIONS = new Set(["sh", "app"]);
// Fences pass through untouched and an existing link keeps its text; everything else is scanned for something worth a link.
const TOKENS = new RegExp(
  [
    "(?<fence>```[\\s\\S]*?```)",
    "(?<mdlink>\\[(?<mdtext>[^\\]\\n]*)\\]\\((?<mdurl>(?:[^()\\n]|\\([^()\\n]*\\))*)\\))",
    "(?<url><?https?://[^\\s>]+>?)",
    "`(?<span>[^`\\n]+)`",
    "(?<![\\w#/])#(?<issue>\\d+)\\b",
    "(?<![\\w!/])!(?<merge>\\d+)\\b",
    "(?<![\\w/.-])(?<file>(?:[\\w.-]+/)+[\\w-][\\w.-]*\\.\\w+)(?::(?<line>\\d+)(?:-(?<end>\\d+))?)?(?![\\w/]|\\.\\w)",
    "(?<![\\w/.-])(?<hash>[0-9a-f]{7,40})(?![\\w/-]|\\.\\w)",
    "(?<![\\w@/.-])(?<domain>(?:[\\w-]+\\.)+(?:com|org|net|io|dev|app|sh|co|me|info|ai|gg|tv|xyz|uk|de|se|nl|fr|eu))(?<dpath>/[^\\s)]*)?(?![\\w-]|\\.\\w)",
  ].join("|"),
  "g",
);

// The text is a name taken from the answer as it stands, so a marker in it, the underscores of __init__.py, is escaped to show as itself. A trail's text has been through the gate once already, and a marker it escaped there is left as it is.
function link(text: string, url: string): string {
  return `[${text.replace(/(?<!\\)[*_~`|]/g, "\\$&")}](<${url}>)`;
}

// The gate's escapes belong to the text a reader sees, never to the address behind it.
function unescaped(text: string): string {
  return text.replace(/\\([^0-9A-Za-z\s])/g, "$1");
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

const OPENED_BY = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
]);

// A link's target never keeps the sentence's own punctuation or the markup around it; a closing bracket stays only where the target opened it.
function splitTrailing(token: string): [string, string] {
  let end = token.length;
  while (end > 0 && SELDOM_ENDS_A_URL.has(token[end - 1]!)) {
    const kept = token.slice(0, end);
    const opener = OPENED_BY.get(token[end - 1]!);
    if (opener && count(kept, opener) >= count(kept, token[end - 1]!)) break;
    end -= 1;
  }
  return [token.slice(0, end), token.slice(end)];
}

// deploy.sh and Info.app are files far more often than sites; a subdomain or a path is what says otherwise.
function namesAFile(domain: string, domainPath: string | undefined): boolean {
  const labels = domain.split(".");
  return !domainPath && labels.length === 2 && ALSO_EXTENSIONS.has(labels[1]!.toLowerCase());
}

function linkDomain(whole: string, domain: string, domainPath: string | undefined): string {
  if (namesAFile(domain, domainPath)) return whole;
  const [target, tail] = splitTrailing(`${domain}${domainPath ?? ""}`);
  return `${link(target, `https://${unescaped(target)}`)}${tail}`;
}

const LEADING_HASH = /^([0-9a-f]{7,40})\s+(.+)$/;

const NUMBER_LIST = /(?:#\d+\s*(?:,\s*and|,|and|&)\s*)+$/i;
const CHANGE_REQUEST = /\b(?:PRs?|pull requests?|MRs?|merge requests?)\s*$/i;
const ISSUE = /\b(?:issues?|bugs?|tickets?)\s*$/i;
// Words a hash number counts off or colours in: a place in a list, or a shade, and never an item in a tracker.
const NOT_AN_ITEM =
  /\b(?:steps?|points?|items?|options?|numbers?|no\.?|phases?|parts?|tasks?|questions?|rules?|rounds?|attempts?|places?|cases?|findings?|problems?|reasons?|colou?rs?|hex|backgrounds?|shades?|fills?|strokes?|borders?)\s*$/i;
// A place in a list is nearly always a single digit; from here up a hash number that exists in the tracker is read as an item in it.
const SELDOM_A_PLACE = 10;

type Naming = "change" | "issue" | "other" | null;

function namingBefore(text: string, offset: number): Naming {
  const before = text.slice(0, offset).replace(NUMBER_LIST, "");
  if (CHANGE_REQUEST.test(before)) return "change";
  if (ISSUE.test(before)) return "issue";
  return NOT_AN_ITEM.test(before) ? "other" : null;
}

function changeUrl(links: ReferenceLinks, number: string): string {
  return links.merge(number) ?? links.issue(number);
}

// A number links when the remote knows it and the words say, or the message makes plain, that an item in the tracker is meant.
function numberUrl(links: ReferenceLinks, number: string, naming: Naming, tracked: boolean): string | null {
  const named = naming === "change";
  const kind = links.numbered(number, named);
  // Nothing is known of the number, so only what the words name a change request links, taken at its word.
  if (kind === null) return named ? changeUrl(links, number) : null;
  // No tracker counts from zero, so a number written with one in front is something else: a colour, a code.
  if (kind === "unknown" || naming === "other" || number.startsWith("0")) return null;
  // Called an issue while the remote has it as a change request, the word more likely counts a problem off than names an item.
  if (naming === "issue" && kind !== "issue") return null;
  if (naming === null && !tracked && Number(number) < SELDOM_A_PLACE) return null;
  return kind === "change" ? changeUrl(links, number) : links.issue(number);
}

function mergeUrl(links: ReferenceLinks, number: string): string | null {
  return links.numbered(number, true) === "unknown" ? null : links.merge(number);
}

// Once a message names an item the remote knows, its other numbers are read as items too, small ones included.
function speaksOfTracker(text: string, links: ReferenceLinks): boolean {
  for (const match of text.matchAll(TOKENS)) {
    const groups = match.groups ?? {};
    if (groups.merge && mergeUrl(links, groups.merge)) return true;
    if (!groups.issue) continue;
    const naming = namingBefore(text, match.index);
    if ((naming === "change" || naming === "issue") && numberUrl(links, groups.issue, naming, false)) return true;
  }
  return false;
}

function linkSpan(content: string, links: ReferenceLinks): string | null {
  if (HASH.test(content)) {
    const url = links.commit(content);
    return url ? link(content, url) : null;
  }
  // A hash followed by its subject line is how a commit is usually quoted; only the hash is the reference.
  const lead = LEADING_HASH.exec(content);
  if (lead?.[1] && lead[2]) {
    const url = links.commit(lead[1]);
    if (url) return `${link(lead[1], url)} \`${lead[2]}\``;
  }
  const file = FILE.exec(content);
  if (file?.[1]) {
    const url = links.file(file[1], file[2], file[3]);
    if (url) return link(content, url);
  }
  if (NAME.test(content)) {
    const url = links.ref(content);
    if (url) return link(content, url);
  }
  return null;
}

// Which references the text carries, so only those are looked up in the repo.
export function collectReferences(text: string): References {
  const found: References = { hashes: new Set(), names: new Set(), files: new Set() };
  for (const match of text.matchAll(TOKENS)) {
    const groups = match.groups ?? {};
    if (groups.span) {
      if (HASH.test(groups.span)) found.hashes.add(groups.span);
      const lead = LEADING_HASH.exec(groups.span);
      if (lead?.[1]) found.hashes.add(lead[1]);
      const file = FILE.exec(groups.span);
      if (file?.[1]) found.files.add(file[1]);
      if (NAME.test(groups.span)) found.names.add(groups.span);
    }
    if (groups.file) found.files.add(groups.file);
    if (groups.hash) found.hashes.add(groups.hash);
  }
  return found;
}

// What is a link with no repository behind it: one written as Markdown, a bare URL, a domain name.
function linkWithoutRepo(whole: string, groups: Record<string, string | undefined>): string | null {
  if (groups.mdlink) return wrapLinkTarget(whole, groups.mdtext, groups.mdurl);
  if (groups.url) return wrapUrl(whole);
  if (groups.domain) return linkDomain(whole, groups.domain, groups.dpath);
  return null;
}

export function linkReferences(text: string, links: ReferenceLinks): string {
  const tracked = speaksOfTracker(text, links);
  return text.replace(TOKENS, (whole: string, ...rest: unknown[]) => {
    const groups = rest.at(-1) as Record<string, string | undefined>;
    if (groups.span) return linkSpan(groups.span, links) ?? whole;
    if (groups.issue) {
      const naming = namingBefore(rest.at(-2) as string, rest.at(-3) as number);
      const url = numberUrl(links, groups.issue, naming, tracked);
      return url ? link(whole, url) : whole;
    }
    if (groups.merge) {
      const url = mergeUrl(links, groups.merge);
      return url ? link(whole, url) : whole;
    }
    if (groups.file) {
      const url = links.file(groups.file, groups.line, groups.end);
      return url ? link(whole, url) : whole;
    }
    if (groups.hash) {
      const url = links.commit(groups.hash);
      return url ? link(whole, url) : whole;
    }
    return linkWithoutRepo(whole, groups) ?? whole;
  });
}

// A bare URL stays clickable inside angle brackets, and Discord then adds no embed beneath the message.
function wrapUrl(token: string): string {
  if (token.startsWith("<")) return token;
  const [target, tail] = splitTrailing(token);
  return `<${target}>${tail}`;
}

// A link Claude wrote itself would otherwise hang an embed under the message just as a bare URL does.
function wrapLinkTarget(whole: string, text: string | undefined, target: string | undefined): string {
  if (text === undefined || !target || !/^https?:\/\/\S+$/.test(target)) return whole;
  return `[${text}](<${target}>)`;
}

// Bare URLs and domains need no repository, so they are linked even where nothing else can be.
export function linkPlain(text: string): string {
  return text.replace(TOKENS, (whole: string, ...rest: unknown[]) => {
    const groups = rest.at(-1) as Record<string, string | undefined>;
    return linkWithoutRepo(whole, groups) ?? whole;
  });
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { windowsHide: true, maxBuffer: 4_000_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

// Long enough for a remote that is there, short enough that an answer is not held up by one that is not.
const REMOTE_TIMEOUT_MS = 2500;
// A number the refs cannot place costs a request each, so a message full of them is not chased to the end.
const MAX_ASKED_ONE_BY_ONE = 3;
const CITED_NUMBER = /(?<![\w#!/])[#!](\d+)\b/g;

// The remote keeps a ref for every change request, which is how a number is known to be one without any forge's API. Bitbucket keeps none.
function changeRefs(host: string): string | null {
  if (host === "bitbucket.org") return null;
  return host.includes("gitlab") ? "refs/merge-requests/*/head" : "refs/pull/*/head";
}

export function trackerFrom(host: string, listedRefs: string): Tracker {
  const changes = new Set<string>();
  for (const line of listedRefs.split("\n")) {
    const number = /refs\/(?:pull|merge-requests)\/(\d+)\/head$/.exec(line.trim())?.[1];
    if (number) changes.add(number);
  }
  const highest = [...changes].reduce((most, number) => Math.max(most, Number(number)), 0);
  return { changes, issues: new Set(), shared: !host.includes("gitlab"), highest };
}

// Git asks with whatever access the repository already has, and must never stop to ask a person for more.
async function listChangeRefs(cwd: string, pattern: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "ls-remote", "origin", pattern], {
      windowsHide: true,
      maxBuffer: 4_000_000,
      timeout: REMOTE_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
    });
    return stdout;
  } catch {
    return null;
  }
}

// An issue filed after the last change request has no ref and nothing above it to place it by, so a public repository on GitHub is asked for it by number.
async function askForNewest(tracker: Tracker, webUrl: string, numbers: string[]): Promise<void> {
  const unplaced = numbers.filter((number) => !tracker.changes.has(number) && Number(number) >= tracker.highest);
  const slug = new URL(webUrl).pathname.slice(1);
  await Promise.all(
    [...new Set(unplaced)].slice(0, MAX_ASKED_ONE_BY_ONE).map(async (number) => {
      try {
        const response = await fetch(`https://api.github.com/repos/${slug}/issues/${number}`, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "claudetalk-links" },
          signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
        });
        if (!response.ok) return;
        const item = (await response.json()) as { pull_request?: unknown };
        (item.pull_request ? tracker.changes : tracker.issues).add(number);
      } catch {
        return;
      }
    }),
  );
}

// Null where the remote keeps no such refs or did not answer: nothing is then known of any number.
async function trackerFor(cwd: string, webUrl: string, numbers: string[]): Promise<Tracker | null> {
  const host = new URL(webUrl).host;
  const pattern = changeRefs(host);
  const listed = pattern ? await listChangeRefs(cwd, pattern) : null;
  if (listed === null) return null;
  const tracker = trackerFrom(host, listed);
  if (host === "github.com") await askForNewest(tracker, webUrl, numbers);
  return tracker;
}

// One process answers for every candidate at once; a name it does not know comes back as "missing".
function existingCommits(cwd: string, hashes: string[]): Promise<Set<string>> {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", cwd, "cat-file", "--batch-check"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", () => resolve(new Set()));
    child.on("close", () => {
      const full = new Set<string>();
      for (const line of output.split("\n")) {
        const [name, type] = line.split(" ");
        if (name && type === "commit") full.add(name);
      }
      resolve(new Set(hashes.filter((hash) => [...full].some((sha) => sha.startsWith(hash)))));
    });
    child.stdin.end(hashes.join("\n"));
  });
}

// A blob link names the committed tree, so a file that is only on disk, ignored or unstaged, gets no link.
async function existingFiles(cwd: string, files: string[]): Promise<Set<string>> {
  const inside = files.filter((file) => isWithin(cwd, path.resolve(cwd, file)));
  if (inside.length === 0) return new Set();
  const listed = (await git(cwd, ["ls-tree", "-z", "HEAD", "--", ...inside])) ?? "";
  const blobs = new Set<string>();
  for (const entry of listed.split("\0")) {
    const [meta, filePath] = entry.split("\t");
    if (meta?.split(" ")[1] === "blob" && filePath) blobs.add(filePath);
  }
  return new Set(inside.filter((file) => blobs.has(file)));
}

// Nothing in the repo is linked unless it has a remote and the reference exists, so prose never links by accident.
export async function resolveReferences(cwd: string, text: string): Promise<ReferenceLinks | null> {
  const wanted = collectReferences(text);
  const numbers = [...text.matchAll(CITED_NUMBER)].map((match) => match[1]!);
  if (wanted.hashes.size + wanted.names.size + wanted.files.size === 0 && numbers.length === 0) return null;

  // One process answers for both: the folder's place in the repository on the first line, which is empty at its root, and the commit on the last.
  const [remote, placed] = await Promise.all([
    git(cwd, ["remote", "get-url", "origin"]),
    git(cwd, ["rev-parse", "--show-prefix", "HEAD"]),
  ]);
  const webUrl = remote ? remoteWebUrl(remote) : null;
  const [head, prefix = ""] = (placed ?? "").split("\n").reverse();
  if (!webUrl || !head) return null;

  // None of these needs another's answer, and each is a process of its own; asked at once, together they take as long as the slowest.
  const [refs, commits, files, tracker] = await Promise.all([
    wanted.names.size > 0 ? git(cwd, ["for-each-ref", "--format=%(refname)"]) : Promise.resolve(""),
    wanted.hashes.size > 0 ? existingCommits(cwd, [...wanted.hashes]) : Promise.resolve(new Set<string>()),
    wanted.files.size > 0 ? existingFiles(cwd, [...wanted.files]) : Promise.resolve(new Set<string>()),
    // The one question here that leaves the machine, so it is asked only of a message that cites a number.
    numbers.length > 0 ? trackerFor(cwd, webUrl, numbers) : Promise.resolve(null),
  ]);
  const branches = new Set<string>();
  const tags = new Set<string>();
  for (const ref of (refs ?? "").split("\n")) {
    if (ref.startsWith("refs/heads/")) branches.add(ref.slice("refs/heads/".length));
    else if (ref.startsWith("refs/remotes/origin/")) branches.add(ref.slice("refs/remotes/origin/".length));
    else if (ref.startsWith("refs/tags/")) tags.add(ref.slice("refs/tags/".length));
  }

  return referenceLinks(webUrl, { head, prefix, commits, branches, tags, files, tracker });
}
