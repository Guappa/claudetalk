# Reference

Everything the bridge does, and the rules behind it. The README covers setup;
this covers behaviour.

## Commands

`H` = owners only. `O` = operators and above. Nobody below an operator can run any of them.

| Command | | What it does |
| --- | --- | --- |
| `/create <name> [project] [category]` | O | Creates a Discord channel named after `<name>`, starts a conversation in it, binds the two. The channel is private to you. Creates the working directory if it does not exist, and asks first if that folder already holds a conversation. |
| `/resume <name>` | O | Opens an existing conversation: makes a channel, binds it, posts the last exchange. Points at the existing channel if one is already open. Autocompletes to the most recent per name; type a session id to reach an older one. |
| `/fork [name]` | O | Branches this conversation into a new one in its own channel. The original is untouched. |
| `/sessions [filter]` | O | Lists conversations on the host: name, transcript size, directory, last activity, whether something is holding it. Ones working inside the temp folder are left out unless a filter is given. |
| `/whoami` | O | What this channel is bound to, its model and effort, and the exact `claude --resume <id>` command for the host. A value the conversation does not override is shown as the host's default from `~/.claude/settings.json`, or as Claude Code's own when that file sets none. |
| `/spend` | O | Plan usage first, the 5-hour and weekly windows as Claude Code reports them with each turn, for the whole account. Then turns and tokens for this conversation and for every conversation the bridge has touched since it last started; a restart resets those, and turns run in a terminal are never counted. An API-equivalent cost comes last, only for ranking conversations against each other: a subscription is not billed by it. Named `/spend` so Claude Code's own `/usage` and `/cost` still reach the session. |
| `/members` | O | The conversation's owner, who else can see its channel, and where it runs. |
| `/operator <add\|remove\|list> [user]` | H | Who may create and drive their own conversations, and where each one comes from. |
| `/invite <user>` | H | Lets someone see this conversation's channel. Grants no use of the bot. |
| `/uninvite <user>` | H | Takes that visibility away again. |
| `/model [value]` | O | Shows or sets the model for this conversation. Persists across turns. Unset, it names the host default turns actually run with. |
| `/effort [value]` | O | Shows or sets the effort level. Persists across turns. Unset, it names the host default turns actually run with. |
| `/ask <prompt> [context:N]` | O | Asks with the last N channel messages as context. `N` is 1 to 50. |
| `/sync` | O | Posts what happened in this conversation outside Discord since you last saw it, prompts and replies only. Turns the bridge itself ran are marked seen when they end, so they never come back as drift. |
| `/skills` | O | Lists the bound session's skills, A to Z across up to five menus of twenty-five, and runs the one you pick. Past 125 the rest are counted and reachable by sending `/name` as a message. |
| `/plugins` | H | Lists installed Claude Code plugins and toggles one. |
| `/purge` | O | Deletes every message in this channel after a confirmation. The conversation is kept. |
| `/stop` | O | Kills the in-flight turn and its process tree, and drops anything queued behind it. The transcript keeps the partial turn. A **Stop** button on the progress message does the same thing without typing. |
| `/queue` | O | Says whether a turn is running here and how many messages are queued behind it. |
| `/takeover` | O | Stops a background agent holding this conversation, then continues. |
| `/category [name]` | O | Shows the category this conversation's channel is in, or moves it to one. Creates the category if it does not exist. |
| `/unbind` | O | Unbinds the channel at once, then offers to delete it or keep it for the history. The conversation stays on the host either way. |

### Where the channel goes

A conversation's channel lands in the first of these that exists: the `category`
passed to `/create`, then `DISCORD_CATEGORY_ID`, then the category the command
was run in. Naming a category that does not exist creates it. `/category` moves
an existing conversation, or with no name says where it sits. Discord holds 50
channels per category; the limit is checked first and reported plainly. Moving a
channel keeps its own permission overwrites, since inheriting the category's
would make a private channel public.

### Starting one where work already happened

`/create` looks at the folder it was given. If it does not exist, it is created
and a conversation starts in it. If it exists with no conversation, one starts
in it. If it already holds conversations, the bridge asks rather than choosing:
it offers the three most recent by name and age, plus starting another
alongside them. Resuming from there is the same as `/resume`. The question
expires after ten minutes.

### Telling conversations apart

Several conversations can share a name, because a name is only a `custom-title`
record. Autocomplete therefore shows size and age and submits the session id:

