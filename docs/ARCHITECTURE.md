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
