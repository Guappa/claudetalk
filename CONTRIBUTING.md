# Contributing

## Running the tests

```bash
npm test          # unit tests, fast, no Claude Code required
npm run typecheck
```

```bash
npm run test:integration
```

Integration tests spawn the real `claude` binary and consume your plan's usage,
so they are excluded from `npm test` and from CI. Run them when you change
anything in `src/claude/`.

CI runs `typecheck`, `test` and `check:private` on Linux across Node 22, 24 and
26, and on Windows on Node 24. The Linux jobs catch wrong-case imports, which
are fatal there and invisible elsewhere; the Windows job is there for path and
process semantics, which do not vary by Node version.

macOS runs on a tag instead, in `release.yml`, where it also installs, reports
and removes the launchd agent before anything is published. Every job bills a
whole minute however short it is, and macOS bills ten, so proving the agent once
per release costs a tenth of proving it on every push. Nothing is published if
that job fails.

Actions are pinned by commit SHA rather than by tag, since a tag can be moved to
point at other code. The trailing comment records which version each SHA is, and
Dependabot updates both together.

## Running it

```bash
npm run dev     # start
npm run stop    # stop the instance named in data/bridge.lock
```

Use `npm run stop` rather than killing the process. It writes `data/stop.request`,
the bridge picks it up within half a second and releases its lock on the way out.
A force-kill leaves the lock behind instead, and the next start refuses until the
heartbeat in that lock goes stale after 90 seconds. `npm run stop` also clears a
lock whose process is already gone.

**Stopping is a file, not a signal, because the two cannot always reach each
other.** Under the Windows scheduled task the bridge runs in session 0, where a
terminal in your own session is denied permission to signal it at all: `taskkill`
included, and stopping the task only kills the wrapper and orphans the bridge
beneath it. A file crosses that boundary, and it works the same on Linux.

Only one bridge may run per host. Two would answer every message twice and
double your plan usage, which is what the lock exists to prevent.

## Getting a change in

`main` is always deployable, so nothing lands on it directly. Branch, open a pull
request, let CI finish, merge.

```bash
git switch -c fix/outbox-delete-order   # type/short-description, type from the table below
# work, committing as you go
git push -u origin fix/outbox-delete-order
gh pr create
```

CI must be green before merging.

The repository allows **rebase merge only**. Commits arrive on `main` as written,
replayed in order with no merge commit. Group them by area as you go.

Nothing on the server blocks a direct push to `main`: branch protection is a paid
feature on a private repository. The convention stands regardless.

## Versions and releases

`MAJOR.MINOR.PATCH`, and the commits decide which moves:

| Commit | Bump | Meaning |
| --- | --- | --- |
| `fix:` | patch | Behaviour corrected, nothing new to learn |
| `feat:` | minor | Something new that does not disturb what was there |
| `!` or `BREAKING CHANGE:` | major | An existing command, config key or file layout changed shape |

A release is a tag, cut on `main` after the pull request has merged:

```bash
git switch main && git pull
npm version minor -m "chore(release): %s"   # bumps package.json, commits, tags vX.Y.Z
git push --follow-tags
```

Pushing the tag is the whole release. A workflow reads the commits it contains,
groups them by type and publishes a GitHub Release with those notes, so watchers
who follow releases hear about it and nobody writes a changelog by hand. The
notes open with a one-paragraph summary and a counted changelog; each line links
the pull request its commit landed through and credits the author, looked up per
commit, since a rebase merge leaves no number in the subject. Run locally without
`gh` signed in and the lines simply carry no link.

Preview what a tag would say before cutting it:

```bash
npm run release:notes            # the latest tag
npm run release:notes v0.11.0    # a specific one
```

Only `feat`, `fix`, `perf`, `refactor` and anything marked breaking reach the
notes. A release of nothing but `chore`, `docs`, `test`, `build`, `ci` and
`style` says so in one line, which is the signal that it did not need cutting.

The running bridge reports its version at startup and in `/whoami`. Check it
against the latest tag to confirm what is deployed.

## What enforces the rules

