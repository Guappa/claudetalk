<h1 align="center">ClaudeTalk</h1>

<h3 align="center">A Discord bot for Claude Code: your sessions, on your own machine, from any device</h3>

<p align="center">
  <img src="docs/assets/header.webp" alt="ClaudeTalk" width="700">
</p>

<p align="center">
  <a href="https://github.com/Guappa/claudetalk/tags"><img alt="version" src="https://img.shields.io/github/v/tag/Guappa/claudetalk?label=version"></a>
  <a href="https://github.com/Guappa/claudetalk/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/Guappa/claudetalk/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A522.12-brightgreen">
  <img alt="platforms" src="https://img.shields.io/badge/platforms-windows%20%7C%20linux%20%7C%20macos-lightgrey">
  <a href="https://github.com/Guappa/claudetalk/pkgs/container/claudetalk"><img alt="image" src="https://img.shields.io/badge/image-ghcr.io%2Fguappa%2Fclaudetalk-blue"></a>
</p>

ClaudeTalk is a self-hosted Discord bot that runs Claude Code on your own
machine. Each Discord channel is one Claude Code conversation: message the
channel and the conversation resumes on your machine, whether or not a terminal
is open for it. Close the terminal, carry on from your phone, then open the same
conversation in the CLI later with all of it there. The conversation lives in
Claude Code's own transcript, so nothing here owns it.

## What it does

