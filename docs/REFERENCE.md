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
| `/whoami` | O | What this channel is bound to, its model and effort, and the exact `claude --resume <id>` command for the host. A value the conversation does not override is shown as the host's default: what `~/.claude/settings.json` sets, with the conversation folder's own `.claude/settings.json` and `.claude/settings.local.json` laid over it as Claude Code lays them, or Claude Code's own default when none of them sets one. |
| `/spend` | O | Plan usage first, the 5-hour and weekly windows as Claude Code reports them with each turn, for the whole account; a window whose reset has passed with nothing reported since is shown as reset, not as the share last seen for it. Then turns and tokens for this conversation and for every conversation the bridge has touched since it last started; a restart resets those, and turns run in a terminal are never counted. The tokens are the session's own and leave out what its agents used, which the cost does include. An API-equivalent cost comes last, only for ranking conversations against each other: a subscription is not billed by it. Named `/spend` so Claude Code's own `/usage` and `/cost` still reach the session. |
| `/members` | O | The conversation's owner, who else can see its channel, and where it runs. |
| `/operator <add\|remove\|list> [user]` | H | Who may use the bot, and where each one comes from. |
| `/invite <user>` | H | Lets someone see this conversation's channel. Grants no use of the bot. |
| `/uninvite <user>` | H | Takes that visibility away again. |
| `/model [value]` | O | Shows or sets the model for this conversation. Persists across turns. Unset, it names the host default turns actually run with. |
| `/effort [value]` | O | Shows or sets the effort level. Persists across turns. Unset, it names the host default turns actually run with. |
| `/language [value]` | H | Shows or sets the language the bridge itself speaks, for the whole bridge. Claude's answers are not affected. See [Language](#language). |
| `/ask <prompt> [context:N]` | O | Asks with the last N channel messages as context. `N` is 1 to 50. A message with nothing written in it, an embed or an upload alone, is left out, and the reply says how many were taken. |
| `/sync` | O | Posts where you left off outside Discord: the latest few prompts and replies since you last saw it, with all of them attached as a file when there are more than fit in one message. Turns the bridge itself ran are marked seen when they end, so they never come back as drift. The bridge reads back the last 3 MB of a transcript; when more happened outside Discord than that holds, the count is said to be only the most recent. |
| `/skills` | O | Lists the bound session's skills, A to Z across up to five menus of twenty-five, and runs the one you pick. Past 125 the rest are counted and reachable by sending `/name` as a message. |
| `/run <command> [args]` | O | Runs one of the conversation's commands, skills or plugin commands, after showing exactly what will run and waiting for **Run** to be pressed. As you type, it searches what this conversation has, by name and description, with each command's arguments shown; whatever a plugin adds is listed without anything being registered. `args` is passed as you would type it after the command. |
| `/plugins` | H | Lists installed Claude Code plugins and toggles one. |
| `/purge` | O | Deletes every message in this channel after a confirmation. The conversation is kept. |
| `/clear` | O | Starts this channel over with a fresh conversation after a confirmation: same folder, model, effort and members, with none of what was said before. The previous conversation stays on the host. The channel's messages are kept. |
| `/stop [all]` | O | Kills the in-flight turn and its process tree; what is queued behind it runs next, so a correction sent while a wrong turn runs takes over once it is stopped. `all:true` drops the queue too. The transcript keeps the partial turn. A **Stop** button on the progress message does the same without typing, and a **Stop all** button appears beside it whenever something is queued. While agents or a cloud task are running there is also **Stop agents**, which stops them and leaves the turn going. |
| `/queue` | O | Says whether a turn is running here and how many messages are queued behind it. |
| `/takeover` | O | Stops a background agent holding this conversation, then continues. |
| `/category [name]` | O | Shows the category this conversation's channel is in, or moves it to one. Creates the category if it does not exist. |
| `/unbind` | O | Unbinds the channel at once, then offers to delete it or keep it for the history. The conversation stays on the host either way. It refuses while a turn is running or queued here, and says so in a channel that holds no conversation. A channel that only answered when the bot was tagged is unbound without the offer to delete it, and **Delete the channel** does nothing if the channel has been bound again since. |

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
one gate that rewrites home paths, so a path Claude mentions in prose or a
command is covered too. The home folder of the account running the bridge is
recognised in every spelling it appears in: either slash, the Git Bash form,
a `%20` for a space, the Windows 8.3 short name, and the dash-flattened folder
names Claude Code gives its projects under `~/.claude` and the temp folder.
All of them become `~`. Any other account's home, under `C:\Users`, `/home` or
`/Users`, has the account name replaced with `…`. Shared folders such as
Public stay as they are.

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

