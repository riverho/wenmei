#!/bin/sh
set -e

# Update desktop database so the .desktop file is recognized
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

# Set Wenmei as the default app for markdown files
if command -v xdg-mime >/dev/null 2>&1; then
    xdg-mime default Wenmei.desktop text/markdown >/dev/null 2>&1 || true
    xdg-mime default Wenmei.desktop text/plain >/dev/null 2>&1 || true
    xdg-mime default Wenmei.desktop text/x-markdown >/dev/null 2>&1 || true
fi
