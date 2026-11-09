# Architecture

> Filled in progressively. Source of truth until then: [SPEC.md § 3](SPEC.md#3-architecture).

## Workspace layout

| Package               | Role                                                   |
| --------------------- | ------------------------------------------------------ |
| `packages/shared`     | Types, Zod schemas, constants, scoring, classification |
| `packages/db`         | Drizzle schema, migrations, seed                       |
| `packages/safe-fetch` | SSRF-safe HTTP client, safe XML parser, HTML-to-text   |
| `apps/collector`      | Scheduler, adapters, pipeline, notifier                |
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

## `apps/collector`

| Module                   | Content                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `adapters/`              | One adapter per source type (SPEC § 7.1): generic RSS/Atom/RDF (also custom sources and release feeds), CISA KEV, NVD, EPSS, GitHub Advisories, HIBP, Hacker News, Lobsters, DEV, GitHub trending. Synthetic and malicious fixtures in `__fixtures__/` |
| `pipeline/`              | Canonical URL + SHA-256 dedupe, title clustering (48 h, Jaccard ≥ 0.8), keyword classification, CVE extraction and merge (NVD, KEV, EPSS, GHSA), priority, rank, `events` rows                                                                         |
| `scheduler/queue.ts`     | 4 concurrent tasks, 1 per domain                                                                                                                                                                                                                       |
| `scheduler/retry.ts`     | 3 attempts on 429/5xx/timeouts, 2 s doubling to 60 s with jitter, `Retry-After` honoured                                                                                                                                                               |
| `scheduler/runner.ts`    | One source run: conditional fetch, Zod validation of every candidate, pipeline, `fetch_runs`, health and circuit breaker                                                                                                                               |
| `scheduler/scheduler.ts` | croner jobs, jitter, maintenance                                                                                                                                                                                                                       |
| `main.ts`                | Boot (migrate, seed), scheduler, `--once [sourceId]` for one-shot runs                                                                                                                                                                                 |

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