`npm test` includes `tests/style.test.ts`, which fails the build on a command
replying outside `respond`, a turn spent outside `runConversationTurn`, a stacked comment block, a JSDoc
block, a single-letter name for anything but a loop counter, module-scope mutable state, a `process.platform`
outside `platform.ts`, a `shell: true`, a slash command with no row in
`docs/REFERENCE.md`, a registered command with no handler behind it or a handler
no command reaches, an access tier naming a command that does not exist, or an
environment variable missing from `.env.example` or the README. CI runs it on
Linux and Windows.

`npm run check:private` is the other half, and CI runs it too. It fails on a
credential, a real home directory or an 8.3 short path anywhere in the tree, and
on a Discord id in the shipped docs. Names that are private to one checkout go
in `.private-terms`, one per line, which is gitignored: the mechanism ships, the
list does not.

Every check has to mean something on a stranger's machine. A rule about the
author's own filesystem belongs in `.private-terms` or a local hook, not in a
suite a fork runs.

Examples in the docs are invented, never taken from another project or an open
session.

## Constraints

**`src/platform.ts` is the only module permitted to branch on operating
system.** Everything else uses `path.join`, `os.homedir()` and `os.tmpdir()`.

**Never spawn through a shell.** `spawn(bin, args)` with an argv array, always.
A shell re-parses the prompt, which turns a leading `/compact` into a filesystem
path under Git Bash and makes message text injectable.

**Node cannot run TypeScript parameter properties.** The dev script uses
`--experimental-strip-types`, which removes types but performs no code
transformation. Write explicit fields and assign them in the constructor body.
Vitest uses esbuild and will happily accept syntax that Node then rejects at
runtime, so a green test run does not prove the app boots.

**Compaction data is spelled differently depending on the source.** A
stream-json event carries `compact_metadata.pre_tokens` in snake_case; the same
event written into a transcript carries `compactMetadata.preTokens` in camelCase.
Reading the wrong one yields `undefined`, which formats as 0 rather than
failing. The bridge reads the stream, so it uses snake_case.

**Transcripts are read-only and must be tail-read.** Real ones reach hundreds of
megabytes. Never parse a whole file, and never write to one: Claude Code owns
that format.

**The working directory comes from inside the transcript**, never from the
directory name under `~/.claude/projects`. That name collapses separators, dots
and spaces to `-`, so it cannot be reversed into a path.

**Model and effort are process-scoped.** Every turn is a new process, so the
bridge owns them per conversation and passes them on each run. Passing `/model`
or `/effort` through to the session would report success and silently revert.

**Turns run through `@anthropic-ai/claude-agent-sdk`, not a hand-built argv.**
`buildOptions` renders the typed options and `query()` runs them; there is no
flag string and no stdout parsing. The SDK still spawns the same `claude`
binary, which is why transcripts stay where `src/sessions/` reads them.

**Paths handed to a session must be long-form.** `os.tmpdir()` returns a Windows
8.3 short name such as `RUNNER~1`; `platform.ts` resolves it with
`realpathSync.native`.

**There is no sandbox.** Every turn runs in `bypassPermissions`, and access is
controlled at admission: `access.ts` answers who may do what, and tier `none` is
refused at both entry points before anything else runs.

**What gates a turn is a `PreToolUse` hook, never a permission mode.** With
`CLAUDE_TOOL_APPROVALS=true` an owner approves each command, edit or fetch from
Discord. It has to be a hook because the host's own allow rules in
`settings.json` are consulted before a permission mode, so a bare `allowedTools`
entry there would open the gate without anyone noticing. A hook is asked either
way. Approving a command still approves it to do anything the host account can
do; the gate shows you each step, it does not contain one.

**The Windows task is registered S4U.** It runs as you, in session 0, with no
desktop session and no stored password. A task in your own session gets a console
window; on Windows 11 that window is Windows Terminal, which ignores
`-WindowStyle Hidden`, so closing it would kill the bridge. It runs as you rather
than as SYSTEM because Claude Code's credentials live in your user's store.

**`MessageSink` is the only way `TurnFlow` talks back to Discord.** Keeping that
boundary is what will let a voice sink drop in later without touching the turn
logic.
