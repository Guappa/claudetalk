# Contributing

## Running the tests

```bash
npm test            # unit tests, fast, no Claude Code required
npm run typecheck
npm run lint        # Biome: lint rules, import cycles and formatting, changes nothing
npm run format      # the same, and writes what it can fix
npm run check:boot  # every source file loads under Node's type stripper
npm run knip        # files, exports and dependencies nothing reaches
npm run dupes       # jscpd: copy-paste across src and scripts
npm run coverage    # the unit tests again, with what they reach
```

`dupes` fails above 1% duplicated lines. The tests are left out of it, since a
test repeats its setup on purpose. `coverage` is a measurement and gates
nothing: read it by folder, not as one number, because a handler that only
passes options along and the logic that decides a turn do not deserve the same
figure. The total is printed; `coverage/coverage-summary.json` has each file.

```bash
npm run test:integration
```

Integration tests spawn the real `claude` binary and consume your plan's usage,
so they are excluded from `npm test` and from CI. Run them when you change
anything in `src/claude/`.

CI runs `lint`, `typecheck`, `test`, `check:boot`, `knip`, `dupes` and
`check:private` on Linux across Node 22, 24 and 26, and on Windows on Node 24.
The Linux jobs catch wrong-case imports, which are fatal there and invisible
elsewhere; the Windows job is there for path and process semantics, which do
not vary by Node version.

One of the Linux jobs also reads what none of those do: `shellcheck` over the
shell scripts, `PSScriptAnalyzer` over the PowerShell ones, and `actionlint`
over the workflows. To run them before pushing, install the three and run:

```bash
shellcheck scripts/*.sh
actionlint
pwsh -c "Invoke-ScriptAnalyzer -Path scripts -Recurse"
```

Secrets, vulnerable dependencies and unsafe patterns are watched on GitHub's
side, by secret scanning with push protection, Dependabot and CodeQL, so no
step here repeats them.

macOS runs in its own workflow, `macos.yml`, only on a pull request that changes
the launchd installer or that workflow. It installs, reports and removes the
agent. Every job bills a whole minute however short it is, and macOS bills ten,
so proving the agent where it can break costs far less than proving it on every
push. It can also be started by hand from the Actions tab.

Actions are pinned by commit SHA rather than by tag, since a tag can be moved to
point at other code. The trailing comment records which version each SHA is, and
Dependabot updates both together.

## Running it

```bash
npm run dev      # start
npm run stop     # stop the instance named in data/bridge.lock
npm run restart  # have a bridge that a service runs restart itself
```

Use `npm run stop` rather than killing the process. It writes `data/stop.request`,
the bridge picks it up within half a second and releases its lock on the way out.
A force-kill leaves the lock behind instead. The next start sees that the process
named in it is gone and takes the lock over at once; only if that pid has since
been given to some other process does it wait for the heartbeat in the lock to
go stale, which takes 90 seconds. `npm run stop` also clears a lock whose process
is already gone. It finds the lock the way the bridge does, beside
`BINDINGS_PATH` as `.env` sets it, so it stops the right bridge when the
bindings live outside `data/`.

**Stopping is a file, not a signal, because the two cannot always reach each
other.** Under the Windows scheduled task the bridge runs in session 0, where a
terminal in your own session is denied permission to signal it at all: `taskkill`
included, and stopping the task only kills the wrapper and orphans the bridge
beneath it. A file crosses that boundary, and it works the same on Linux.

Only one bridge may run per host. Two would answer every message twice and
double your plan usage, which is what the lock exists to prevent.

**A stop drains before it exits.** The request file carries a mode: `drain`
refuses new turns and waits for the running and queued ones, `now` ends them
the way `/stop` does. While draining, the bridge writes how many turns it is
waiting on into the lock, which is how `npm run stop` knows to keep waiting
rather than report a dead bridge. A termination signal is treated as a drain,
so the systemd unit and the launchd plist give the bridge thirty minutes before
the system kills it. A restart mid-turn once cut a real turn short; nothing in
the shipped scripts should be able to do that again.

**A restart waits for the bridge to be idle, then leaves with exit code 75.**
It does not drain: a drain refuses every conversation until the longest turn
anywhere has finished, which is right for a stop asked for at the host and
wrong for a restart asked for from one conversation among several. The bridge never starts
a process to replace itself: under systemd a child dies with the unit's
cgroup, and under the Windows wrapper it would outlive the log it writes to.
It leaves, and what started it starts it again: `run-bridge.ps1` loops on that
code, the systemd unit and the launchd agent restart on it, and a container
has its restart policy. Each of those passes `--supervised`, which the bridge
writes into its lock, and without it a restart is refused, since the bridge
would only be gone. `src/bootCheck.ts` is what a restart is preceded by:
`src/index.ts --check` does everything a start does up to the lock, in a child
whose environment has the variables `.env` names taken out, because Node lets
a variable that is already set win over the file and the running bridge
carries the values of its last start.