A conversation started this way, from a tag, stays a tag-only one for good. It
is titled after the channel, so tagging the bot there again after `/unbind`
finds it by that name and carries on, still answering tags only: the channel is
a shared one and its chatter is not for the session. Only that channel's own
name finds it; the start of another channel's name does not, and neither does a
channel elsewhere while it is open.

**Where a channel sits changes nothing about this.** `DISCORD_CATEGORY_ID` is
a way to file conversation channels, the default place a new one is created,
and carries no other meaning: a channel is a conversation's because it is
bound, in whatever category it sits, and a tag starts or finds one the same way
everywhere in the server. Commands work from anywhere too; they are gated by
who you are, not where you type.

```
Text Channels
  # general                run /create and /resume from here, or anywhere
CONVERSATIONS              <- DISCORD_CATEGORY_ID, where new channels land
  # deploy-scripts         bound, so every message here is a turn
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

**3. The bot.** Operator access: most of the command set, in every conversation
whose channel they can see. An operator is not held to conversations of their
own. They start new ones in a workspace of their own by default, and that is a
starting folder, not a wall: they can `/resume` any conversation on the host,
and they can drive, stop, clear or unbind any conversation whose channel
Discord shows them, an owner's included. What keeps one person's conversation
from another is the privacy of its channel and nothing in the bridge. An owner
grants operator access with `/operator add`, stored in `data/operators.json`.
Nothing else grants it.

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

`/run` reaches the same commands, and adds two things a typed message lacks.
One is finding them: Discord's own `/` list only ever shows the bridge's
commands, so `/run` searches the conversation's, plugin and skill commands
first, then Claude Code's own, each with its description and the arguments it
takes. A name the conversation does not have is refused before a turn is spent
on it. The other is being asked: `/run` replies with the exact line, what the
command does and what it takes, and nothing starts until **Run** is pressed. A
typed message stays the quick way and runs at once.

The terminal draws its own confirmations, and none of them reach Discord: Claude
Code sends a dialog only to a host that says it can show it, and otherwise acts
on the command's flags alone. So a command that asks before it acts in a
terminal is not run from a typed message here. `/code-review ultra`,
`/review ultra` and `/ultrareview` start a billed cloud review; typed as a
message they are turned away with the `/run` line to use instead, and through
`/run` the confirmation says what it will cost.

The command list is what Claude Code reported the last time a turn ran in that
folder, kept in `data/commands.json`, so it is there after a restart and a newly
installed plugin appears after the next turn. Before any turn has run in a
folder there is no list yet, and `/run` says so.

`/clear` is not passed through: every message here runs a new process resumed
against the bound session id, so the fresh session it would start is one the
channel could never reach. The bridge refuses it and points at its own
`/clear` command instead. `/model` and `/effort` are not passed through either, since
they apply to one process and every message here runs a new one; the bridge
stores them per conversation instead.

A command is judged by the name it goes by, whichever of its names was typed,
so an alias meets the same rule: `/reset` and `/new` are refused the way
`/clear` is, `/checkup` the way `/doctor` is, and `/review ultra` the way
`/code-review ultra` is. The aliases come from the same list Claude Code
reports for the folder. `/ask` with no context is held to all of it too, since
its prompt then reaches the session exactly as a typed message would. A refusal
is only posted when the message was for the bot: a command typed in a channel
it is not part of, or as a reply to another person, gets no answer.

## A turn, start to finish

### Who may drive it

A conversation can only be driven by one process at a time. With nothing holding
it, a turn runs. Held by a background agent, the bridge refuses and offers
`/takeover`, which stops the agent and continues. Held by an open terminal, it
refuses naming the pid and directory; close that terminal or switch it to
another conversation. Every path that spends a turn is checked the same way.
Claude Code refuses this itself as well, so a race that gets past the check is
still caught. A turn this bridge is already running is not a collision: a
second message sent mid-turn joins it or queues rather than being turned away.

### Watching it

While a turn runs, one message is kept updated with how long it has been going,
how many steps it has taken, and what Claude has said along the way. The message
that started the turn carries one reaction from the bot, changed as the turn
moves: eyes while it works, a clock while it waits on another turn, a
question mark while it waits on you, then a tick, a stop sign or a cross for
finished, stopped or failed. The heading carries the same state in front of the
verb, an hourglass while working. Those are the only emoji the bridge uses.

```
⏳ **Working** 1m 12s · 3 steps

