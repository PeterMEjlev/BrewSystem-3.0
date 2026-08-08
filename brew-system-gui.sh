#!/bin/sh
# Open the brewing GUI from the Pi's desktop.
#
# The kiosk normally starts itself at login (see the autostart file in
# README.md). This is for afterwards: after Ctrl+Shift+Q, or after a crash, it
# brings the window back without anyone having to find a keyboard and a
# terminal. Installed as a desktop icon by install-desktop-icon.sh.
#
# Clicking it while the app is already running raises that window rather than
# starting a second kiosk — two Electron windows driving the same 8.5 kW
# elements is not a state worth allowing.
#
# It does not touch the hardware, and it never restarts the backend that is
# already running: brewing continues while the GUI comes and goes.

set -u

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SERVICE=brew-system.service
BACKEND_URL=http://localhost:8000/
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/brew-system"
LOG="$LOG_DIR/gui-launcher.log"
LOCK="${XDG_RUNTIME_DIR:-/tmp}/brew-system-gui.lock"

mkdir -p "$LOG_DIR" 2>/dev/null || true

log() {
    printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG" 2>/dev/null || true
}

# Say it on screen as well as in the log. A desktop icon that fails silently
# looks like a broken icon, which is the one outcome worth ruling out.
tell_user() {
    log "$1"
    if command -v notify-send >/dev/null 2>&1; then
        notify-send "Brew System" "$1" 2>/dev/null || true
    elif command -v zenity >/dev/null 2>&1; then
        zenity --info --title="Brew System" --text="$1" --timeout=15 2>/dev/null || true
    fi
}

# --- is it already running? -------------------------------------------------

# Matches the real Electron process (`.../electron /home/pi/brew-system-v3`)
# and the launch.js wrapper that spawns it, so the second or two between the
# two counts as running too.
gui_pid() {
    pgrep -f "electron[^ ]* $PROJECT_DIR" 2>/dev/null | head -n 1
    pgrep -f "$PROJECT_DIR/electron/launch.js" 2>/dev/null | head -n 1
}

# Best effort: on X11 with wmctrl or xdotool installed. Without either, a
# running kiosk is fullscreen and almost certainly already the top window, so
# there is nothing to fix.
raise_window() {
    pid=$1
    if command -v xdotool >/dev/null 2>&1; then
        # The empty pattern is required positionally; --pid does the filtering.
        wid=$(xdotool search --onlyvisible --pid "$pid" "" 2>/dev/null | head -n 1)
        if [ -n "${wid:-}" ]; then
            xdotool windowactivate "$wid" 2>/dev/null && return 0
        fi
    fi
    if command -v wmctrl >/dev/null 2>&1; then
        wmctrl -a brew-system-v3 2>/dev/null && return 0
    fi
    return 1
}

# The panel may be asleep (see Screen Sleep in README.md); waking it costs
# nothing when it is already on.
wake_display() {
    [ -n "${DISPLAY:-}" ] || return 0
    command -v xset >/dev/null 2>&1 || return 0
    xset dpms force on 2>/dev/null || true
}

running=$(gui_pid | head -n 1)
if [ -n "$running" ]; then
    wake_display
    if raise_window "$running"; then
        log "already running (pid $running) — raised its window"
    else
        log "already running (pid $running) — left it alone"
    fi
    exit 0
fi

# One launch at a time. The lock is inherited by the app itself, so it also
# covers an impatient second click during startup.
# `exec` is a special builtin: a redirection it can't open would kill the
# script outright, so check the lock file is writable before opening it.
if command -v flock >/dev/null 2>&1 && : >>"$LOCK" 2>/dev/null; then
    exec 9>>"$LOCK"
    if ! flock -n 9; then
        log "another launch is already under way"
        exit 0
    fi
fi

# --- backend ----------------------------------------------------------------

# The GUI is a window onto the backend, so a stopped backend leaves it sitting
# on its "waiting for the backend" page forever. Nudge the service if we can;
# if we can't, still open the GUI — the waiting page then says what is wrong,
# which beats an icon that appears to do nothing.
backend_up() {
    command -v curl >/dev/null 2>&1 || return 0
    curl -fsS -m 2 -o /dev/null "$BACKEND_URL" 2>/dev/null
}

if ! backend_up; then
    if command -v systemctl >/dev/null 2>&1 && ! systemctl is-active --quiet "$SERVICE"; then
        if sudo -n systemctl start "$SERVICE" >>"$LOG" 2>&1; then
            log "$SERVICE was not running — started it"
        else
            log "$SERVICE is not running and could not be started (needs: sudo systemctl start $SERVICE)"
        fi
    fi
fi

# --- launch -----------------------------------------------------------------

# A desktop launcher does not get a login shell, so PATH may not have node on
# it even where a terminal does.
find_node() {
    if command -v node >/dev/null 2>&1; then command -v node; return; fi
    for candidate in /usr/bin/node /usr/local/bin/node /opt/nodejs/bin/node; do
        [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return; }
    done
}

NODE=$(find_node)
if [ -n "${NODE:-}" ] && [ -f "$PROJECT_DIR/electron/launch.js" ]; then
    log "starting the GUI via $NODE electron/launch.js"
    exec "$NODE" "$PROJECT_DIR/electron/launch.js" >>"$LOG" 2>&1
fi

# Fallback: Electron's own binary needs no node on PATH. launch.js would have
# started unclutter for us, so do that here instead.
ELECTRON="$PROJECT_DIR/node_modules/electron/dist/electron"
if [ -x "$ELECTRON" ]; then
    if command -v unclutter >/dev/null 2>&1; then
        (unclutter --start-hidden --hide-on-touch >/dev/null 2>&1 &)
    fi
    log "starting the GUI via $ELECTRON (no node found on PATH)"
    exec "$ELECTRON" "$PROJECT_DIR" >>"$LOG" 2>&1
fi

tell_user "Can't start the brewing GUI: no Electron in $PROJECT_DIR/node_modules. Run 'npm install' in $PROJECT_DIR."
exit 1
