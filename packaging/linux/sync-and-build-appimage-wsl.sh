#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/../.." && pwd)"
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
bash packaging/linux/build-linux-appimage.sh