Looking up how the generator picks a seed, then checking whether the docs match.

An existing test caught this: the note is re-sent on every turn, and the
addition pushed it past the cap.
```

When Claude hands work to agents, they are shown the way the terminal shows
them, that each is working, on what, and what it has spent, and in one place
only: a thread on the progress message, opened by the first agent and named
after what was asked of the turn, so a turn without agents never makes one and
one turn's thread can be told from another's. The thread holds one message kept up to date,
ten agents to a message, costing the model nothing since it is drawn from events
Claude Code already sends:

```
**1 · Explore** · find where sessions are indexed
Reading index.ts · 9 tools · 33.1k tokens

**2 · general-purpose** · write the fixtures
done in 1m 12s · 14 tools · 38.1k tokens
```

Each entry ends as done, failed or stopped with its totals, and an agent that
reports and is then sent back to work returns to running under the entry it
already has. An agent that reports while a command it started is still running
in the background reads as waiting on it, not as done. The trail stays the session's own: nothing about an agent appears
in it, not its edits, its commands, its report or a count, and the session
relays what its agents found in its own words. A task Claude Code runs in the
cloud, a cloud review for one, is listed the same way with the type `cloud`.

While any of them is running the progress message carries a **Stop agents**
button, or **Stop cloud task** when that is all there is. It stops each one
through the session, along with any command an agent left running in the
background, and an agent stopped this way is stopped again if Claude sends it
back to work. The turn is left running: Claude is told they were
stopped and carries on, which is what asking it to stop them would come to,
without the turn that asking costs. **Stop** ends the turn as before, with one
difference: killing the process would never reach a task running in the cloud,
which would go on being billed, so a running cloud task is told to stop first
and given a moment to close down before the turn is killed.

The thread needs the bot to hold
Create Public Threads and Send Messages in Threads. Without them, or in a place
Discord allows no thread, the progress message carries a short tally under its
heading instead, naming up to four running agents and counting the rest. A
message sent in the thread is ignored: it is a view, not a conversation. If the
bridge dies mid-turn, the progress message is marked interrupted but the thread
is left reading as it last did.

The session's own tool calls are counted as steps, an agent's are counted
against the agent in its roster, and the ones the terminal draws are drawn here too, from
the call's own input, so they cost the model nothing: an edit shows as a `diff`
block under its file's path, written as code so no character in a file name
turns into formatting, with the removed and added lines capped at two dozen and each line at 200 characters, since that is the
one tag Discord colours by line; a written file shows its first lines in a block
tagged with its language; a shell command shows as a `$` line in a `bash` or
`powershell` block. Reads and searches are only counted. Reasoning cannot be shown: thinking arrives over the stream with a
signature and no text. Every turn is therefore asked to think out loud, which
costs tokens and is worth it, since progress you cannot see is indistinguishable
from a hang. A remark keeps its paragraphs and code blocks, and one longer than
a message continues into the next rather than being cut short. When the trail
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
would show as literal punctuation there. A table quoted inside a code block is
code and is left as written.

Discord parses a whole message as one run of inline formatting, so an inline
code span, bold, italics, strikethrough, spoiler or link left open in one place
closes wherever the next matching marker sits: past blank lines, inside a code
block, in the next remark. Everything the bridge posts is checked against
Discord's own rules first, and a marker that cannot close within its own
stretch of text is escaped so it shows as the character it is. Each remark in
the trail and each exchange `/sync` posts is sealed on its own, since several
share one message. Code blocks are left exactly as written.

References in the answer become links, written so that Discord adds no embed
beneath the message. A bare URL is kept clickable, without the punctuation,
emphasis or brackets that stand around it, a link Claude writes itself keeps
its text with the target wrapped the same way, a domain name becomes a link to
it, and when the working directory has an `origin` remote the repository's
own references do too: commit hashes, a `#` number that the words before it
name as a pull request or merge request, `!` numbers for merge requests on
GitLab, branch and tag names written in code
spans, and file paths with an optional `:line` or `:from-to`. Each repository
reference is checked first, so a word that merely looks like a hash, or a path
that is not in the committed tree, stays plain text. A path is read from the
conversation's working directory and linked from the repository's root, so a
conversation in a folder below the root links correctly. A bare name ending in
`.sh` or `.app`, `deploy.sh` say, is a file far more often than a site and
stays text unless it has a subdomain or a path. A number on its own, or
after a word like issue, stays plain too: it is as often the third point of a
list as an item in a tracker. GitHub, GitLab and Bitbucket get their
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
terminal. The turn ends at once and the log closes with "Stopped." What was
queued behind it is kept and runs next, which is how you correct a turn that
went wrong: send the correction, press Stop, and the correction takes over.
**Stop all**, a second button that appears only while something is queued, and
`/stop all:true` drop the queue as well, and the reply says how many messages
went with it. The transcript keeps the partial turn. Claude Code treats the next
message the way the terminal does after an escape, adding "Continue from where
you left off" to it; if that is not what you want, say so in the message.

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