```
project-notes · 22 MB · 2h ago
project-notes · 140 MB · 3w ago
deploy-scripts · 8 MB · 5d ago
```

The list is ordered by last activity; size only breaks ties, since a large
transcript is often an abandoned copy. `/resume` offers one conversation per
name, the most recent, marked `+N older` when it stands in for others; to reach
an older one, type the start of its session id, which the autocomplete searches
as well as the name. Typing a name resolves the same way.

A conversation with no title is named after the folder it works in, so every
untitled one in the same folder carries the same name and `/resume` and
`/sessions` add the first eight characters of the session id. One working in the
home folder itself is named `home`, never the account name. Conversations inside
the system temp folder are scratch, the kind a probe leaves behind, and both
`/sessions` and the `/resume` picker leave them out until you type something;
`/sessions` says how many it left out.

`claude --resume` on the host carries the same ambiguity, which is why `/whoami`
prints the exact `claude --resume <id>` command.

### How replies are shaped

**A command's reply is an acknowledgement, so only you see it.** Every slash
command answers ephemerally and Discord discards the reply on its own. `/sync`
is the exception, because it posts conversation history. `/whoami`, `/members`
and `/sessions` answer with an embed, which holds 4096 characters where a
message holds 2000.

**A notice a turn produces in the channel is transient too**: a refusal, a queue
position, a compaction summary, a context warning, what happened outside
Discord. Only an interaction reply can be ephemeral, so these are removed after
a minute instead. What a conversation itself says is plain text and stays.

**Paths are written relative to your home folder**, as `~/code/thing`, never
absolute. An absolute path on Windows carries the account name, and a channel is
a place other people can be invited into. Everything the bot posts goes through
one sink that rewrites a home path, so a path Claude mentions in prose is
covered too.

## Messages

**A bound channel** treats every message as a turn. The one exception is a reply
aimed at another person: in a conversation you have invited somebody to, two
people discussing an answer are talking to each other, so a reply to another
member is passed over. Tag the bot in the same message and it joins, quoting
what you replied to. A reply to your own message or to the bot still counts.

**Any other channel** stays silent until the bot is addressed: tagged, or
replied to, with or without the ping. The first time, it starts a conversation
there in mention-only mode, so later messages keep their context while ordinary
chatter is still ignored. If the channel's name matches an existing conversation
it binds to that one instead, so `#deploy-scripts` finds "deploy scripts".

**Plain messages are scoped by `DISCORD_CATEGORY_ID`.** Inside the category,
every conversation channel is a turn. Outside it, a message is only acted on if
the channel is already bound, which is what stops one bridge auto-binding inside
a channel that belongs to another. Commands work from anywhere in the server;
they are gated by who you are, not where you type. With no category set, the
bridge acts on every channel, which is fine when it is the only bridge there.

```
Text Channels
  # general                run /create and /resume from here, or anywhere
CONVERSATIONS              <- DISCORD_CATEGORY_ID
  # deploy-scripts         every message here is a turn
  # release-notes
```

**Deleting a channel** unbinds it; the conversation survives on the host and
`/resume <name>` reopens it in a fresh channel. That is also the answer when a
category fills up.

Recaps and `/sync` show only what a person typed and what Claude replied. Tool
calls, thinking, subagent output, and the wrappers Claude Code stores slash
commands in are left out, since none of it is conversation.

## Access

### Who is who

Admission is the security model. Three doors, each handing over more than the
last.

**1. The server.** Being in the Discord server. Anyone with no further access is
tier `none`: every message dropped in silence and every command refused with a
note only they can see, before anything reaches a session. Conversation channels
are invisible to them, and every command is hidden from their picker.
Administrators bypass the hiding and see the commands; the tier check still
refuses them.

**2. A conversation.** `/invite` lets someone see one conversation's channel, as
Discord permissions would. They can read it and talk in it. The bridge ignores
everything they send.

**3. The bot.** Operator access: their own conversations, their own workspace,
most of the command set. An owner grants it with `/operator add`, stored in
`data/operators.json`. Nothing else grants it.

**Owners sit above all three and are set on the host.** `DISCORD_OWNER_IDS` is
read from `.env` at startup, and no command adds or removes an owner, so nobody
inside Discord can promote anyone, whatever roles or server permissions they
hold. The bridge refuses to start when the list is empty or malformed, and
prints the owners it resolved. `/invite`, `/uninvite` and `/operator` are
owner-only: an operator drives the bot, it does not administer it.

