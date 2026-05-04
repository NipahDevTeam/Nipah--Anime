#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$HOME/nipah-linux-build"
mkdir -p backend/player

cp "$SRC_ROOT/backend/player/manager.go" backend/player/manager.go
cp "$SRC_ROOT/backend/player/cmd_windows.go" backend/player/cmd_windows.go
cp "$SRC_ROOT/backend/player/cmd_unix.go" backend/player/cmd_unix.go

/home/nicolas/go/bin/wails build -clean -platform linux/amd64 -tags webkit2_41
