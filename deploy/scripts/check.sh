#!/usr/bin/env bash
# Verifies a running Panel stack against SPEC § 9.2 and § 9.6: hardened containers, only Caddy
# published, security headers, HTTP→HTTPS redirect, API behind authentication.
#   deploy/scripts/check.sh            # uses PANEL_HOST and PANEL_BIND_ADDR from .env
# Exits non-zero on the first failed check. Used by CI on amd64 and arm64.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
set -a && . ./.env && set +a
readonly host="${PANEL_HOST:?}" addr="${PANEL_BIND_ADDR:-127.0.0.1}"
failures=0
ok() { printf '  ok   %s\n' "$*"; }
ko() { printf '  FAIL %s\n' "$*"; failures=$((failures + 1)); }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else ko "$1 (got '$2', want '$3')"; fi; }

echo "containers"
for service in api collector caddy; do
  c=$(docker compose ps -q "$service")
  [[ -n "$c" ]] || { ko "$service is not running"; continue; }
  check "$service runs as 10001:10001" "$(docker inspect -f '{{.Config.User}}' "$c")" "10001:10001"
  check "$service root filesystem is read-only" "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$c")" "true"
  check "$service drops all capabilities" "$(docker inspect -f '{{json .HostConfig.CapDrop}}' "$c")" '["ALL"]'
  check "$service adds no capability" "$(docker inspect -f '{{json .HostConfig.CapAdd}}' "$c")" "null"
  check "$service has no-new-privileges" "$(docker inspect -f '{{json .HostConfig.SecurityOpt}}' "$c")" '["no-new-privileges:true"]'
  check "$service is not privileged" "$(docker inspect -f '{{.HostConfig.Privileged}}' "$c")" "false"
  check "$service has a pids limit" "$(docker inspect -f '{{if .HostConfig.PidsLimit}}set{{end}}' "$c")" "set"
  check "$service has a memory limit" "$(docker inspect -f '{{if .HostConfig.Memory}}set{{end}}' "$c")" "set"
  check "$service is healthy" "$(docker inspect -f '{{.State.Health.Status}}' "$c")" "healthy"
  if [[ "$service" != "caddy" ]]; then
    check "$service publishes no port" "$(docker inspect -f '{{json .HostConfig.PortBindings}}' "$c")" "{}"
  fi
done

echo "published ports"
bound=$(docker inspect -f '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostIp}} {{end}}{{end}}' "$(docker compose ps -q caddy)")
for ip in $bound; do check "caddy port bound to $addr" "$ip" "$addr"; done

echo "database"
check "database file is private (600)" \
  "$(docker compose exec -T api /nodejs/bin/node -e "process.stdout.write((require('node:fs').statSync('/data/panel.db').mode & 0o777).toString(8))")" "600"

echo "http"
curl_https() { curl -s --cacert "$ca" --resolve "$host:443:$addr" "$@"; }
ca=$(mktemp)
trap 'rm -f "$ca"' EXIT
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt "$ca" >/dev/null 2>&1 || true
if [[ ! -s "$ca" ]]; then ca=/etc/ssl/certs/ca-certificates.crt; fi

redirect=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --resolve "$host:80:$addr" "http://$host/threats")
check "HTTP redirects to HTTPS" "$redirect" "308 https://$host/threats"

headers=$(curl_https -D - -o /dev/null "https://$host/" | tr -d '\r')
for name in Content-Security-Policy Strict-Transport-Security X-Content-Type-Options \
  X-Frame-Options Referrer-Policy Permissions-Policy Cross-Origin-Opener-Policy \
  Cross-Origin-Resource-Policy; do
  if grep -qi "^$name: " <<<"$headers"; then ok "header $name"; else ko "header $name missing"; fi
done
if grep -qi "^content-security-policy: .*require-trusted-types-for 'script'" <<<"$headers"; then
  ok "CSP enforces Trusted Types"
else
  ko "CSP does not enforce Trusted Types"
fi
if grep -qi '^server: ' <<<"$headers"; then ko "Server header present"; else ok "no Server header"; fi
check "SPA fallback serves the shell" "$(curl_https -o /dev/null -w '%{http_code}' "https://$host/threats/CVE-2026-0001")" "200"
check "API is reachable" "$(curl_https -o /dev/null -w '%{http_code}' "https://$host/api/health/live")" "200"
check "API requires a session" "$(curl_https -o /dev/null -w '%{http_code}' "https://$host/api/journal")" "401"

if ((failures > 0)); then
  printf '%d check(s) failed\n' "$failures"
  exit 1
fi
echo "all checks passed"
