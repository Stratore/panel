# Panel

A self-hosted tech & cyber watch dashboard: a living front page for IT news, plus
continuous monitoring of CVEs, actively exploited vulnerabilities, major data
breaches and software releases. One private instance per person, on a home server
or a Raspberry Pi.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js%2026-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-000000?style=flat-square&logo=fastify&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square)

> **Status:** phases 0 to 9 of the [specification](docs/SPEC.md) are done (shared
> domain, database, safe fetching, collector, API, front-end, pages, notifier,
> deployment). Phase 10 is next: release images, public demo and screenshots.

## Features

- **Journal**: a newspaper-style front page that refreshes itself, with a live wire
  and sections (AI, cybersecurity, innovation, dev & IT, hardware)
- **Brief**: what matters right now, readable in a few seconds
- **Threats**: CVEs scored and ranked (NVD, CISA KEV, FIRST EPSS, GitHub Advisories,
  CERT-FR), with a detail panel
- **Breaches** (Have I Been Pwned) and **Releases** (Node.js, PHP, Python, Docker
  Engine...)
- **Alerts** to Discord or Telegram, with rules, rate limits, quiet hours and a daily
  digest
- English interface with a complete French translation, light and dark themes,
  keyboard navigation

27 default sources, all editable in the settings: the feeds above, Hacker
News, Lobsters, DEV, GitHub trending, and RSS feeds such as BleepingComputer, The
Hacker News, Ars Technica or Le Monde Informatique.

## Security by design

Every piece of external content is treated as hostile:

- every outgoing request goes through `safeFetch`, an SSRF-safe client (private and
  reserved addresses refused, redirects re-checked, size and time limits); a lint
  rule forbids importing any other HTTP client
- XML is parsed with entities disabled and validated first; HTML is reduced to plain
  text
- the front-end never uses `innerHTML` or `eval`: the DOM is built with
  `createElement` / `textContent`, enforced by a strict CSP with Trusted Types
- every input is validated with Zod, SQL only goes through Drizzle's parameterized
  queries
- the passphrase is hashed with Argon2id, sessions use secure cookies, the API is
  rate-limited
- containers run as non-root with a read-only filesystem and dropped capabilities,
  behind Caddy with hardened headers
- no secret in the repository: `.env` is ignored, and gitleaks runs on every commit
  and in CI

The full threat model is in [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).

## Architecture

A pnpm monorepo, TypeScript strict everywhere:

| Package               | Role                                                   |
| --------------------- | ------------------------------------------------------ |
| `packages/shared`     | Types, Zod schemas, constants, scoring, classification |
| `packages/db`         | Drizzle schema, migrations, seed                       |
| `packages/safe-fetch` | SSRF-safe HTTP client, safe XML parser, HTML-to-text   |
| `packages/notifier`   | Alert rules, limits, digest, Discord and Telegram      |
| `apps/collector`      | Scheduler, adapters, pipeline, runs the notifier       |
| `apps/api`            | Fastify: auth, REST, SSE                               |
| `apps/web`            | Vite + TypeScript + native Web Components              |

Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and every technical choice
is justified in [docs/DECISIONS.md](docs/DECISIONS.md).

## Quality

- unit and integration tests with Vitest (coverage), end-to-end tests with
  Playwright and axe accessibility checks
- CI on every push: lint (zero warnings), typecheck, tests, build, `pnpm audit`,
  end-to-end tests, and the Docker stack built for amd64 and arm64
- GitHub Actions pinned by commit hash, read-only permissions
- Conventional Commits, checked by commitlint and lefthook

## Deployment

Three containers on Docker Compose (`caddy`, `api`, `collector`) sharing one SQLite
database. Server install, Windows (WSL) local mode and backups are described in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Development

Requirements: Node.js 26 LTS (see `.nvmrc`), pnpm 12, and
[gitleaks](https://github.com/gitleaks/gitleaks) for the pre-commit hook.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Run locally (three terminals): `pnpm --filter @panel/collector collect:once` fills
the database, `SESSION_SECRET=… node apps/api/dist/server.js` starts the API on port
3000, and `pnpm --filter @panel/web dev` serves the interface on port 5173 (or
`preview` on 4173 with the production security headers).

## License

[MIT](LICENSE)
