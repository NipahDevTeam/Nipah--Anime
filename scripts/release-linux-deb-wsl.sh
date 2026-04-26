#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/go/bin:$PATH"

cd "$ROOT_DIR"
bash packaging/linux/build-linux-deb.sh
