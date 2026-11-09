# Deployment

Panel runs as three containers on Docker Compose: `caddy` (TLS, headers, front-end), `api`
(Fastify) and `collector` (sources, pipeline, notifier), sharing one SQLite database in a
volume. The reference host is a Debian home-lab server; the same images run on a Raspberry Pi
(amd64 and arm64, ADR-008).

## Install

On the server, with Docker Engine and the Compose plugin:

```bash
git clone https://github.com/Stratore/panel.git && cd panel/deploy
cp ../.env.example .env && chmod 600 .env
# Edit .env: PANEL_HOST, PANEL_PUBLIC_URL, PANEL_BIND_ADDR, SESSION_SECRET (openssl rand -hex 32), SETUP_TOKEN
scripts/deploy.sh
docker compose logs api | grep -i setup   # only if SETUP_TOKEN was left empty
```

Then open `https://<PANEL_HOST>/setup` and create the passphrase with the setup token.

Until release images exist on GHCR (Phase 10), build them on the server instead:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build --wait
```

## TLS

- **Caddy internal CA (default, `PANEL_TLS=internal`).** Caddy issues a certificate for
  `PANEL_HOST` from its own CA, stored in the `caddy_data` volume. Trust the root once on each
  device:

  ```bash
  docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt panel-root.crt
  ```

- **Public ACME (`PANEL_TLS=you@example.org`).** For a host name reachable from the internet.
- **Tailscale (`*.ts.net`).** Edit the site block of `Caddyfile` to `tls { get_certificate tailscale }`
  and mount the host's `tailscaled` socket into the `caddy` service, then rebuild the web image.

`PANEL_BIND_ADDR` should be the server's Tailscale IP (or `127.0.0.1` behind another proxy).
Never `0.0.0.0`: Panel is a personal tool, not a public website.

## Update and rollback

```bash
scripts/deploy.sh            # pull the tag in .env (latest by default) and restart
scripts/deploy.sh v1.2.0     # switch to a release; written to .env once healthy
```

The script records the running images, pulls, restarts, and waits up to 180 s for every
container to be healthy. Otherwise it points the tags back at the previous images and restarts
them. Run it on the server (SSH), never from a self-hosted GitHub runner.

## Verify

```bash
scripts/check.sh
```

It checks that every container runs as `10001:10001` with a read-only root filesystem, no
capabilities, `no-new-privileges`, PID and memory limits, and a healthy status; that only Caddy
publishes ports, on `PANEL_BIND_ADDR`; that the database file is mode 600; that HTTP redirects
to HTTPS; and that the security headers of SPEC § 9.2 are served. CI runs it on amd64 and arm64.

## Backups

The collector writes a daily backup into the `backups` volume (7 kept). To take one now and
copy it to the host:

```bash
scripts/backup.sh /srv/backups/panel     # keeps 14 copies (PANEL_BACKUPS_KEPT)
```

Restore:

```bash
docker compose stop api collector
docker compose run --rm --no-deps --entrypoint /nodejs/bin/node \
  -v /srv/backups/panel:/restore:ro api \
  -e "require('node:fs').copyFileSync(process.argv[1], '/data/panel.db')" /restore/panel-YYYYMMDDTHHMMSSZ.db
docker compose run --rm --no-deps --entrypoint /nodejs/bin/node api \
  -e "for (const f of ['/data/panel.db-wal','/data/panel.db-shm']) try { require('node:fs').rmSync(f) } catch {}"
docker compose start api collector
```

## Containers

| Service     | Image                           | Networks             | Writes                             |
| ----------- | ------------------------------- | -------------------- | ---------------------------------- |
| `caddy`     | Caddy 2 on Alpine, unprivileged | `internal`, `edge`   | `caddy_data` (certificates), tmpfs |
| `api`       | distroless Node 26, no shell    | `internal`, `egress` | `data` (SQLite), tmpfs             |
| `collector` | distroless Node 26, no shell    | `internal`, `egress` | `data`, `backups`, tmpfs           |

All three: `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, user `10001:10001`, PID, memory
and CPU limits, healthchecks, `restart: unless-stopped`, rotated JSON logs. `internal` has no
route outside; `egress` is used only through `safeFetch`, which refuses private and Docker
addresses.
