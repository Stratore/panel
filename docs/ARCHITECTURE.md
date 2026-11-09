# Architecture

> Filled in progressively. Source of truth until then: [SPEC.md § 3](SPEC.md#3-architecture).

## Workspace layout

| Package               | Role                                                   |
| --------------------- | ------------------------------------------------------ |
| `packages/shared`     | Types, Zod schemas, constants, scoring, classification |
| `packages/db`         | Drizzle schema, migrations, seed                       |
| `packages/safe-fetch` | SSRF-safe HTTP client, safe XML parser, HTML-to-text   |
| `packages/notifier`   | Alert rules, limits, digest, Discord and Telegram      |
| `apps/collector`      | Scheduler, adapters, pipeline, runs the notifier       |
| `apps/api`            | Fastify: auth, REST, SSE                               |
| `apps/web`            | Vite + TypeScript + native Web Components              |

Workspace packages expose a `source` export condition pointing at `src/`, used by TypeScript and Vitest; `default` points at the compiled `dist/`.

## `packages/shared`

Pure, dependency-light domain logic (Zod only), usable from Node and the browser:

| Module                              | Content                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `constants.ts`                      | Categories, severities, kinds, languages, field limits                             |
| `schemas.ts`                        | Zod contracts: `NormalizedItem` (adapter output), watchlist, prefs, keyword config |
| `scoring.ts`                        | CVE priority, provisional CVSS, article rank                                       |
| `classify.ts`, `text.ts`            | Keyword classification, folding and tokenization                                   |
| `cluster.ts`                        | Title trigrams and Jaccard similarity                                              |
| `url.ts`, `cve.ts`                  | URL canonicalization, safe-link check, CVE id extraction                           |
| `journal.ts`                        | Front page and section selection                                                   |
| `cvss.ts`, `cwe.ts`, `templates.ts` | CVSS v3.x/v4.0 decoding, CWE names, EN/FR CVE summaries                            |
| `watchlist.ts`                      | Default watchlist, CPE and keyword matching                                        |
| `summarizer.ts`                     | AI extension point (`NoneSummarizer` only)                                         |

## `packages/db`

| Module         | Content                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `schema.ts`    | Drizzle tables (SPEC § 7.4)                                                                         |
| `client.ts`    | `openDatabase` (WAL, foreign keys, busy timeout, mode 600), `migrateDatabase`                       |
| `seed.ts`      | Catalog loading (`config/sources.default.json`, Zod-validated) and idempotent seed                  |
| `retention.ts` | Daily purge (30 d items, 365 d non-KEV CVEs, 7 d runs, 90 d alerts), weekly FTS optimize + `VACUUM` |
| `backup.ts`    | Online backup through SQLite's backup API, 7 copies kept                                            |
| `drizzle/`     | Generated SQL migrations + `0001_fts.sql` (FTS5 external-content table and triggers)                |

## `packages/safe-fetch`

| Module      | Content                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `fetch.ts`  | `safeFetch` (production) and `createSafeFetch(deps)` (test seam: resolver, address policy, ports) |
| `ip.ts`     | `isPublicAddress`, extra blocked CIDRs                                                            |
| `url.ts`    | Static URL policy, re-applied on each redirect                                                    |
| `xml.ts`    | `parseXmlSafe`                                                                                    |
| `text.ts`   | `decodeXmlEntities`, `htmlToText`, `cleanText`, `toPlainText`                                     |
| `errors.ts` | `SafeFetchError` with a typed `code` per refused check                                            |

## `packages/notifier`

| Module        | Content                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `rules.ts`    | The five rules of SPEC § 7.10 (KEV, critical watchlist, breach, CERT-FR alert, HN), lookback windows, EN/FR text |
| `notifier.ts` | `runAlerts`: dedupe through `alerts_sent`, hourly cap, quiet hours, `alert_queue`, daily digest; `sendTestAlert` |
| `message.ts`  | Channel-neutral message, plain text, Discord embed and Telegram HTML payloads                                    |
| `escape.ts`   | Control/bidi stripping, grapheme-safe truncation, Discord markdown and mention escaping, Telegram HTML escaping  |
| `channels.ts` | Discord webhook and Telegram Bot API senders over `safeFetch` (JSON POST, no redirects), secret validation       |
| `time.ts`     | Local time in `TZ`, quiet-hour windows across midnight                                                           |

The collector runs `runAlerts` every minute; the API uses the same channels for "Send a test alert".

## `apps/collector`

| Module                   | Content                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `adapters/`              | One adapter per source type (SPEC § 7.1): generic RSS/Atom/RDF (also custom sources and release feeds), CISA KEV, NVD, EPSS, GitHub Advisories, HIBP, Hacker News, Lobsters, DEV, GitHub trending. Synthetic and malicious fixtures in `__fixtures__/` |
| `pipeline/`              | Canonical URL + SHA-256 dedupe, title clustering (48 h, Jaccard ≥ 0.8), keyword classification, CVE extraction and merge (NVD, KEV, EPSS, GHSA), priority, rank, `events` rows                                                                         |
| `scheduler/queue.ts`     | 4 concurrent tasks, 1 per domain                                                                                                                                                                                                                       |
| `scheduler/retry.ts`     | 3 attempts on 429/5xx/timeouts, 2 s doubling to 60 s with jitter, `Retry-After` honoured                                                                                                                                                               |
| `scheduler/runner.ts`    | One source run: conditional fetch, Zod validation of every candidate, pipeline, `fetch_runs`, health and circuit breaker                                                                                                                               |
| `scheduler/scheduler.ts` | croner jobs, jitter, maintenance                                                                                                                                                                                                                       |
| `main.ts`                | Boot (migrate, seed), scheduler, notifier every minute, `--once [sourceId]` for one-shot runs                                                                                                                                                          |

## `apps/api`

| Module              | Content                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `app.ts`            | `buildApp(deps)`: helmet (CSP § 9.2), cookies, rate limit, ETag, CSRF, session guard, routes           |
| `auth.ts`           | Argon2id, HMAC'd server-side sessions, setup / login / logout, login throttle                          |
| `http.ts`           | RFC 9457 problems, `parseInput` / `sendJson` (Zod in and out), ETag, CSRF, cursors                     |
| `routes/content.ts` | `/journal`, `/brief`, `/items`, `/cves`, `/cves/:id`, `/breaches`, `/releases`, `/repos`, `/search`    |
| `routes/admin.ts`   | `/sources` (CRUD and `/validate`), `/prefs`, `/visit`, `/export`, `/import`, `/alerts/test`, `/health` |
| `routes/stream.ts`  | `/stream` (SSE tail of the `events` table)                                                             |
| `feeds.ts`          | Check-by-check feed validation for "Test feed"                                                         |
| `server.ts`         | Boot: config, migrations, first-launch setup token in the logs                                         |

## `apps/web`

| Module                         | Content                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `lib/h.ts`                     | DOM helper (the only way to create elements)                                                                        |
| `lib/router.ts`                | History API router, link interception, route table of SPEC § 10                                                     |
| `lib/store.ts`, `lib/state.ts` | Observable stores: session, prefs (LocalStorage-cached), pause, online                                              |
| `lib/api.ts`                   | Typed client, CSRF header, 401 handling (the only `fetch` caller)                                                   |
| `lib/sse.ts`                   | `EventSource` with fallback to 2-minute polling                                                                     |
| `lib/i18n.ts`, `i18n/*.json`   | EN/FR catalogs, `Intl` date, relative time and number formatting                                                    |
| `lib/theme.ts`                 | Theme and motion (pause, reduced motion)                                                                            |
| `components/`                  | `pn-app-shell` (route guard, layout), `pn-header`, `pn-tabbar`, `pn-offline-banner`, icons, skeletons, empty states |
| `pages/`                       | Login, setup, Journal, Brief, Threats, Breaches, Releases, Settings (5 tabs), 404                                   |
| `components/drawer.ts`         | CVE detail dialog (focus trap, keyboard, swipe), deep-linked from `/threats/:id`                                    |
| `components/palette.ts`        | ⌘K search and `>` commands                                                                                          |
| `lib/motion.ts`, `lib/data.ts` | Pausable timers and count-ups; stale-while-revalidate views over the LocalStorage cache                             |
| `scripts/check-bundle.mjs`     | Build guard: 60 KB gzipped budget, no Zod in the browser                                                            |
| `styles/`                      | Tokens (light/dark, severity, sections), self-hosted fonts, base and shell styles                                   |
| `public/`                      | Manifest, icons, hand-written Service Worker                                                                        |

## End-to-end tests (`e2e/`)

`playwright.config.ts` starts two servers: `e2e/serve-demo.mjs` (the built API on a temporary database with the fictional demo seed, fake network) on port 3100, and `vite preview` of the built front-end on port 4174 with the production security headers, proxying `/api`. Run `pnpm build && pnpm e2e`.
