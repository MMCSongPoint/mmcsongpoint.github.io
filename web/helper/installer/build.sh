#!/bin/sh
# Builds "SongPoint helper setup.exe" (Windows) from the helper files in the folder above.
set -e
cd "$(dirname "$0")"
rm -rf files && mkdir files
cp ../SongPoint-PowerPoint.ps1 "../READ ME.txt" "../Start SongPoint PowerPoint helper.cmd" "../Stop SongPoint PowerPoint helper.cmd" files/
[ -f go.mod ] || go mod init songpoint/helperinstaller >/dev/null 2>&1
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o ../SongPoint-helper-setup.exe .
rm -rf files
echo built ../SongPoint-helper-setup.exe