Nothing set inside Discord grants use of the bridge. **Server Settings >
Integrations** can open a command to a role, which lets its holders see it and
send the interaction; the tier check still refuses them. That is also how an
operator who is not an administrator gets the commands in their picker.

### What a turn runs as

Every turn, from every tier, runs in `bypassPermissions` as the user the bridge
runs as, with that user's files, credentials, SSH keys and Claude plan. There
is no sandbox and no per-user restriction. `CLAUDE_TOOL_APPROVALS` puts an owner
in front of each step rather than behind it; approving a command approves it to
do anything that account can do. For containment, run the bridge in a container
or VM.

| Tier | Working directory | Can reach |
| --- | --- | --- |
| Owner | `PROJECTS_ROOT`, or any path given to `/create` | the whole machine |
| Operator | `WORKSPACES_ROOT/<their-user-id>/<name>` by default, or any path given | the whole machine |
| Nobody else | nothing | nothing |

The working directory is where a conversation starts, not a fence around it.
Operators cannot create conversations until `WORKSPACES_ROOT` is set.

**Inviting somebody to a conversation gives them your machine.** They can read
your files, use your credentials, spend your Claude plan, install software and
reach your network, as you. `/uninvite` closes the access; it does not undo what
was done with it.

**An account does not have to be handed over to be used.** A stolen Discord
session token authenticates on its own: no password, no second factor, no
notification, and token-stealing malware targets Discord specifically. Access is
granted to a device as much as to a person, and every account with access, an
owner's included, is another endpoint whose compromise reaches here. Two-factor
protects the login, not a session already taken from a running client.

Text from someone at door one reaches a turn only through `/ask` with
`context:N` or a reply that quotes them, fenced with a per-turn random marker
and labelled as data. The fence is not enforcement; treat `/ask` over a channel
strangers can post in as untrusted input.

Two things no sandbox would fix: anyone who can see a channel can read
everything already said in it, and every tier's turns run on the host's
subscription, which is account sharing the Anthropic terms do not permit. For a
team, run one bridge per person.

### Channel privacy

Channels made by `/create` and `/resume` deny `@everyone` View Channel and
allow only the owner, invited members and the bot; `/invite` and `/uninvite`
update the overwrites. This needs **Manage Roles**; without it the channel is
created, membership recorded, and the bot says everyone can see it. Server
administrators bypass channel permissions. That is Discord, not this bridge.

## Context, and what it costs

Anything fed into a session is written into its transcript and re-sent on every
later turn until compaction, so channel history is a recurring cost. Nothing is
included unless asked for:

| What you do | What the session receives | Cost |
| --- | --- | --- |
| Message in a bound channel | Your text | Nothing extra |
| `@bot <text>` | Your text plus one attribution line | One line |
| Reply to the bot | Your text; the bot's own message is already in the session | One line |
| Reply to someone else, addressing the bot | Plus the message you replied to | One message |
| `/ask context:30` | Plus the last 30 messages | What you chose, capped at 50 |

Replies use Discord's reply, threaded to the prompting message and not pinging.
Context names each speaker by id and the model is told not to tag whoever it is
answering; it may only ping ids that appeared in its context, and `@everyone`,
`@here` and role mentions are never parsed.

**What the session knows about Discord.** Every turn appends a short note to the
system prompt: that it is reached through Discord, that a message caps at 2000
characters so replies should aim well under it, that long output is better
written to this conversation's own `.discord-outbox/<session id>/` folder under
8 MB than split across messages, and that
the conversation may also be open in a terminal. The numbers are named because
without one there is nothing to aim at. The note applies to that run only and
never accumulates in the transcript; terminal sessions are unaffected. Beyond
it, a mention adds one line naming who is speaking and a reply adds the quoted
message. Nothing else about Discord reaches the model.

## Approving what a turn does

With `CLAUDE_TOOL_APPROVALS=true`, a turn asks before Claude runs a command,
edits a file, or fetches the web. The request appears in the channel naming the
tool and what it would do, with **Approve once**, **Deny** and **Approve the
rest of this turn**. Only an owner can answer; an operator who presses a button
is told so. Reading the working directory is never gated: `Read`, `Glob`,
`Grep`, `NotebookRead` and `TodoWrite` run without asking.

