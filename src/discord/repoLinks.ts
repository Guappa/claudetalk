import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { isWithin } from "../platform.ts";

const execFileAsync = promisify(execFile);

export interface ReferenceLinks {
  commit(hash: string): string | null;
  issue(number: string): string;
  merge(number: string): string | null;
  ref(name: string): string | null;
  file(filePath: string, line?: string, end?: string): string | null;
}

export interface References {
  hashes: Set<string>;
  names: Set<string>;
  files: Set<string>;
}

interface Verified {
  head: string;
  // Where the working directory sits inside the repository, empty at its root; a blob link is written from the root.
  prefix: string;
  commits: Set<string>;
  branches: Set<string>;
  tags: Set<string>;
  files: Set<string>;
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
  const url = /^(?:ssh|https?|git):\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/([\w.-]+\/[\w.-]+)$/.exec(trimmed);
  if (url?.[1] && url[2]) return `https://${url[1]}/${url[2]}`;
  return null;
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
    ref: (name) => {
      if (verified.tags.has(name)) return `${webUrl}${shapes.tag(name)}`;
      if (verified.branches.has(name)) return `${webUrl}${shapes.branch(name)}`;
      return null;
    },
    file: (filePath, line, end) =>
      verified.files.has(filePath) ? `${webUrl}${shapes.file(verified.head, `${verified.prefix}${filePath}`, line, end)}` : null,
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

// The text is a name taken from the answer as it stands, so a marker in it, the underscores of __init__.py, is escaped to show as itself.
function link(text: string, url: string): string {
  return `[${text.replace(/[\\*_~`|]/g, "\\$&")}](<${url}>)`;
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

// A link's target never keeps the sentence's own punctuation or the markup around it; a closing bracket stays only where the target opened it.
function splitTrailing(token: string): [string, string] {
  let end = token.length;
  while (end > 0 && SELDOM_ENDS_A_URL.has(token[end - 1]!)) {
    const kept = token.slice(0, end);
    if (token[end - 1] === ")" && count(kept, "(") >= count(kept, ")")) break;
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
  return `${link(target, `https://${target}`)}${tail}`;
}

const LEADING_HASH = /^([0-9a-f]{7,40})\s+(.+)$/;

const NUMBER_LIST = /(?:#\d+\s*(?:,\s*and|,|and|&)\s*)+$/i;
const CHANGE_REQUEST = /\b(?:PRs?|pull requests?|MRs?|merge requests?)\s*$/i;

// A bare number is as often the third point of a list as a tracker item, so only a change request named as one links.
function namesChangeRequest(text: string, offset: number): boolean {
  return CHANGE_REQUEST.test(text.slice(0, offset).replace(NUMBER_LIST, ""));
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
  return text.replace(TOKENS, (whole: string, ...rest: unknown[]) => {
    const groups = rest.at(-1) as Record<string, string | undefined>;
    if (groups.span) return linkSpan(groups.span, links) ?? whole;
    if (groups.issue) {
      const named = namesChangeRequest(rest.at(-2) as string, rest.at(-3) as number);
      return named ? link(whole, links.merge(groups.issue) ?? links.issue(groups.issue)) : whole;
    }
    if (groups.merge) {
      const url = links.merge(groups.merge);
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
  const hasNumber = /(?<![\w#!/])[#!]\d+\b/.test(text);
  if (wanted.hashes.size + wanted.names.size + wanted.files.size === 0 && !hasNumber) return null;

  const remote = await git(cwd, ["remote", "get-url", "origin"]);
  const webUrl = remote ? remoteWebUrl(remote) : null;
  const head = await git(cwd, ["rev-parse", "HEAD"]);
  if (!webUrl || !head) return null;

  const refs = (await git(cwd, ["for-each-ref", "--format=%(refname)"])) ?? "";
  const branches = new Set<string>();
  const tags = new Set<string>();
  for (const ref of refs.split("\n")) {
    if (ref.startsWith("refs/heads/")) branches.add(ref.slice("refs/heads/".length));
    else if (ref.startsWith("refs/remotes/origin/")) branches.add(ref.slice("refs/remotes/origin/".length));
    else if (ref.startsWith("refs/tags/")) tags.add(ref.slice("refs/tags/".length));
  }

  return referenceLinks(webUrl, {
    head,
    prefix: wanted.files.size > 0 ? ((await git(cwd, ["rev-parse", "--show-prefix"])) ?? "") : "",
    commits: wanted.hashes.size > 0 ? await existingCommits(cwd, [...wanted.hashes]) : new Set(),
    branches,
    tags,
    files: wanted.files.size > 0 ? await existingFiles(cwd, [...wanted.files]) : new Set(),
  });
}
