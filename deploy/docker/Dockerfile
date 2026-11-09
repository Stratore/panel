# Panel images (SPEC § 9.6). One file, three targets sharing the build stage:
#   docker build -f deploy/docker/Dockerfile --target api|collector|web .
# Base images are pinned by digest (multi-arch indexes: amd64 and arm64); Dependabot bumps them.

ARG NODE_IMAGE=node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072
ARG DISTROLESS_IMAGE=gcr.io/distroless/nodejs26-debian13:nonroot@sha256:33c86a63859efc2ebd88ea0a355863582ec6f1220d048de62baffb2584e709b3
ARG CADDY_IMAGE=caddy:2.11.9-alpine@sha256:0bbb055bda6793c999bde78b1b5ce3e89f829fb031af2cf50056ea1246559fee

# --- Build: install, compile, bundle the front-end, package each app --------------------------
FROM ${NODE_IMAGE} AS build
ENV CI=true
# Toolchain for better-sqlite3 when no prebuilt binary matches the platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install --global --ignore-scripts pnpm@12.16.1
WORKDIR /src

# Manifests first: the dependency layer is reused until the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .nvmrc ./
COPY apps/api/package.json apps/api/
COPY apps/collector/package.json apps/collector/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/safe-fetch/package.json packages/safe-fetch/
COPY packages/notifier/package.json packages/notifier/
# Compiling needs no native module, so no lifecycle script runs here (the root "prepare"
# would try to install git hooks). Native builds happen in `pnpm deploy` below.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json tsconfig.json ./
COPY apps apps
COPY packages packages
COPY config config
COPY deploy deploy
RUN pnpm build

# Self-contained production folders (dist + production node_modules, native modules built for
# this platform), without sources or build files.
RUN pnpm --filter @panel/api deploy --prod --legacy /out/api \
  && pnpm --filter @panel/collector deploy --prod --legacy /out/collector \
  && rm -rf /out/*/src /out/*/tsconfig*.json /out/*/*.tsbuildinfo \
  && cp deploy/docker/healthcheck.mjs /out/api/ \
  && cp deploy/docker/healthcheck.mjs /out/collector/ \
  && cp -r config /out/collector/config \
  && mkdir -p /out/data /out/backups \
  && node deploy/scripts/caddy-headers.mjs > /out/headers.caddy

# Fail the build now, not at runtime, if a native module did not build for this platform.
RUN cd /out/api \
  && node --input-type=module -e "const { openDatabase } = await import('@panel/db'); openDatabase('/tmp/a.db').close(); await import('@node-rs/argon2');" \
  && cd /out/collector \
  && node --input-type=module -e "const { openDatabase } = await import('@panel/db'); openDatabase('/tmp/c.db').close();"

# --- API ------------------------------------------------------------------------------------
FROM ${DISTROLESS_IMAGE} AS api
WORKDIR /app
# Code is owned by root and read-only for the service user.
COPY --from=build /out/api /app
COPY --from=build --chown=10001:10001 /out/data /data
USER 10001:10001
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/panel.db
EXPOSE 3000
CMD ["dist/server.js"]

# --- Collector ------------------------------------------------------------------------------
FROM ${DISTROLESS_IMAGE} AS collector
WORKDIR /app
COPY --from=build /out/collector /app
COPY --from=build --chown=10001:10001 /out/data /data
COPY --from=build --chown=10001:10001 /out/backups /backups
USER 10001:10001
ENV NODE_ENV=production \
    DATABASE_PATH=/data/panel.db \
    SOURCES_PATH=/app/config/sources.default.json \
    KEYWORDS_PATH=/app/config/keywords.json \
    BACKUP_DIR=/backups \
    HEARTBEAT_FILE=/tmp/collector.alive
CMD ["dist/main.js"]

# --- Web: Caddy serving the front-end, TLS and security headers -----------------------------
FROM ${CADDY_IMAGE} AS web
RUN addgroup -S -g 10001 panel \
  && adduser -S -D -H -u 10001 -G panel panel \
  && mkdir -p /data /config \
  && chown -R 10001:10001 /data /config
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /out/headers.caddy /etc/caddy/headers.caddy
COPY --from=build /src/apps/web/dist /srv
USER 10001:10001
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
