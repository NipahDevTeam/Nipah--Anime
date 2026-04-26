#!/usr/bin/env bash
# sync-and-build-deb-wsl.sh — run from WSL to sync the Windows project into WSL
# and produce a .deb package. Requires: wails, nfpm, npm in PATH.
set -euo pipefail

SRC="/mnt/c/Users/NICOLAS/Desktop/Nipah! Anime/miruro-phase1/miruro"
DST="$HOME/nipah-linux-build"

mkdir -p "$DST"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude 'frontend/node_modules' \
    --exclude 'frontend/dist' \
    --exclude 'build/bin' \
    --exclude 'build/appimage' \
    --exclude '.git' \
    "$SRC/" "$DST/"
else
  cp -a "$SRC/." "$DST/"
  rm -rf "$DST/frontend/node_modules" "$DST/frontend/dist" "$DST/build/bin" "$DST/build/appimage"
fi

cd "$DST"
bash packaging/linux/build-linux-deb.sh
