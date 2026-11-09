#!/usr/bin/env bash
# Panel as a local server on one computer (Docker on Linux or in WSL), built from this checkout
# instead of pulled from a registry. The Windows desktop launcher (deploy/windows/panel.ps1)
# calls it; it also works on its own:
#   scripts/local.sh start             build the images if missing, start, wait until healthy
#   scripts/local.sh stop              stop the containers (data is kept)
#   scripts/local.sh update            update this checkout from origin/main, rebuild, restart
#   scripts/local.sh backup <dir>      online SQLite backup copied to <dir>
#   scripts/local.sh setup-token       print the setup token while no account exists
#   scripts/local.sh status            container status
# This checkout is a deployment copy: `update` resets it to origin/main (.env is not tracked).
set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo ".env is missing next to compose.yaml (copy ../.env.example)" >&2; exit 1; }
set -a && . ./.env && set +a
readonly prefix="${PANEL_IMAGE_PREFIX:-ghcr.io/stratore/panel}" version="${PANEL_VERSION:-local}"
readonly host="${PANEL_HOST:-localhost}"

ensure_docker() {
  if ! docker info >/dev/null 2>&1; then
    systemctl start docker
  fi
}

build() {
  docker compose -f compose.yaml -f compose.build.yaml build --quiet
}

images_present() {
  local service
  for service in api collector web; do
    docker image inspect "$prefix-$service:$version" >/dev/null 2>&1 || return 1
  done
}

up() {
  docker compose up -d --remove-orphans --wait --wait-timeout 240
}

case "${1:-start}" in
  start)
    ensure_docker
    images_present || { echo "building the images (first start, a few minutes)"; build; }
    up
    ;;
  stop)
    docker compose stop
    ;;
  update)
    ensure_docker
    git fetch --quiet origin main
    git reset --hard --quiet origin/main
    echo "updated to $(git log --oneline -1)"
    build
    up
    docker image prune -f >/dev/null
    ;;
  backup)
    scripts/backup.sh "${2:?usage: local.sh backup <destination>}"
    ;;
  setup-token)
    session=$(curl -sk --max-time 5 --resolve "$host:443:127.0.0.1" "https://$host/api/auth/session" || true)
    if [[ "$session" == *'"setupRequired":true'* ]]; then
      printf '%s\n' "${SETUP_TOKEN:?SETUP_TOKEN is empty: see 'docker compose logs api'}"
    fi
    ;;
  status)
    docker compose ps --format 'table {{.Service}}\t{{.Status}}'
    ;;
  *)
    sed -n '2,12p' "$0" >&2
    exit 1
    ;;
esac