A plain message sent mid-turn is handed to the running turn, the way the
terminal takes one typed while Claude works. Claude takes it up at its next
step, between two tool calls, without what it is doing being cut short, and
answers it as part of the same turn: there is no second trail and no separate
reply. Your message carries a clock until it is taken up, then eyes, then
whatever the turn ends as. The notice that says it was handed over has a **Send
now** button. It cuts short the one step Claude is on, so the message runs at
once as the next turn, with the conversation so far still in front of it; Claude
is told that step was rejected, so say so if you want it run again. Agents and
background commands the turn had running are left running. The button only acts
while the message is still waiting; once taken up there is nothing to hurry, and
it says so. A turn that ends
with a message still waiting runs it next without being asked.

What is not a plain message still queues and runs as its own turn when the
current one finishes: a slash command, anything started by a bridge command
such as `/run` or `/ask`, and a message that arrives before the turn is under
way or as it is ending. The bot says how many are ahead of it, and `/queue`
says so on demand. Five is the ceiling; past that it refuses and points at
`/stop`, rather than letting a mistyped burst pile up turns you no longer want.
A turn that fails does not block what is queued behind it, and a queued message
checks for drift only once the turn ahead has ended and been marked seen.
**Stop** ends the turn and with it any message that joined it.

### Branching it

`/fork` starts a new conversation from this one's current state, in its own
channel, and leaves this channel exactly as it was. The branch is a real
conversation: it appears in `/sessions`, resumes from the CLI, and carries the
model and effort of the one it came from. Claude Code mints its session id.
If the branch's first turn cannot start, because the conversation is open in a
terminal, held by a background agent, or the bridge is shutting down, nothing
is branched and the channel made for it is removed again.

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
turn, and in a channel that held no conversation it binds none.

**Files coming back.** Anything Claude writes into
`.discord-outbox/<session id>/` in the working directory is attached to its
reply and then removed, so a report, chart or diff arrives as a file. The
folder is per conversation, and the session's own is named in its system note,
because two conversations can share a working directory and one's files must
never land in the other's channel; a file dropped at the `.discord-outbox/`
root belongs to nobody and is left alone. A fork's first turn still writes to
the folder of the conversation it came from. A file over 8 MB is left in place
and named once, not on every sweep. One message carries at most ten files and
24 MB in all; whatever does not fit goes out in the messages straight after it,
in the order the files are named in.
The folders are removed once empty, so a repository does not accumulate an
untracked directory.

## Clearing a channel

`/purge` deletes every message in the channel, including yours, after a
confirmation button that removes itself afterwards. It cannot be undone. In a
conversation channel it does not touch the conversation: the transcript on the
host is the conversation and the channel is a view of it, so the next message
picks up where the transcript left off. The channel does not get its history
back: `/sync` only posts what happened outside Discord since you were last
here. Discord refuses to bulk delete messages older than 14 days, so those go
one at a time with a pause; the result says how many took the slow path and how
many could not be deleted.