An unanswered request is denied after five minutes, everything still waiting is
denied when the turn ends, and a restart loses anything pending, which the model
sees as a denial. "Approve the rest of this turn" lasts exactly that long.

The gate is a `PreToolUse` hook, not a permission mode, because the host's own
allow rules in `settings.json` are consulted before a permission mode and would
silently open it; a hook is asked either way. A denial stops only the call it
was asked about. With the setting `false`, the default, every turn runs without
asking.

## Answering Claude's questions

When Claude wants a decision before it continues, it asks through the same tool
the terminal uses, and the questions arrive in the channel as select menus: one
per question, up to four, each holding the choices Claude offered with their
descriptions, plus **Other...** for an answer in your own words, which opens a
text box. A question that allows several picks lets you tick several. Picks are
kept until **Submit** sends the whole set, so a choice can still change; **Skip**
sends none. The message then collapses to what was answered. A follow-up
question is a new message with its own menus.

Anyone who can use the bot can answer: the question is about the work, not a
permission. Ten minutes without an answer, a skip, a `/stop`, or the turn ending
all tell Claude no answer came, and it continues on its own judgement saying what
it assumed. This works whether or not `CLAUDE_TOOL_APPROVALS` is set. A preview
Claude attaches to a choice shows as a code block under the question rather than
on hover.

## Claude Code commands

Anything starting with `/` that is not a bridge command is passed to the session
unchanged: `/compact`, `/context`, `/usage`, `/recap`, `/mcp`, `/config`,
`/autocompact`, and every skill and plugin command. The ones the session
reports as terminal-only (`/doctor`, `/color`, `/reload-plugins`) are refused
with an explanation; the list is read from the session, not hardcoded.

`/clear` is not passed through: in Claude Code it wipes the conversation's
memory, in a chat channel people expect it to clear messages, so the bridge
refuses it and names both, `/purge` for the channel and `/clear` in a terminal
for the session. `/model` and `/effort` are not passed through either, since
they apply to one process and every message here runs a new one; the bridge
stores them per conversation instead.

## A turn, start to finish

### Who may drive it

A conversation can only be driven by one process at a time. With nothing holding
it, a turn runs. Held by a background agent, the bridge refuses and offers
`/takeover`, which stops the agent and continues. Held by an open terminal, it
refuses naming the pid and directory; close that terminal or switch it to
another conversation. Every path that spends a turn is checked the same way.
Claude Code refuses this itself as well, so a race that gets past the check is
still caught. A turn this bridge is already running is not a collision: a
second message sent mid-turn queues rather than being turned away.

### Watching it

While a turn runs, one message is kept updated with how long it has been going,
how many steps it has taken, and what Claude has said along the way:

```
**Working** 1m 12s · 3 steps

Looking up how the generator picks a seed, then checking whether the docs match.

An existing test caught this: the note is re-sent on every turn, and the
addition pushed it past the cap.
```

Tool calls are counted, not listed. Reasoning cannot be shown: thinking arrives
over the stream with a signature and no text. Every turn is therefore asked to
think out loud, which costs tokens and is worth it, since progress you cannot
see is indistinguishable from a hang. A remark is shown whole. When the trail
would no longer fit in one message, or something lasting has been posted
beneath it, a question, an approval request, an attachment, the message is left
as it stands and the trail continues in a new one below, with the heading and
the Stop button moving down with it. The channel therefore reads in the order
things happened, the way the terminal scrolls, and nothing is rewritten above
something newer. Edits slow from every two seconds to every fifteen as a turn
drags, since each is an API call; a twenty minute turn costs around 138 edits.
Discord's typing indicator runs alongside.

When the turn ends the heading changes to **Worked**, the trail stays, and the
answer arrives as its own message beneath it, not repeated in the trail. A turn
whose only remark was the answer keeps no trail.

Discord draws no tables, and every turn is told so. A Markdown table that
arrives anyway is converted: two columns become a list with the first cell in
bold, more become an aligned code block with inline markup dropped, since it
would show as literal punctuation there.

