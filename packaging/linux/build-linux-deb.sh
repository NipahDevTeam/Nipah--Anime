#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export PATH="$HOME/go/bin:$PATH"

WAILS_BIN="${WAILS_BIN:-$(command -v wails || true)}"
NFPM_BIN="${NFPM_BIN:-$(command -v nfpm || true)}"

if [[ -z "${WAILS_BIN}" ]]; then
  echo "[Linux] Wails CLI not found in PATH" >&2
  exit 1
fi
if [[ -z "${NFPM_BIN}" ]]; then
  echo "[Linux] nfpm not found in PATH" >&2
  exit 1
fi

echo "[Linux] Building frontend"
npm --prefix frontend install
npm --prefix frontend run build

echo "[Linux] Building Wails app"
"${WAILS_BIN}" build -clean -platform linux/amd64 -tags webkit2_41

mkdir -p build/linux-bin
cp -f "build/bin/Nipah! Anime" "build/linux-bin/nipah-anime"

echo "[Linux] Packaging .deb"
"${NFPM_BIN}" package --packager deb --config packaging/linux/nfpm.yaml --target build/bin/

echo "[Linux] Done"
