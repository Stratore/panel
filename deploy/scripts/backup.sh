#!/usr/bin/env bash
# Takes a consistent online backup of the SQLite database (SQLite backup API, safe while
# Panel runs) and copies it out of the Docker volume.
#   deploy/scripts/backup.sh [destination]    # default: ./backups next to compose.yaml
# Keeps the 14 most recent copies (PANEL_BACKUPS_KEPT). The collector also keeps 7 daily
# backups inside the `backups` volume on its own.
# Restore: docs/DEPLOYMENT.md.
set -euo pipefail

cd "$(dirname "$0")/.."
readonly destination="${1:-backups}"
readonly kept="${PANEL_BACKUPS_KEPT:-14}"
log() { printf '[backup] %s\n' "$*"; }

[[ "$kept" =~ ^[0-9]+$ ]] || { log "PANEL_BACKUPS_KEPT must be a number"; exit 1; }

umask 077
mkdir -p "$destination"

# The collector image has no shell: run its own backup command with Node.
file=$(docker compose exec -T collector /nodejs/bin/node dist/main.js --backup | tail -n 1)
if [[ ! "$file" =~ ^/backups/panel-[0-9]{8}T[0-9]{6}Z\.db$ ]]; then
  log "unexpected backup path: $file"
  exit 1
fi

docker compose cp "collector:$file" "$destination/"
target="$destination/$(basename "$file")"
chmod 600 "$target"

# A SQLite file always starts with this header.
if [[ "$(head -c 15 "$target")" != "SQLite format 3" ]]; then
  log "the copied file is not a SQLite database"
  exit 1
fi
log "saved $target ($(du -h "$target" | cut -f1))"

# Rotation: newest first, delete beyond $kept.
find "$destination" -maxdepth 1 -name 'panel-*Z.db' -printf '%f\n' | sort -r |
  tail -n +"$((kept + 1))" | while read -r old; do
  rm -f -- "$destination/$old"
  log "removed $old"
done