References in the answer become links, written so that Discord adds no embed
beneath the message. A bare URL is kept clickable, a domain name becomes a link
to it, and when the working directory has an `origin` remote the repository's
own references do too: commit hashes, `#` numbers for pull requests and issues,
`!` numbers for merge requests on GitLab, branch and tag names written in code
spans, and file paths with an optional `:line` or `:from-to`. Each repository
reference is checked first, so a word that merely looks like a hash, or a path
that does not exist, stays plain text. GitHub, GitLab and Bitbucket get their
own link shapes, self-hosted GitLab included; any other host gets GitHub's,
which Gitea, Forgejo and Codeberg share. The trail gets the same links once a
message of it is final, not on the edits in between.

A turn is not time limited. Anything written to the conversation's outbox
folder is delivered as it appears, not only at the end, so a long job's output
arrives while it runs. A file is left alone until untouched for three seconds, and removed only
once the attachment has gone out.

A command Claude starts in the background keeps the turn open. Claude's first
answer, usually that it is waiting, shows in the trail, and when the command
finishes Claude picks up its output in a follow-up that is part of the same turn,
with tools working as they did before. The answer that lands beneath the trail
is the follow-up's. The Stop button ends both.

A command that a stop or a crash left running is reported by Claude Code at the
start of the next turn, and a process that opens with such a report refuses
every tool call. The bridge notices, discards that process before your message
reaches it, and starts another, which costs the turn a second or two and
nothing else.

### Stopping it

`/stop` and the **Stop** button are the equivalent of pressing escape in the
terminal. The turn ends at once, the log closes with "Stopped.", anything queued
behind it is dropped and the reply says how many, so one press ends the
conversation's activity. The transcript keeps the partial turn. Claude Code
treats the next message the way the terminal does after an escape, adding
"Continue from where you left off" to it; if that is not what you want, say so
in the message.

What a stop cannot promise is killing work already handed to the operating
system. The turn is killed with its process tree, which on Linux is its whole
process group. On Windows a shell command Claude started is commonly reparented
away from it, so a long `ping`, build or generation can outlive the stop and
has to be dealt with on the host; the reply says so. Anything deliberately
detached is untouched.

Stopping the bridge itself is different: `npm run stop` on the host lets every
turn in flight finish, queued messages included, and admits nothing new until
the bridge is back. A message sent meanwhile is answered with a notice saying
so. `npm run stop:now` ends the running turns the way `/stop` does, and each
progress message says "Stopped." If the bridge dies without either, killed or
crashed, the progress message it left behind is edited on its next start to say
it was interrupted, and the next message to that channel resumes the
conversation from where the transcript ends.

### Messages sent while it runs

A message sent mid-turn is queued and runs when the current one finishes. The
bot says how many are ahead of it, and `/queue` says so on demand. Five is the
ceiling; past that it refuses and points at `/stop`, rather than letting a
mistyped burst pile up turns you no longer want. A turn that fails does not
block what is queued behind it, and a queued message checks for drift only once
the turn ahead has ended and been marked seen.

### Branching it

`/fork` starts a new conversation from this one's current state, in its own
channel, and leaves this channel exactly as it was. The branch is a real
conversation: it appears in `/sessions`, resumes from the CLI, and carries the
model and effort of the one it came from. Claude Code mints its session id.

## Compaction and context

Compaction starting replaces the status line with a notice that counts elapsed
seconds, since compacting a large conversation takes minutes. Finishing posts
how many tokens went in, came out and were dropped, how long it took, and
whether it was manual or automatic.

Crossing 75% of the context window posts a quiet warning; 90% a louder one.
Each fires once and rearms after a compaction. The window is learned per
conversation, from the largest automatic compaction recorded in its transcript,
and no warning is issued until it is known; a manual `/compact` teaches nothing,
since it happens wherever it was asked for. `/context` remains the authoritative
figure.

**Transcript size is not context size.** A transcript is an append-only log of
everything that ever happened, including what compaction has dropped. Resuming
sends only what survives past the most recent compact boundary, so a transcript
of several hundred megabytes can hold a context of a few tens of thousands of
tokens and resuming it costs a normal turn. `/sessions` shows sizes because a
large one matters for disk.

## Attachments

Images, PDFs and text files dropped into a message are downloaded to a temporary
directory on the host and their paths handed to the session. Discord's URLs
expire, so they are fetched during the turn. An image or PDF is saved under the
extension its content type implies, so a WebP that arrived as `shot.png` lands
as `.webp`; text and source keep the name they were sent under. A file is kept
for an hour so a follow-up can still act on it, then swept. The download folder
is readable only by the account the bridge runs as, which matters where `/tmp`
is shared, and the bridge refuses to write there if the folder belongs to
somebody else.