| Feature | What it does |
| --- | --- |
| A conversation per channel | Message a channel and its conversation resumes on your machine, with or without a terminal open for it. |
| Resume in the terminal | `claude --resume <id>` opens in the terminal what Discord worked on. `/whoami` gives the command. |
| Start, reopen, branch | `/create` starts a conversation in a project folder, `/resume` opens an existing one in its own channel, `/fork` branches one, `/sessions` lists what is on the host. |
| Takeover | A conversation left open in an idle terminal is freed from Discord with `/takeover`, and the message you sent runs. |
| Live trail | What Claude is doing as it does it: commands, edits, searches, and a line per agent with how it ended. |
| Question menus | Claude's questions arrive as select menus with the choices it offered and a field for your own words. |
| Stop and steer | A **Stop** button ends a turn. A message sent while one runs is handed to it and taken up at its next step, or at once with **Send now**. |
| Pings | A mention when a long turn finishes, fails or needs you, and only if you have been away. |
| Files both ways | Attach files to a message. Claude sends files back by writing them to a folder. |
| Claude Code's commands | Skills, plugin commands and Claude Code's own slash commands, through `/run` and `/skills`. |
| Plugins and MCP servers | `/plugins` toggles a plugin. `/mcp` shows what each MCP server is doing and switches one off or on, or reconnects it. |
| Access control | Owners are set in `.env`, operators are added from Discord, and everyone else is ignored. A channel is private to whoever created it until someone is invited. |
| Tool approvals | Optional: an owner approves each command, edit and fetch from the channel. |
| Guard rules | Seven kinds of call are caught before they run. Five are refused, such as a force push to `main`. A recursive delete, or a file written, outside the conversation's folder asks an owner first. |
| Turn limit | Optional: a turn stops by itself after a set number of model calls, and the next message carries on from it. |
| Context and usage | A warning before a conversation fills its context, the figure in `/whoami`, and plan usage with `/spend`. |
| Model and effort | `/model` and `/effort` per conversation, kept across turns. |
| Runs as a service | Windows, Linux and macOS, starting with the machine, or a [container image](#in-a-container) for amd64 and arm64 with a compose file. |
| Restart from Discord | `/restart` checks that the code on the host would start, restarts once nothing is running, and says when it is back. |
| Update notice | An owner is told in Discord when a newer version has been tagged, at most once a week. |
| Six languages | The bridge speaks English, German, Spanish, French, Swedish and Simplified Chinese, picked with `/language` or `BRIDGE_LANGUAGE`. Claude answers in whatever language you write. |

There is no sandbox: a turn runs as you, with your rights. For a fence around
it, run the [container image](#in-a-container), where a session reaches only
what you mount into it and the network. Read
[Security](#security-read-this-first) before running it for anyone but yourself.

## Quick start

You need Node 22.12 or newer, Claude Code signed in (`claude auth login`), and a
Discord server you administer.

1. [Create the Discord bot](#setting-up-the-discord-bot) and add it to your
   server. That gives you the bot token, the server id and your own user id.
2. Get the code:
   ```bash
   git clone https://github.com/Guappa/claudetalk.git
   cd claudetalk
   npm ci
   ```
3. Copy `.env.example` to `.env` and fill in the four required values:
   `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_OWNER_IDS` and
   `PROJECTS_ROOT`, the folder your projects live in.
4. Start it with `npm run dev`. To have it start with the machine, see
   [Running](#running); for Docker, see [In a container](#in-a-container).
5. In Discord, run `/create` with a name. It makes a channel for a new
   conversation: send a message there and Claude Code answers from your machine.

## How it differs from the built-in options

Claude Code's **Channels** push messages into a session that is already open,
and cannot create, list or resume one. **Remote Control** drives a local session
from claude.ai or the mobile apps, and also needs the process alive. ClaudeTalk
starts from the other end: a conversation is a transcript on disk, not a running
process, so nothing has to be open beforehand, and the same conversation stays
resumable from the terminal afterwards.

It is built on the Claude Agent SDK and kept on its current release. Every
change runs through CI on Ubuntu and Windows before it lands, and versions are
tagged as they ship.

**What it is not:** a multi-tenant service, a bot for a public server, or a
front end for other models. It is for the person who runs it and the people
they choose to let in.

Every command and behaviour is in [docs/REFERENCE.md](docs/REFERENCE.md).

## Requirements

- Node 22.12 or newer
- Claude Code, signed in with a claude.ai subscription (`claude auth login`). Sign in as
  the same account the bridge runs as: it refuses to start against a signed-out
  Claude Code, since every turn would fail the moment anyone sent one
- A Discord server you administer

Turns run through `@anthropic-ai/claude-agent-sdk`, which `npm ci` installs and
which brings its own build of Claude Code to run them on. The `claude` you
installed is what the bridge asks for the side jobs: which sessions are open on
the host, stopping a background one, and listing plugins. The two share your
sign-in and your conversations, and can be different versions; the bridge prints
both at start-up and in `/whoami`, and says so when they differ, since that is
the first thing to check if resuming breaks after an update. This bridge is MIT; that
package is not, so using it means accepting
[Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance). That
is the same agreement Claude Code itself is under, so it asks nothing new of
you, but a fork should know it is there.

## Security, read this first

**There is no sandbox.** Every turn runs as the user the bridge runs as, with
your files, credentials, SSH keys and Claude plan. Setting
`CLAUDE_TOOL_APPROVALS=true` makes an owner approve each command, edit and fetch
from Discord first, which shows you every step without limiting what a step may
do.

**A few things are stopped whatever you set.** Seven kinds of call are caught
before they run: five are refused outright, such as a force push to `main` or a
download piped into a shell, and two are put to an owner in the channel first, a
recursive delete outside the conversation's folder and a file written outside it
by a file tool. This catches an accident and a careless model. It is not
containment: the rules that read a shell command know its obvious spellings and
no others, and a script can do what a refused command would have. Claude Code's
own sandbox is not offered, because it does not exist on every platform the
bridge runs on. [What is stopped, and how](docs/REFERENCE.md#approving-what-a-turn-does)
has each rule and its limits.

**Only owners and operators can use it.** Everyone else is ignored: messages
dropped, commands refused, nothing reaching a session. `/invite` lets someone see
a conversation's channel and talk in it, and grants no use of the bot.

**Owners are set on the host**, in `DISCORD_OWNER_IDS`, and nothing inside
Discord can add or remove one. An owner is the only one who can make somebody an
operator, with `/operator add`.

**Making someone an operator gives them your machine.** It is the same as leaving
them alone at your unlocked PC.

**A compromised account is a way in, and 2FA does not close it.** A stolen
Discord session token is enough on its own: it carries no password prompt and no
second factor. Token-stealing malware targets Discord specifically and is common.
Every account with access is another machine that has to stay clean, not just
another person you have to trust. That includes your own.

**Enable two-factor authentication** on the Discord account that owns the bot
application anyway. For containment, run the bridge in a container or VM.

Every turn runs against the host's Claude subscription. Sharing that is not
something the Anthropic terms permit; for a team, run one bridge per person.

The full access model is in [docs/REFERENCE.md](docs/REFERENCE.md#access). To
report a vulnerability, see [SECURITY.md](SECURITY.md).

## Setting up the Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   and click **New Application**. Name it whatever you like.
2. Open the **Bot** tab. Click **Reset Token**, then copy the token. This is
   `DISCORD_BOT_TOKEN`. It is shown once.
3. Still on the **Bot** tab, scroll to **Privileged Gateway Intents** and enable
   **Message Content Intent**. Without it the bot receives empty messages.
4. Open **OAuth2 > URL Generator**. Tick the `bot` and
   `applications.commands` scopes, then tick these bot permissions:
   View Channels, Manage Channels, Manage Roles, Manage Messages, Send Messages,
   Create Public Threads, Send Messages in Threads, Read Message History, Attach
   Files, Add Reactions.
   Manage Channels lets `/create` make a channel per conversation; Manage Roles
   is what makes that channel private to you; Manage Messages is what lets
   `/purge` delete messages that are not the bot's own, and a channel cannot be
   made without it, since the bot gives itself that permission there; the two
   thread permissions let a turn that uses agents list them in a thread.
5. Open the generated URL and add the bot to your server.
6. In Discord, enable **Settings > Advanced > Developer Mode**. Then right-click
   your server for **Copy Server ID** (`DISCORD_GUILD_ID`) and right-click
   yourself for **Copy User ID** (`DISCORD_OWNER_IDS`).

## Configuration

```bash
cp .env.example .env
```

| Variable | What it is |
| --- | --- |
| `DISCORD_BOT_TOKEN` | From step 2 above |
| `DISCORD_GUILD_ID` | The one server the bot answers in |
| `DISCORD_OWNER_IDS` | Who owns the bridge, comma separated. Full access, and the only ones who can add an operator. Cannot be changed from Discord |
| `DISCORD_CATEGORY_ID` | Optional. The category new conversation channels are created in. It only files them; where a message is acted on does not depend on it |
| `WORKSPACES_ROOT` | Optional. Parent folder for per-operator workspaces. Required before other operators can create conversations |
| `PROJECTS_ROOT` | Filesystem path. Folder new conversations are created under by default. Not a Discord channel |
| `CLAUDE_BIN` | Optional, path to `claude` if it is not on PATH |
| `CLAUDE_TOOL_APPROVALS` | Optional, `false` by default. `true` asks an owner in Discord before each command, file edit or web fetch |
| `TOOL_DENIALS` | Optional, all seven rules by default. What a turn is refused outright, or has to ask an owner for, approvals on or off: `deletes`, `writes`, `force-push`, `secrets`, `keys`, `download-run`, `machine`, or `none`. `.env.example` says what each refuses |
| `PING_AFTER_SECONDS` | Optional, `120` by default. How long you may have been away from a turn before its answer, a failure, a question or an approval request pings you. `0` never pings |
| `CLAUDE_MAX_TURNS` | Optional, unset by default. How many times one turn may go back to the model before Claude Code stops it. A stopped turn loses nothing, and the next message carries on from it. Unset, a turn runs as long as it needs |
| `UPDATE_CHECK` | Optional, `true` by default. Once a day the bridge reads this repository's tags on GitHub and says when a newer version is out: in its log, in `/whoami`, and to an owner in Discord at most once a week. It installs nothing. `false` makes no such request |
| `BRIDGE_LANGUAGE` | Optional, `en` by default. The language the bridge itself speaks: `en`, `de`, `es`, `fr`, `sv` or `zh`. `/language` changes it from Discord. Claude's answers are not affected |
| `BINDINGS_PATH` | Optional, defaults to `data/conversations.json`. Its folder is where every other state file lives too: the lock, the language, the command cache, the active turns and, unless set apart, the operators |
| `OPERATORS_PATH` | Optional, defaults to `operators.json` beside the bindings |

## Running

```bash
npm ci
```

Then install it as a background service. A terminal is for trying it out.

**Windows** (registers a scheduled task, asks for administrator rights, then
continues in the elevated window it opens)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Action status
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Action uninstall
```

Starts 30 seconds after boot and after logon, retries three times if it exits,
and writes to `data/bridge.log`. It runs windowless, as you, with no desktop
session.

**Linux** (writes a systemd user service and enables lingering)

```bash
scripts/install-autostart.sh
scripts/install-autostart.sh status
scripts/install-autostart.sh uninstall
```

Starts at boot without you logging in, restarts on failure, gives up after five
failures in five minutes. Logs:
`journalctl --user -u claudetalk.service -f`.

**macOS** (writes a launchd user agent)

```bash
scripts/install-autostart-macos.sh
scripts/install-autostart-macos.sh status
scripts/install-autostart-macos.sh uninstall
```

Starts when you log in, restarts if it exits badly, waits ten seconds between
tries. Logs: `tail -f data/bridge.log`. Unlike the Linux service this is a login
agent, not a boot service, so it does not run before you sign in. Running the
Linux script on macOS refuses and points here, since macOS has no systemd.

CI installs, reports and removes this agent on a real macOS runner, so the plist
is known to be one `launchctl` accepts. What no machine here has done is log
into a Mac desktop and watch it come up after a reboot, so the GUI session and
the login-time start are the parts still taken on trust.

To try it in a terminal instead:

```bash
npm run dev      # start it here
npm run stop     # stop whichever instance is running
```

Only one bridge may run at a time; a lock file prevents a second. Stop it with
`npm run stop` rather than killing it. That waits for any turn in flight,
queued messages included, admits nothing new meanwhile, and says what it is
waiting on. `npm run stop:now` cuts running turns short instead, and their
progress messages end with "Stopped." The Linux service and the macOS agent
treat their own stop the same way, with a thirty minute ceiling before the
system kills the bridge; the Windows task's own stop kills it at once, so use
`npm run stop` there. If the bridge is killed anyway, a progress message it left
mid-turn is marked as interrupted the next time it starts.

`npm run restart`, or `/restart` from Discord, restarts a bridge that a
service runs: it checks that the code and `.env` on disk would start, waits
until nothing is running, and has the service start the bridge again, which
then says in Discord that it is back. See
[Restarting it](docs/REFERENCE.md#restarting-it).

Both platforms run the bridge straight from `src/`. Node strips the types, so
there is no build step.

### In a container

For a machine that is always on, a server, a NAS, a Raspberry Pi, or a desktop
with Docker Desktop, there is an image instead of a clone:
`ghcr.io/guappa/claudetalk`, tagged by version and `latest`, built for amd64
and arm64 on every tag. It holds the bridge, Node, git and the build of Claude
Code the Agent SDK ships, and nothing else; the `claude` on its PATH is that
same build.

```bash
docker volume create claudetalk-data claudetalk-claude
docker run -d --name claudetalk --restart unless-stopped --stop-timeout 1800 \
  --user "$(id -u):0" \
  -e DISCORD_BOT_TOKEN=... -e DISCORD_GUILD_ID=... -e DISCORD_OWNER_IDS=... \
  -v claudetalk-data:/app/data \
  -v claudetalk-claude:/home/node/.claude \
  -v /srv/projects:/projects \
  ghcr.io/guappa/claudetalk:latest
docker exec -it claudetalk claude auth login
```

The three mounts are the bridge's state (`/app/data`), Claude Code's sign-in
and conversations (`/home/node/.claude`) and the folder the conversations work
in (`/projects`, which is `PROJECTS_ROOT` inside the image). The sign-in is done
once, inside the container, with the command above; it stays in its volume.
The image runs as uid 1000; `--user` runs it as you instead, so the files Claude
writes into your projects are yours, and the `0` is the group that lets any uid
write the image's own folders. Files a session leaves for Discord go in
`.discord-outbox/` inside its project folder, so they need no mount of their
own. Any other setting from the table above is passed with `-e`. Logs are
`docker logs claudetalk`. `docker stop` is the same drain as `npm run stop`, so
give it the same ceiling the services get; Docker's default grace is ten
seconds and would kill a turn mid-flight.

With Compose, [`compose.yaml`](compose.yaml) is the same thing written down.
Put it in a folder beside a `.env` made from `.env.example`, add a line
`PROJECTS_DIR=` naming the folder your projects live in, and:

```bash
docker compose up -d
docker compose exec claudetalk claude auth login
```

It runs as uid 1000; if `id -u` says otherwise, add `CLAUDETALK_UID=` with that
number to the same `.env`. `PROJECTS_ROOT` in that file is not used: inside the
container the projects are always at `/projects`. `docker compose down` drains
the same way, with the thirty minutes already set.

What is different inside a container, said plainly:

- The conversations are a fresh set. Nothing from a terminal on the host is
  seen, and `/sessions` lists only what the bridge made, because the container
  has its own `~/.claude` and its own paths.
- Claude runs your projects' commands with the tools in the image, which are
  git and Node. For anything else, extend it:

  ```dockerfile
  FROM ghcr.io/guappa/claudetalk:0.22.0
  USER root
  RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
  USER 1000:0
  ```

- The container is a fence, not a sandbox. It limits what a session can reach
  to what you mount into it and to the network; within that it runs with the
  same rights as on a host, and nothing asks before a command runs unless the
  approval gate is on. What is mounted is fully exposed: the projects, and the
  sign-in in `~/.claude`. Do not mount the Docker socket, and do not run it as
  root.

## Commands

`/create` makes a channel and starts a conversation in it. `/resume` does the
same for one that already exists on the host. `/fork` branches one. `/sessions`
lists them. `/invite` shares one with someone else.

**[docs/REFERENCE.md](docs/REFERENCE.md) is the full list**: every command, who
may run it, the access model, what context costs, collision rules, and
troubleshooting.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the tests, the workflow and the
constraints worth knowing before changing anything.

## Licence

MIT
