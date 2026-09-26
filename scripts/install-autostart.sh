#!/usr/bin/env bash
# Registers a systemd user service that starts the bridge at boot.
set -euo pipefail

# macOS has no systemd, and systemctl would otherwise fail as an unexplained missing command.
if [ "$(uname -s)" = "Darwin" ]; then
  echo "This installs a systemd service, which macOS does not have." >&2
  echo "Use scripts/install-autostart-macos.sh instead; it registers a launchd agent." >&2
  exit 1
fi

action="${1:-install}"
unit_name="claudetalk.service"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit_path="$unit_dir/$unit_name"

case "$action" in
  status)
    if [ ! -f "$unit_path" ]; then
      echo "Not installed. Run: scripts/install-autostart.sh"
      exit 0
    fi
    systemctl --user status "$unit_name" --no-pager || true
    echo
    echo "Logs: journalctl --user -u $unit_name -f"
    ;;

  uninstall)
    if [ ! -f "$unit_path" ]; then
      echo "Nothing to remove; $unit_name is not installed."
      exit 0
    fi
    systemctl --user disable --now "$unit_name" 2>/dev/null || true
    rm -f "$unit_path"
    systemctl --user daemon-reload
    echo "Removed $unit_name. The bridge will not start on its own any more."
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

    mkdir -p "$unit_dir"
    cat > "$unit_path" <<UNIT
[Unit]
Description=ClaudeTalk bridge
Documentation=file://$project_root/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$project_root
ExecStart=$node_bin --env-file-if-exists=.env --experimental-strip-types src/index.ts
Restart=on-failure
RestartSec=10
# A stop waits for the turn in flight; a turn can run for many minutes, and a kill would cut it short.
TimeoutStopSec=1800
# A missing token fails the same way every time, so stop rather than loop on it forever.
StartLimitIntervalSec=300
StartLimitBurst=5
# A systemd unit inherits almost no PATH, and the bridge has to find the claude executable.
Environment=PATH=%h/.local/bin:%h/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
UNIT

    systemctl --user daemon-reload
    systemctl --user enable --now "$unit_name"

    # Without lingering a user service stops at logout and never starts at boot.
    if ! loginctl show-user "$USER" --property=Linger 2>/dev/null | grep -q "Linger=yes"; then
      echo "Enabling linger so it runs without you logged in (may prompt for sudo):"
      sudo loginctl enable-linger "$USER" || echo "  could not enable linger; it will only run while you are logged in."
    fi

    echo "Installed $unit_name."
    echo "Starts at boot, restarts on failure, gives up after 5 failures in 5 minutes."
    echo "Logs:   journalctl --user -u $unit_name -f"
    echo "Status: scripts/install-autostart.sh status"
    echo "Remove: scripts/install-autostart.sh uninstall"
    ;;

  *)
    echo "Usage: scripts/install-autostart.sh [install|status|uninstall]" >&2
    exit 1
    ;;
esac
