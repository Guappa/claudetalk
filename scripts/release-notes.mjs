import { spawnSync } from "node:child_process";

// A rebase merge keeps the commits, so the notes come from their subjects and link the pull request each landed through.
const HEADINGS = [
  ["feat", "Added"],
  ["fix", "Fixed"],
  ["perf", "Changed"],
  ["refactor", "Changed"],
];
const ORDER = ["Breaking", "Added", "Fixed", "Changed"];
const NAME = "ClaudeTalk";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `${command} failed`);
  return result.stdout.trim();
}

// An argv array, never a command line: cmd.exe eats the ^ in a revision like v1.2.3^.
const git = (...args) => run("git", args);

// Without gh, or outside a checkout GitHub knows, no line has a pull request to link.
function repositoryName() {
  try {
    return run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  } catch {
    return null;
  }
}

function pullFor(repository, sha) {
  if (!repository) return null;
  try {
    const pull = JSON.parse(run("gh", ["api", `repos/${repository}/commits/${sha}/pulls`]))[0];
    return pull ? { number: pull.number, url: pull.html_url, author: pull.user?.login } : null;
  } catch {
    return null;
  }
}

function counted(quantity, singular, plural = `${singular}s`) {
  return `${quantity} ${quantity === 1 ? singular : plural}`;
}

function intro(version, sections) {
  const parts = [];
  if (sections.has("Added")) parts.push(counted(sections.get("Added").length, "addition"));
  if (sections.has("Fixed")) parts.push(counted(sections.get("Fixed").length, "fix", "fixes"));
  if (sections.has("Changed")) parts.push(counted(sections.get("Changed").length, "change"));
  const brings = parts.length ? ` brings ${parts.join(" and ")}` : " is a maintenance release";
  const update = sections.has("Breaking")
    ? "It contains a breaking change, so read that section before updating."
    : "Update with `git pull && npm ci`, then restart the bridge; nothing under `data/` changes shape.";
  return `Version ${version}${brings}. ${update}`;
}

const tag = process.argv[2] ?? git("describe", "--tags", "--abbrev=0");
const version = tag.replace(/^v/, "");
let range = tag;
try {
  const previous = git("describe", "--tags", "--abbrev=0", `${tag}~1`);
  range = `${previous}..${tag}`;
} catch {
  // No earlier tag: everything up to this one is the first release.
}

const repository = repositoryName();
const commits = git("log", range, "--format=%H%x1f%s")
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\x1f"));

const sections = new Map();
for (const [sha, subject] of commits) {
  const match = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/.exec(subject);
  if (!match) continue;

  const [, type, scope, breaking, summary] = match;
  const heading = breaking ? "Breaking" : HEADINGS.find(([key]) => key === type)?.[1];
  if (!heading) continue;

  const pull = pullFor(repository, sha);
  const credit = pull ? ` [PR [#${pull.number}](${pull.url})]${pull.author ? `, by @${pull.author}` : ""}` : "";
  const line = `- ${scope ? `**${scope}**: ` : ""}${summary}${credit}`;
  sections.set(heading, [...(sections.get(heading) ?? []), line]);
}

const total = [...sections.values()].reduce((sum, lines) => sum + lines.length, 0);
const changelog = ORDER.filter((heading) => sections.has(heading))
  .map((heading) => `### ${heading}\n\n${sections.get(heading).join("\n")}`)
  .join("\n\n");

process.stdout.write(
  [
    `# ${NAME} ${version}`,
    "",
    intro(version, sections),
    "",
    `## Changelog (${total})`,
    "",
    changelog || "Maintenance only; no user-facing change.",
    "",
  ].join("\n"),
);
