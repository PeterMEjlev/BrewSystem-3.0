#!/bin/sh
# Put a "Brew System" icon on this Pi's desktop (and in its menu) that opens
# the brewing GUI. Run it on the rig, once:
#
#     ~/brew-system-v3/install-desktop-icon.sh
#
# Safe to re-run — it overwrites its own two files and nothing else. The icon
# runs brew-system-gui.sh from this checkout, so a git pull updates what the
# icon does without reinstalling anything.

set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LAUNCHER="$PROJECT_DIR/brew-system-gui.sh"
ICON="$PROJECT_DIR/Icon_App.png"

[ -f "$LAUNCHER" ] || { echo "Missing $LAUNCHER — is this the brew-system-v3 checkout?" >&2; exit 1; }
chmod +x "$LAUNCHER"

# xdg-user-dir knows about localised and relocated desktop folders; the
# fallback is right on a stock Raspberry Pi OS install.
if command -v xdg-user-dir >/dev/null 2>&1; then
    DESKTOP_DIR=$(xdg-user-dir DESKTOP)
else
    DESKTOP_DIR="$HOME/Desktop"
fi
MENU_DIR="$HOME/.local/share/applications"

write_entry() {
    target=$1
    cat >"$target" <<ENTRY
[Desktop Entry]
Type=Application
Version=1.0
Name=Brew System
GenericName=Brewery control
Comment=Open the brewing control GUI (starts it if it isn't running)
Exec=$LAUNCHER
Icon=$ICON
Terminal=false
Categories=Utility;
StartupNotify=false
ENTRY
    # PCManFM will not launch a desktop file it can't execute, and marks the
    # icon as untrusted until it can.
    chmod +x "$target"
    if command -v gio >/dev/null 2>&1; then
        gio set "$target" metadata::trusted true 2>/dev/null || true
    fi
}

if [ -d "$DESKTOP_DIR" ]; then
    write_entry "$DESKTOP_DIR/brew-system.desktop"
    echo "Desktop icon:  $DESKTOP_DIR/brew-system.desktop"
else
    echo "No desktop folder at $DESKTOP_DIR — skipped the icon, installing the menu entry only." >&2
fi

mkdir -p "$MENU_DIR"
write_entry "$MENU_DIR/brew-system.desktop"
echo "Menu entry:    $MENU_DIR/brew-system.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$MENU_DIR" 2>/dev/null || true

[ -f "$ICON" ] || echo "Note: $ICON is missing, so the entry will show a generic icon." >&2

echo
echo "Done. Double-click 'Brew System' on the desktop to open the GUI."
echo "Launcher log: \${XDG_STATE_HOME:-\$HOME/.local/state}/brew-system/gui-launcher.log"
