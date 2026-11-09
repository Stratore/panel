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

## Local server on Windows (WSL)

Panel can run on the Windows PC itself, reachable only from it at `https://localhost`, with a
desktop icon that starts it and opens the browser.

1. WSL 2 with Ubuntu and systemd (the default on current WSL). In Ubuntu, as root
   (`wsl -d Ubuntu -u root`): `apt install docker.io docker-compose-v2 docker-buildx` and
   `systemctl enable --now docker`.
2. In Ubuntu: `git clone https://github.com/Stratore/panel.git ~/panel`, then
   `cp ~/panel/.env.example ~/panel/deploy/.env && chmod 600 ~/panel/deploy/.env` and set
   `PANEL_HOST=localhost`, `PANEL_PUBLIC_URL=https://localhost`, `PANEL_BIND_ADDR=127.0.0.1`,
   `PANEL_VERSION=local`, a `SESSION_SECRET` (`openssl rand -hex 32`) and a `SETUP_TOKEN`
   (`openssl rand -hex 16`).
3. In Windows, from a checkout of the repository:
   `powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1`.

The installer puts the launcher in `%LOCALAPPDATA%\Panel` and creates the **Panel** icon on the
desktop, plus Start-menu entries to stop, update and back up. The icon:

- keeps WSL running with a hidden idle process (WSL otherwise shuts its virtual machine down a
  few seconds after the last Windows-side process, which would stop Panel);
- builds the images on the first start, then starts the stack and waits until it is healthy
  (`deploy/scripts/local.sh start`);
- copies a backup to `Documents\Panel\sauvegardes` at most once a day (14 kept), so the data
  survives the loss of the WSL distribution;
- on the first start, copies the setup token to the clipboard and opens `/setup`;
- then opens `https://localhost`.

Ports 80 and 443 are bound to 127.0.0.1 inside WSL and forwarded to Windows' `localhost` only:
other devices on the network cannot reach Panel. The certificate comes from Caddy's local
authority; to remove the browser warning, run `deploy\windows\trust-certificate.ps1` yourself
(it adds that authority to your Windows account's trusted roots after a Windows confirmation).

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

## End-to-end tests against a stack

On a fresh stack (the suite performs the first-run setup), from a development checkout:

```bash
PANEL_E2E_URL=https://<PANEL_HOST> PANEL_E2E_SETUP_TOKEN=<SETUP_TOKEN from .env> pnpm e2e
```

The test account it creates uses a passphrase published in the repository: reset the stack
afterwards (`docker compose down -v`) before real use.