**A turn leaves a record while it runs.** `data/turns.json` maps each running
session to its progress message, cleared when the turn ends. A bridge that
starts and finds entries there knows the previous process died mid-turn, edits
those messages to say so, and takes the entries so they are reported once.

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

From outside the project, fork it, branch in the fork and open the pull request
against `main` here. The first CI run of a first-time contributor waits for the
maintainer to approve it, and a run from a fork gets no secrets.

The repository allows **rebase merge only**. Commits arrive on `main` as written,
replayed in order with no merge commit. Group them by area as you go.

A ruleset on `main` holds this: a pull request is required, rebase is the only
merge method, the history stays linear, the four test jobs must pass, and
`main` cannot be force-pushed or deleted.

## Versions

`MAJOR.MINOR.PATCH`, and the commits decide which moves:

| Commit | Bump | Meaning |
| --- | --- | --- |
| `fix:` | patch | Behaviour corrected, nothing new to learn |
| `feat:` | minor | Something new that does not disturb what was there |
| `!` or `BREAKING CHANGE:` | major | An existing command, config key or file layout changed shape |

A version is a tag on a merged commit, and it batches work: small fixes and
additions merge without a bump and wait on `main` for the next one. The level
is decided by everything merged since the last tag, and the bump rides in the
last pull request of the batch, so it costs no extra commit or CI run on
`main`:

```bash
npm version minor --no-git-tag-version   # in the batch's last PR: bumps package.json and the lockfile
git commit -am "feat(scope): ..."         # the bump goes into the commit it belongs to
# after the PR has merged
git switch main && git pull
git tag vX.Y.Z && git push origin vX.Y.Z
```

The tag and the number must agree. Nothing is published: there are no GitHub
Releases and no changelog file, and `main` is what a clone runs. What changed
between two versions is in the commits and the pull requests they landed through:

```bash
git log --oneline v0.19.0..v0.20.0
```

The running bridge reports its version at startup and in `/whoami`. Check it
against the latest tag to confirm what is deployed.

## What enforces the rules

`npm test` includes `tests/style.test.ts`, which fails the build on a command
replying outside `respond`, a turn spent outside `runConversationTurn`, a stacked comment block, a JSDoc
block, a single-letter name for anything but a loop counter, module-scope mutable state, a `process.platform`
outside `platform.ts`, a `shell: true`, a slash command with no row in
`docs/REFERENCE.md`, a registered command with no handler behind it or a handler
no command reaches, an access tier naming a command that does not exist, a sentence for a person
written outside the catalog, or an
environment variable missing from `.env.example` or the README. CI runs it on
Linux and Windows.

`npm run lint` is Biome, for lint rules and formatting together; its
configuration is `biome.jsonc`, where each rule that is switched off says why.
`npm run knip` fails on a file, an export or a dependency nothing reaches. Both
are kept quiet on a clean tree, so any output is something to act on: fix it,
or where the tool is wrong, record the exception together with its reason.

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
runtime, so a green test run does not prove the app boots. `npm run check:boot`
is what does: it hands every source file to Node's own type stripper, which
refuses a parameter property, an enum and a namespace. `erasableSyntaxOnly` in
`tsconfig.json` makes the type check refuse the same three, so an editor shows
them before either check runs.

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
and spaces to `-`, so it cannot be reversed into a path. It can still tell
candidates apart, and has to: a record is stamped with where the shell stood,
which moves with every `cd`, so the last one in a transcript is often a
subfolder. The bridge takes, among the directories a transcript names and
their parents, the one whose collapsed form is the folder's name, and falls
back to the last one stamped only when none is. Taking the last one bound a
conversation to a subfolder, and every turn run there then stamped the
subfolder again, so it never righted itself.

**Model and effort are process-scoped.** Every turn is a new process, so the
bridge owns them per conversation and passes them on each run. Passing `/model`
or `/effort` through to the session would report success and silently revert.

**Turns run through `@anthropic-ai/claude-agent-sdk`, not a hand-built argv.**
`buildOptions` renders the typed options and `query()` runs them; there is no
flag string and no stdout parsing. The SDK still spawns the same `claude`
binary, which is why transcripts stay where `src/sessions/` reads them.

