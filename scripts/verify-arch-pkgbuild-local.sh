#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v makepkg >/dev/null 2>&1; then
  echo "[Arch Verify] makepkg is required. Run this on Arch or CachyOS." >&2
  exit 1
fi

VERSION="$(grep -Po '(?<=\"productVersion\": \")[^\"]+' wails.json | head -n1)"
if [[ -z "${VERSION}" ]]; then
  echo "[Arch Verify] Could not determine version from wails.json" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

SOURCE_ROOT="Nipah--Anime-${VERSION}"
SOURCE_TARBALL="nipah-anime-${VERSION}-local.tar.gz"

mkdir -p "${WORK_DIR}/${SOURCE_ROOT}"

tar \
  --exclude='.git' \
  --exclude='build' \
  --exclude='frontend/node_modules' \
  --exclude='.gocache' \
  --exclude='.gocache-wsl' \
  --exclude='.gotmp' \
  --exclude='.gotmp-wsl' \
  --exclude='.playwright-cli' \
  --exclude='packaging/arch/pkg' \
  --exclude='packaging/arch/src' \
  -cf - . | tar -xf - -C "${WORK_DIR}/${SOURCE_ROOT}"

tar -czf "${WORK_DIR}/${SOURCE_TARBALL}" -C "${WORK_DIR}" "${SOURCE_ROOT}"
cp packaging/arch/PKGBUILD "${WORK_DIR}/PKGBUILD"

perl -0pi -e 's/^source=\(.*\)$/source=("'"${SOURCE_TARBALL}"'")/m' "${WORK_DIR}/PKGBUILD"

echo "[Arch Verify] Building local Arch package from ${SOURCE_TARBALL}"
(
  cd "${WORK_DIR}"
  makepkg -sf --noconfirm
)

echo "[Arch Verify] Success. Local PKGBUILD packaged cleanly."
