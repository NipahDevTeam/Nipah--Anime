#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/nipah-linux-build"
mkdir -p backend/player

cp /mnt/c/Users/NICOLAS/Desktop/Nipah\!\ Anime/miruro-phase1/miruro/backend/player/manager.go backend/player/manager.go
cp /mnt/c/Users/NICOLAS/Desktop/Nipah\!\ Anime/miruro-phase1/miruro/backend/player/cmd_windows.go backend/player/cmd_windows.go
cp /mnt/c/Users/NICOLAS/Desktop/Nipah\!\ Anime/miruro-phase1/miruro/backend/player/cmd_unix.go backend/player/cmd_unix.go

/home/nicolas/go/bin/wails build -clean -platform linux/amd64 -tags webkit2_41
