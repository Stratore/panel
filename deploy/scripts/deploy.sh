#!/usr/bin/env bash
# Pulls the configured images and restarts Panel; rolls back if the new version is not healthy
# (SPEC § 9.6). Run it on the server, from anywhere:
#   deploy/scripts/deploy.sh            # PANEL_VERSION from .env (default: latest)
#   deploy/scripts/deploy.sh v1.2.0     # a specific release, written back to .env on success
# Never run deployments from a self-hosted GitHub runner on a public repository.
set -euo pipefail

cd "$(dirname "$0")/.."
readonly TIMEOUT="${PANEL_DEPLOY_TIMEOUT:-180}"
compose() { docker compose "$@"; }
log() { printf '[deploy] %s\n' "$*"; }

[[ -f .env ]] || { log ".env is missing next to compose.yaml (copy ../.env.example)"; exit 1; }
if [[ "$(stat -c '%a' .env)" != "600" ]]; then
  log "warning: .env should be readable by its owner only (chmod 600 .env)"
fi

version="${1:-}"
if [[ -n "$version" && ! "$version" =~ ^(latest|v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?)$ ]]; then
  log "invalid version: $version"
  exit 1
fi

services=$(compose config --services)

# Remember what runs now: image reference and image ID per service.
declare -A previous_ref previous_id
for service in $services; do
  container=$(compose ps -q "$service" 2>/dev/null || true)
  if [[ -n "$container" ]]; then
    previous_ref[$service]=$(docker inspect -f '{{.Config.Image}}' "$container")
    previous_id[$service]=$(docker inspect -f '{{.Image}}' "$container")
  fi
done

wait_healthy() {
  local deadline=$((SECONDS + TIMEOUT)) service container status unhealthy
  while ((SECONDS < deadline)); do
    unhealthy=0
    for service in $services; do
      container=$(compose ps -q "$service")
      status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo missing)
      [[ "$status" == "healthy" ]] || unhealthy=1
    done
    ((unhealthy == 0)) && return 0
    sleep 5
  done
  return 1
}

rollback() {
  log "new version unhealthy, rolling back"
  # Back to the version recorded in .env (only updated after a successful deployment).
  unset PANEL_VERSION
  compose ps
  for service in "${!previous_id[@]}"; do
    # Point the tag back at the image that was running, then recreate from it.
    docker tag "${previous_id[$service]}" "${previous_ref[$service]}"
  done
  compose up -d --remove-orphans --pull never
  if wait_healthy; then
    log "rollback complete: previous version is healthy"
  else
    log "rollback did not become healthy either: check 'docker compose logs'"
  fi
  exit 1
}

if [[ -n "$version" ]]; then export PANEL_VERSION="$version"; fi
log "pulling images (${PANEL_VERSION:-from .env})"
compose pull
log "starting"
compose up -d --remove-orphans

if wait_healthy; then
  if [[ -n "$version" ]]; then
    if grep -q '^PANEL_VERSION=' .env; then
      sed -i "s/^PANEL_VERSION=.*/PANEL_VERSION=${version}/" .env
    else
      printf 'PANEL_VERSION=%s\n' "$version" >>.env
    fi
  fi
  log "healthy"
  docker image prune -f >/dev/null
  exit 0
fi

if ((${#previous_id[@]} == 0)); then
  log "first deployment is unhealthy: check 'docker compose logs'"
  exit 1
fi
rollback