Formats whose only purpose is to be run are refused and never downloaded:
`.exe`, `.msi`, `.dll`, `.scr`, `.lnk`, `.vbs`, `.jar` and similar, along with
anything over 25 MB. Source and scripts are deliberately still allowed,
including `.sh`, `.ps1` and `.py`, because reading them is the point. This is a
speed bump, not a boundary: what it removes is the one-step path from a file
somebody forwarded you to a file on your disk. A refusal is posted as a reply
under the message and stays; a message that was only a refused file spends no
turn.

**Files coming back.** Anything Claude writes into
`.discord-outbox/<session id>/` in the working directory is attached to its
reply and then removed, so a report, chart or diff arrives as a file. The
folder is per conversation, and the session's own is named in its system note,
because two conversations can share a working directory and one's files must
never land in the other's channel; a file dropped at the `.discord-outbox/`
root belongs to nobody and is left alone. A fork's first turn still writes to
the folder of the conversation it came from. Files over 8 MB and anything past
ten in one message are left in place and named once, not on every sweep. The
folders are removed once empty, so a repository does not accumulate an
untracked directory.

## Clearing a channel

`/purge` deletes every message in the channel, including yours, after a
confirmation button that removes itself afterwards. It cannot be undone. In a
conversation channel it does not touch the conversation: the transcript on the
host is the conversation and the channel is a view of it, so `/sync`
repopulates the channel and the next message picks up where the transcript left
off. Discord refuses to bulk delete messages older than 14 days, so those go
one at a time with a pause; the result says how many took the slow path and how
many could not be deleted.

## State on disk

| Path | What |
| --- | --- |
| `~/.claude/projects/<dir>/<uuid>.jsonl` | The conversation. Owned by Claude Code, only ever read by the bridge |
| `data/conversations.json` | Channel bindings, members, per-conversation settings |
| `data/operators.json` | Who an owner made an operator |
| `data/bridge.lock` | Prevents a second instance. Delete only if you are sure nothing is running |
| `data/bridge.log` | Autostart output, rotated at 5 MB to `bridge.log.1` |
| `<tmp>/claudetalk-attachments-<uid>/` | Attachment downloads, owner-only, swept an hour after the turn |

Deleting `data/` loses bindings and settings, never conversations.

## Running several bridges in one server

One bot serves one machine and one subscription. To share a server, each person
runs their own bridge with their own bot application, token, host and
subscription. Isolation comes from the tier check: a bridge ignores anyone who
is neither one of its owners nor one of its operators, so two bridges do not
answer each other's people even in a shared channel. Give each its own
`DISCORD_CATEGORY_ID` so conversation channels stay apart and neither auto-binds
inside the other's.

## Why not the built-in options

Claude Code's **Channels** push messages into a session that is already open,
and cannot create, list or resume one. **Remote Control** drives a local session
from claude.ai or the mobile apps, also needs the process alive, and its client
side is closed. This bridge starts from the other end: a conversation is a
transcript on disk, not a running process, so nothing needs to be open
beforehand and the same conversation stays resumable from the terminal
afterwards.

## Troubleshooting

**Slash commands don't appear.** The bot was invited without the
`applications.commands` scope. Re-open the invite URL; it updates in place.

**The bot replies to nothing.** Message Content Intent is off in the Developer
Portal, or unsaved. Without it every message arrives blank.

**"Another bridge is already running".** A second instance tried to start. Stop
the first, or delete `data/bridge.lock` if you are certain it is gone.

**"The only claude on PATH is a script shim".** Node cannot start `.cmd` or
`.bat` files directly on Windows. Set `CLAUDE_BIN` to the real executable,
usually `%USERPROFILE%\.local\bin\claude.exe`.

**The bridge refuses to start, saying Claude Code is signed out.** Run
`claude auth login` as the account the bridge runs as, then start it again. The
check reads `claude auth status --json`; output it cannot parse counts as unknown
and the bridge starts anyway, so a changed CLI cannot lock you out.

**A turn fails immediately with a spawn error.** Claude Code is not on the PATH
of the process running the bridge. Set `CLAUDE_BIN`.

**The bot answers twice.** Two instances are running. That is what the lock
prevents; a bridge started before the lock existed will not be caught by it.
