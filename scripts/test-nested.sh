#!/bin/bash
# Runs the extension from this checkout in a nested GNOME Shell window, with
# throwaway settings, so the real session is left alone. Close the window to
# stop it. SIZE=WxH changes the window size.
set -eo pipefail

repo=$(dirname "$(dirname "$(realpath "$0")")")
uuid=workspace-thumbnail-titles@tguillem
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/data/gnome-shell/extensions"
ln -s "$repo" "$tmp/data/gnome-shell/extensions/$uuid"

export XDG_CONFIG_HOME="$tmp/config" XDG_DATA_HOME="$tmp/data" XDG_STATE_HOME="$tmp/state"
export MUTTER_DEBUG_DUMMY_MODE_SPECS="${SIZE:-1920x1080}"
export UUID="$uuid"

# The full log goes to nested-shell.log; problems are also printed here.
status=0
dbus-run-session -- sh -c '
    gsettings set org.gnome.shell enabled-extensions "[\"$UUID\"]"
    gsettings set org.gnome.shell welcome-dialog-last-shown-version "999"
    exec gnome-shell --nested --wayland
' 2>&1 | tee "$repo/nested-shell.log" |
    { grep --line-buffered -iE -A5 "JS ERROR|Gjs-CRITICAL|allocation cycle|$uuid" || true; } ||
    status=$?

if [ "$status" -ne 0 ]; then
    echo "GNOME Shell exited with status $status, see $repo/nested-shell.log" >&2
fi
exit "$status"
