# Security

Every turn the bridge runs has the host user's files, credentials and Claude
plan, so a flaw in who it lets in is a way onto someone's machine. Please
report one privately.

## Reporting a vulnerability

Use [private vulnerability reporting](https://github.com/Guappa/claudetalk/security/advisories/new)
on this repository. Do not open a public issue or a pull request about it
first.

Include what an attacker needs (an account in the server, an operator, a
crafted message), the steps that reproduce it, and the bridge and Claude Code
versions that `/whoami` prints in its footer.

The bridge is maintained by one person in their own time. A report is read
and answered as soon as that allows, with no promised turnaround. A confirmed
flaw is fixed on `main` and released under a new tag, and the advisory is
published once the fix is out.

## Supported versions

An install is a clone of `main` or the container image of a tag. Only the
latest tag and `main` receive fixes; update before reporting if you are behind.

## What counts

- Anyone below operator getting a message or a command through to a session:
  a server member with no access, someone added with `/invite`, a Discord
  administrator, or a role a command was opened to in Server Settings.
- An operator doing what only an owner can: `/invite`, `/uninvite` or
  `/operator`.
- Anyone inside Discord changing who the owners are. Owners are set on the
  host only.
- The bot token, the host's Claude Code login or the contents of `.env`
  reaching Discord, a log another user can read, or the container image.
- A turn getting past the `secrets` or `keys` rule of `TOOL_DENIALS` through an
  edit tool or the Read tool. Those two are judged by tool and path and are
  meant to hold however the path is spelled.

## What does not

These are the documented trust model, described in the README and in
[docs/REFERENCE.md](docs/REFERENCE.md#access), not flaws in it:

- An owner or operator running anything the host user could. There is no
  sandbox, and making someone an operator gives them the machine.
- A shell command that gets past a `TOOL_DENIALS` rule by being spelled
  another way, or a script that does what a refused command would. The
  rules that read a command's text catch its obvious forms only, and guard
  against an accident, not a determined user.
- A stolen Discord session of someone who already has access.
- An operator resuming or driving a conversation that is not theirs. Operators
  are not held to their own conversations; what keeps one apart is the
  privacy of its channel.