## Starting a conversation over

`/clear` is the bridge's version of Claude Code's `/clear`: after a confirmation
button, the channel is rebound to a new conversation in the same folder with the
same model, effort, members and mention-only setting, and Claude opens it with a
one-line hello. Nothing said in the previous conversation carries over; what
Claude Code keeps for the folder, its instruction and memory files, still loads. That
conversation stays on the host with its transcript intact; `/sessions` lists it
and `/resume` with its session id reopens it in a channel of its own. The
channel's messages are left as they are, so the history reads on; `/purge`
removes them if a clean channel is wanted too. It refuses while a turn is
running here. A message that was already on its way to the previous
conversation when the channel started over, still downloading a file say, is
not run against it: it is turned back with a note to send it again.

## Language

The bridge speaks one language at a time, for every channel and everyone in
them. English and Swedish ship today.

What follows the language is what the bridge itself says: its replies to
commands, its notices, the labels on its buttons and menus, the heading of a
turn's trail, the agents roster, a channel's topic, and its errors.

What does not:

- **Claude's answers.** Claude replies in whatever language you write to it,
  the way it does in the terminal, and the bridge does not steer that. Its
  first hello in a new conversation is asked for in English.
- **Command names and their descriptions** in Discord's command picker. They
  are the same in every language, as they are in the terminal.
- **What tools and Claude Code print**, and a system's own error text quoted
  inside one of the bridge's sentences.
- **The host's side**: the bridge log and the errors it stops on at startup.

`BRIDGE_LANGUAGE` in `.env` is the language a bridge starts in, English when
unset. `/language` picks one from Discord and answers in it. That pick is
stored in `data/language.json`, outlives a restart, and from then on wins over
`BRIDGE_LANGUAGE`; the bridge log says at startup which of the two it is
using. Delete the file and restart the bridge to go back to the `.env`
value.

A pick applies to everything said from then on. A turn already running keeps
the language it started in, so its trail does not change tongue halfway.

## State on disk

| Path | What |
| --- | --- |
| `~/.claude/projects/<dir>/<uuid>.jsonl` | The conversation. Owned by Claude Code, only ever read by the bridge |
| `data/conversations.json` | Channel bindings, members, per-conversation settings, and which conversations were started from a tag |
| `data/operators.json` | Who an owner made an operator |
| `data/language.json` | The language picked with `/language`. Absent until someone picks one |
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
`DISCORD_CATEGORY_ID` so their conversation channels are filed apart; that is
tidiness, not separation, which the tier check alone provides. Somebody who is
an operator of two bridges is answered by whichever bot they tag.

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

**The bridge stopped, logging "Another bridge holds the lock now".** A bridge
that does not refresh its lock for ninety seconds, because the machine slept or
the process was suspended, is taken for dead, and a second one may start. When
the first wakes and finds the lock is the other's, it stops at once, cutting
short any turn it was running, so that no message is answered twice. The other
carries on; nothing needs doing.

**"The only claude on PATH is a script shim".** Node cannot start `.cmd` or
`.bat` files directly on Windows. Set `CLAUDE_BIN` to the real executable,
usually `%USERPROFILE%\.local\bin\claude.exe`.

**The bridge refuses to start, saying Claude Code is signed out.** Run
`claude auth login` as the account the bridge runs as, then start it again. The
check reads `claude auth status --json`; output it cannot parse counts as unknown
and the bridge starts anyway, so a changed CLI cannot lock you out.

**A turn fails immediately with a spawn error.** Claude Code is not on the PATH
of the process running the bridge. Set `CLAUDE_BIN`.

**A turn fails saying Claude Code has no conversation under the session id.**
The channel is bound to a session whose transcript is no longer on the host:
Claude Code removes old ones on its own schedule, or the conversation's first
turn ended before one was written. Nothing can resume it, so `/clear` starts a
fresh conversation in the same channel and folder.

**The bot answers twice.** Two instances are running. That is what the lock
prevents; a bridge started before the lock existed will not be caught by it.
