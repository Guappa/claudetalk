#!/usr/bin/env bash
# Registers a launchd user agent that starts the bridge when you log in.
set -euo pipefail

# launchctl exists only on macOS, and a clear refusal beats a missing command on any other host.
if [ "$(uname -s)" != "Darwin" ]; then
  echo "This registers a launchd agent, which only macOS has." >&2
  echo "On Linux use scripts/install-autostart.sh; on Windows use scripts/install-autostart.ps1." >&2
  exit 1
fi

action="${1:-install}"
label="com.claudetalk.bridge"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agent_dir="$HOME/Library/LaunchAgents"
plist_path="$agent_dir/$label.plist"
log_path="$project_root/data/bridge.log"
# A headless session has no GUI domain, so the per-user one is the fallback rather than a failure.
if launchctl print "gui/$(id -u)" >/dev/null 2>&1; then
  domain="gui/$(id -u)"
else
  domain="user/$(id -u)"
fi

# A path holding & or < would otherwise produce a plist that parses as an empty job.
xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

# bootstrap and bootout are the supported pair; load and unload are kept for older systems only.
load_agent() {
  launchctl bootstrap "$domain" "$plist_path" 2>/dev/null || launchctl load -w "$plist_path"
}

unload_agent() {
  launchctl bootout "$domain/$label" 2>/dev/null || launchctl unload -w "$plist_path" 2>/dev/null || true
}

case "$action" in
  status)
    if [ ! -f "$plist_path" ]; then
      echo "Not installed. Run: scripts/install-autostart-macos.sh"
      exit 0
    fi
    launchctl print "$domain/$label" 2>/dev/null || echo "Installed but not loaded. Log in again, or reinstall."
    echo
    echo "Logs: tail -f $log_path"
    ;;

  uninstall)
    if [ ! -f "$plist_path" ]; then
      echo "Nothing to remove; $label is not installed."
      exit 0
    fi
    unload_agent
    rm -f "$plist_path"
    echo "Removed $label. The bridge will not start on its own any more."
    echo "It is still running if you started it by hand; use npm run stop."
    ;;

  install)
    [ -f "$project_root/.env" ] || {
      echo "No .env in $project_root. Copy .env.example and fill it in before installing autostart." >&2
      exit 1
    }

    node_bin="$(command -v node || true)"
    [ -n "$node_bin" ] || {
      echo "node is not on PATH. Install Node 22.12 or newer, then run this again." >&2
      exit 1
    }

    [ -d "$project_root/node_modules" ] || {
      echo "Dependencies are not installed. Run npm ci in $project_root first." >&2
      exit 1
    }

    mkdir -p "$agent_dir" "$project_root/data"

    # A launchd agent inherits almost no PATH, and the bridge has to find the claude executable.
    agent_path="$HOME/.local/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

    escaped_node="$(xml_escape "$node_bin")"
    escaped_root="$(xml_escape "$project_root")"
    escaped_log="$(xml_escape "$log_path")"
    escaped_path="$(xml_escape "$agent_path")"

    cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>$escaped_node</string>
        <string>--env-file-if-exists=.env</string>
        <string>--experimental-strip-types</string>
        <string>src/index.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$escaped_root</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>$escaped_log</string>
    <key>StandardErrorPath</key>
    <string>$escaped_log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$escaped_path</string>
    </dict>
</dict>
</plist>
PLIST

    # A malformed plist is loaded as an empty job and fails silently, so it is checked before loading.
    if command -v plutil >/dev/null 2>&1; then
      plutil -lint "$plist_path" >/dev/null || {
        echo "The generated agent at $plist_path is not valid. Remove it and report this." >&2
        exit 1
      }
    fi

    unload_agent
    load_agent

    echo "Installed $label."
    echo "Starts when you log in, restarts if it exits badly, waits 10s between tries."
    echo "A launchd agent is not a boot service: it starts at login, not before you sign in."
    echo "Logs:   tail -f $log_path"
    echo "Status: scripts/install-autostart-macos.sh status"
    echo "Remove: scripts/install-autostart-macos.sh uninstall"
    ;;

  *)
    echo "Usage: scripts/install-autostart-macos.sh [install|status|uninstall]" >&2
    exit 1
    ;;
esac