**The prompt is streamed, never passed as a string.** `HeldPrompt` yields the
one user message and then holds the input open until the answer has arrived and
no background command is left running. With a string prompt the SDK closes the
input after the first answer, and a command Claude backgrounded then finishes
into a CLI that has lost its host: hooks are not consulted and every tool call
in the follow-up turn is denied as cancelled. The CLI reports the live task list
through `background_tasks_changed`, which is what decides when to let go.

The same held input is what carries a message sent mid-turn. `HeldPrompt` yields
it with priority `next`, and Claude Code folds it in at the next step. Three
things about that were captured from real runs. The session reports each
handed-over message by its uuid in `command_lifecycle` events, `queued`, then
`started` when it takes it up, then `completed`. `--replay-user-messages` also
echoes the message, and an older Claude Code sends only that, but the echo
comes with the model's first output: mid-step that is the same moment, while a
session with nothing in hand starts on the message at once and echoes it
seconds later. Going by the echo alone left Send now live over a message
already being answered, and pressing it cut that answer off. An interrupt ends the turn
in hand with an error result and leaves a waiting message queued, which then
runs as the next turn in the same process, so that result is not a failure and
the input must stay open past it. And priority `now` aborts the running tool
call, which is why Send now is an interrupt of what was already handed over and
not a second send. An interrupt also kills every running agent unless the
client declares `perTaskStopAffordance`, which the bridge does because it has
its own Stop agents control; with it declared an agent runs on and finishes,
and a background command survives either way.

**What the bridge says is looked up, never written where it is said.** Every
sentence, label and button a person reads lives in `src/i18n/locales/`, one
file per language, and code reaches one only by its key: `say("clear.running")`.
English is the source. A key that does not exist, or a value a sentence needs
and was not given, fails the typecheck; every other language is typed against
English's keys, so one that falls behind fails it too. `say` is passed down
explicitly from `bridge.language`, and a turn reads it once when it starts.

A key holds one whole sentence. Code chooses which sentence; it never builds
one out of halves, because a half that reads well in English has nowhere to go
in a language that orders the sentence differently. A sentence that counts has
a `_one` and an `_other` form and is called with `count`, and the language's
own plural rule picks between them. `{{placeholders}}`, with their format, and
commands in backticks carry over to every language unchanged, and what is bold
in English is bold in each. `tests/i18n.test.ts` fails a translation that
renames, drops or rewrites one, one that leaves a sentence in English, and one
that outgrows what Discord allows a button or a title. Only a `_one` form may
leave `{{count}}` out, since it speaks of exactly one thing.

Three kinds of text stay out of the catalog on purpose. What is written for
Claude to read is in `src/claude/prompts.ts`, the system note and the channel
context, and stays English, since Claude did not pick a language. What the
host reads, the log and the errors the bridge stops on at startup, stays
English too. And a slash command's name and description are the same in every
language, as they are in the terminal. Anything else that reads as a sentence
in `src/` fails the style test.

Adding a language is a file in `src/i18n/locales/` typed as `Catalog`, and a
line each in `LANGUAGES` and `CATALOGS` in `src/i18n/index.ts`; a test fails
one that is in either and not the other. A language holds English's two forms
of a counted sentence, and where its own plural rule has a form English lacks,
that form is filled from its `_other` at start-up, so French counts in the
millions and Chinese counts of one are still said in their own language. A
language whose forms differ in wording, Russian's or Arabic's few and many,
cannot be typed as `Catalog` as it stands; that is the point to loosen the
type and let the test hold its keys.

**What the bot says has to be what happens.** A message that names an effect is
checked against the code or a captured run before it ships, and corrected in
the same change that alters the behaviour. The full-queue refusal went on
saying `/stop` dropped the queue for weeks after `/stop` stopped doing that,
and its test went on passing because it checked the old words. A translation
is held to the same: it says what the English says, no more and no less, and
changes in the same commit the English does.

The same held input is what makes an orphaned task survivable. A stop or a
crash can still leave a command running when the process exits, and the next
process to resume that session opens by reporting it and running a rescue turn.
Every tool call in that process is then cancelled without the hook or the
permission callback being consulted, however long you wait. The prompt is
therefore held until the SDK's initialize handshake settles, which the CLI
answers only after it has reported any orphan, and a `task_notification` with
status `stopped` arriving before the model has spoken marks the process for a
restart: it is aborted, the report is already on disk, and a fresh process
takes the turn cleanly. Holding until `init` instead would deadlock, because a
clean session emits nothing until it has a prompt. All of this was reproduced
against the CLI, not inferred.

**The temp folder is spelled by its long name.** `os.tmpdir()` returns a Windows
8.3 short name such as `RUNNER~1`; `platform.ts` resolves it with
`realpathSync.native`. The reason is the bridge's own comparisons: the session
index expands every recorded folder to its long form, so a path under the short
spelling would match none of them. Claude Code takes either spelling. In
`bypassPermissions` it writes to, reads from and starts in a short-named folder,
and resumes under the long name a session that was started under the short one;
its check for suspicious Windows paths, which holds such a write for approval,
does not apply in that mode.

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

**The same hook answers `AskUserQuestion`.** Claude Code only offers that tool
to a client that declares a prompt surface, so a turn that can ask sets
`permissionPromptToolName` to `stdio`, which is what the SDK itself sends when a
`canUseTool` callback is present. The callback is never reached under
`bypassPermissions`; the hook answers first by returning the tool's input with
an `answers` map, or denies with a reason that tells Claude to continue.

**The Windows task is registered S4U.** It runs as you, in session 0, with no
desktop session and no stored password. A task in your own session gets a console
window; on Windows 11 that window is Windows Terminal, which ignores
`-WindowStyle Hidden`, so closing it would kill the bridge. It runs as you rather
than as SYSTEM because Claude Code's credentials live in your user's store.

**The image is the same bridge, and nothing in `src/` knows it is in one.** The
`Dockerfile` runs `src/` under Node's type stripper exactly as the services do,
so there is one way the bridge runs everywhere; what differs is outside the
code: the `claude` on the image's PATH is a link to the build the
Agent SDK ships, so listings and turns run one Claude Code, and the folders the
bridge writes belong to the root group so `--user` with any uid can still write
them. A change to the `Dockerfile`, `.dockerignore` or `compose.yaml` is proved
on the pull request by `image.yml`, which builds the image and boots it without
a token, directly and through the compose file over an untouched `.env.example`;
a tag publishes it to `ghcr.io` for amd64 and arm64. hadolint lints the
`Dockerfile` in CI, with `.hadolint.yaml` naming what it ignores and why.

**Every text reaches Discord through `forDiscord` in `outgoing.ts`.** The sink,
the command replies, notices and the few direct posts all call it, and a style
test fails any Discord send that does not. It redacts every spelling of a home
path, found by shape and not by any account's name, and runs `defuseStrayMarkup`, which escapes any inline marker
that would close outside its own stretch of text. Discord closes an open
backtick, underscore or star at the next matching one anywhere in the message,
including inside a later code block, and did so twice in real trails before
this guard existed. A message that joins several texts, as the trail joins
remarks and `/sync` joins exchanges, seals each text on its own first. Posting
around the gate, or joining texts without sealing them, brings both bugs back.

**What Discord accepts is read from `src/discord/limits.ts`.** The message,
embed, menu, button, modal, custom id and upload limits are named there and
nowhere else, so that a limit Discord changes is one edit. A bare `2000` or
`100` beside a cut in code is a copy that will be missed.

**Emoji appear in exactly two places, from one fixed set.** The reaction on the
message that started a turn, and the heading of the progress message, each
carrying the turn's state: queued, running, waiting on a person, done, stopped,
failed. The set lives in `src/discord/reactions.ts` and `statusMessage.ts`,
standard Unicode only, so every client draws the same thing and no server needs
a custom emoji. Nothing else in the bridge uses emoji: not prose, not notices,
not the answer, not commits.

**`MessageSink` is the only way `TurnFlow` talks back to Discord.** Keeping that
boundary is what will let a voice sink drop in later without touching the turn
logic. A question is a list of `SinkMenu`s and two actions; how a menu is drawn
and how the "Other..." entry collects free text is the Discord sink's business.
The same goes for agents: `AgentBoard` asks the sink for a side room and keeps
a roster in it, and only the Discord sink knows that a side room is a thread.

**An agent is told apart by the stream, never guessed.** A task counts as an
agent when its start event says `local_agent`; a background command is
`local_bash` and is left out. Everything an agent says or does carries the id
of the tool call that first launched it, which its start event names, and that
is what keeps an agent's work out of the trail. An agent sent back to work gets
a second start event with the same task id and a new tool call id, while its
messages go on carrying the first; its usage then counts from zero again. These
shapes were captured from real turns, not read off the type definitions.

**A cloud task is stopped through the session, never only by killing it.** A
task of type `remote_agent` runs on Anthropic's side. Claude Code closes the
cloud session when the task is stopped with the SDK's `stopTask`; killing the
local process skips that, and the session runs on. So `TurnFlow` stops cloud
tasks first and waits briefly before it kills a turn. This rests on reading
Claude Code's own code for the stop path, since launching a billed review to
watch it was not something a test could do.
