# Decision log

Short ADRs. Each entry: context, decision, consequences. Newest at the bottom.

---

## ADR-001 — Node.js 26 LTS

- **Date:** 2026-11-02
- **Context:** The spec asks for the current LTS. On 2026-11-02, Node 26 ("Lithium", 26.13.0) is the Active LTS; Node 24 is in maintenance.
- **Decision:** Pin `26.13.0` in `.nvmrc` and `engines.node: ">=26.13.0 <27"`. Local installs use fnm.
- **Consequences:** Native modules (`better-sqlite3`, `@node-rs/argon2`) must ship Node 26 prebuilds; this is checked when they are added (phases 2 and 5).

## ADR-002 — pnpm 12 build allowlist and release-age gate

- **Date:** 2026-11-02
- **Context:** The spec names `onlyBuiltDependencies`. pnpm 11 removed it in favour of `allowBuilds`, and pnpm 12 is current.
- **Decision:** `allowBuilds` in `pnpm-workspace.yaml` allows only `better-sqlite3`, `@node-rs/argon2` and `esbuild`. `strictDepBuilds` stays at its default (`true`), so any unreviewed install script fails the install. `minimumReleaseAge: 4320` refuses versions published less than 3 days ago.
- **Consequences:** Same intent as the spec, expressed with the current setting. Urgent security patches younger than 3 days need an explicit `minimumReleaseAgeExclude` entry.

## ADR-003 — lefthook without lint-staged

- **Date:** 2026-11-02
- **Context:** The spec lists "lint-staged + gitleaks" for pre-commit. lefthook already supports running commands on staged files (`{staged_files}`, `glob`, `stage_fixed`).
- **Decision:** Use lefthook's native staged-file support; do not add `lint-staged`. lefthook's own `postinstall` is denied (`allowBuilds: lefthook: false`) and hooks are installed by the root `prepare` script.
- **Consequences:** One dependency less (rule 10), identical behaviour.

## ADR-004 — TypeScript 6.0, not 7.0

- **Date:** 2026-11-02
- **Context:** TypeScript 7.0 (native Go compiler) is the npm `latest`, but `typescript-eslint` 8.x declares `typescript >=4.8.4 <6.1.0`. Typed lint rules are required by the spec.
- **Decision:** Pin TypeScript `6.0.3`. Revisit when `typescript-eslint` supports 7.x.
- **Consequences:** Slower compilation than TS 7; no functional loss.

## ADR-005 — Type-checking tests separately from builds

- **Date:** 2026-11-02
- **Context:** Package `tsconfig.json` files are composite and emit to `dist/`; tests must not be emitted, but must be type-checked and linted.
- **Decision:** Package configs exclude `*.test.ts`. A root `tsconfig.test.json` (no emit) includes every test and `vitest.config.ts`. `pnpm typecheck` runs `tsc -b && tsc -p tsconfig.test.json`; ESLint uses both sets of projects.
- **Consequences:** Workspace packages resolve to their `src/` through a custom `source` export condition (TypeScript `customConditions`, Vite `resolve.conditions`), so tests and type-checks never depend on a prior build.

## ADR-006 — Phase 0 dependencies

- **Date:** 2026-11-02
- **Decision:** Root dev dependencies only, exact versions:

| Package                                              | Why                                                                      | Runtime deps |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ------------ |
| `typescript` 6.0.3                                   | Required by the spec                                                     | 0            |
| `@types/node` 26                                     | Node typings for API/collector                                           | 1            |
| `eslint` 10, `@eslint/js` 10, `typescript-eslint` 8  | Strict, type-aware lint (spec)                                           | —            |
| `eslint-plugin-no-unsanitized`                       | Mozilla-maintained; catches DOM HTML sinks beyond what selectors can see | 0            |
| `eslint-plugin-security`                             | Node security rules (non-literal RegExp, child_process, …)               | 1            |
| `eslint-config-prettier`                             | Disables stylistic rules that conflict with Prettier                     | 0            |
| `globals`                                            | Browser/Node globals for flat config                                     | 0            |
| `prettier`                                           | Required by the spec                                                     | 0            |
| `vitest`, `@vitest/coverage-v8`                      | Required by the spec; coverage gates in later phases                     | —            |
| `lefthook`                                           | Required by the spec; Go binary                                          | 0            |
| `@commitlint/cli`, `@commitlint/config-conventional` | Required by the spec                                                     | —            |

- **Not added:** `lint-staged` (ADR-003). gitleaks is a standalone binary (installed with winget locally, checksum-verified download in CI), not an npm package.

## ADR-007 — Secret scanning in CI without the gitleaks Action

- **Date:** 2026-11-02
- **Context:** `gitleaks-action` requires a license key for organisation accounts and adds a third-party action to the supply chain.
- **Decision:** CI downloads the pinned gitleaks release and verifies its SHA-256 before running `gitleaks git`.
- **Consequences:** Version bumps are manual (version + checksum in `ci.yml`).

## ADR-008 — Deployment target: Debian home-lab server

- **Date:** 2026-11-02
- **Context:** The spec targets a Raspberry Pi. The owner's home lab runs Docker Compose on a headless Debian server (recycled laptop) plus two Raspberry Pis, with Tailscale as a subnet router and Caddy using an internal CA.
- **Decision:** Keep multi-arch images (amd64 + arm64) so Panel runs on either; the reference deployment is the Debian server, with Caddy's internal CA as the default TLS mode.
- **Consequences:** Phase 9 is validated on amd64 (Debian) and, when possible, arm64 (Pi).

## ADR-009 — `security/detect-object-injection` disabled; zero lint warnings

- **Date:** 2026-11-02
- **Context:** The rule flags every bracket access, including keys typed as literal unions (`Category`, `Lang`). It produced only false positives in Phase 1, and noise hides real findings.
- **Decision:** Disable it. Lookups keyed by external data use `Object.hasOwn` before indexing (see `cvss.ts`, `cwe.ts`), which is covered by tests with `__proto__`/`constructor` keys. `pnpm lint` now runs with `--max-warnings 0`, so every remaining security rule fails the build. `detect-non-literal-fs-filename` is off in `*.test.ts` only (fixture loading).
- **Consequences:** Prototype-pollution safety relies on typing plus explicit own-property checks, reviewed in code.

## ADR-010 — URL canonicalization keeps the path's case

- **Date:** 2026-11-02
- **Context:** SPEC § 7.2 says "lowercase" for canonical URLs. Paths are case-sensitive (RFC 3986): lowercasing them would merge distinct articles (YouTube ids, GitHub paths, short-link slugs).
- **Decision:** Lowercase scheme and host only (what `URL` already does). Tracking parameters, fragment and trailing slash are removed as specified.
- **Consequences:** Rare duplicates differing only by path case are not merged by `url_hash`; title clustering still groups them.

## ADR-011 — Zod 4 in `packages/shared`

- **Date:** 2026-11-02
- **Decision:** `zod@4.6.7` (exact). Required by the spec, zero runtime dependencies, actively maintained. Schemas are `strictObject` so unknown keys (e.g. smuggled HTML or secrets) are rejected; URLs are limited to credential-free http(s) with a domain name.

## ADR-012 — Database dependencies

- **Date:** 2026-11-03
- **Decision:** `drizzle-orm@0.45.4` and `better-sqlite3@13.0.3` (runtime, required by the spec; `better-sqlite3` ships Node 26 prebuilds and is compiled with FTS5), `drizzle-kit@0.31.11` and `@types/better-sqlite3` (dev only, to generate migrations). `drizzle-kit` brings `esbuild` and `tsx`; they never reach the runtime images.
- **Consequences:** Migrations are versioned SQL in `packages/db/drizzle/`. The FTS5 table and its sync triggers live in a hand-written migration (`0001_fts.sql`) because Drizzle does not model virtual tables.

## ADR-013 — Source URLs that changed since the spec

- **Date:** 2026-11-03
- **Context:** Every catalog URL was checked on 2026-11-02 (all answered 200).
- **Decision:**
  - CERT-FR moved from `cert.ssi.gouv.fr` to `cert.cyber.gouv.fr` (the old host redirects): new URLs are used directly.
  - Python Insider moved off Blogger: `https://blog.python.org/rss.xml` (the old Blogger feed URL now returns `application/octet-stream`, which `safeFetch` rejects).
  - Tom's Hardware redirects to `https://www.tomshardware.com/feeds.xml`: the final URL is used.
  - The Register's Atom URL now redirects to an RSS endpoint on `api.theregister.com`; the stable public URL is kept and the generic adapter handles both formats.
  - GitHub Advisories: one source per ecosystem (`ghsa-composer`, `ghsa-npm`, `ghsa-pip`).

## ADR-014 — Storage conventions

- **Date:** 2026-11-03
- **Decision:** Timestamps are integer milliseconds (Drizzle `timestamp_ms`), calendar dates (breach date, star history day) are `YYYY-MM-DD` text. `sessions.id` stores the SHA-256 of the session token, never the token itself. `alerts_sent` is unique on `(dedupe_key, channel)` so a failure on one channel does not block the other. The seed is idempotent: catalog fields are refreshed on every start, but the user's `enabled` toggle, custom sources, edited watchlist and prefs are never overwritten.

## ADR-015 — Single Vitest configuration

- **Date:** 2026-11-03
- **Context:** Vitest projects do not inherit the root `resolve.conditions`, so cross-package imports silently resolved to stale `dist/` builds.
- **Decision:** One root config including `{apps,packages}/*/src/**/*.test.ts`, with the `source` condition for both client and SSR resolution.

## ADR-016 — safe-fetch dependencies

- **Date:** 2026-11-03
- **Decision:** `undici@8.12.3` (0 deps; needed for a per-request `Agent` whose DNS lookup is pinned to the validated address), `ipaddr.js@2.5.0` (0 deps), `fast-xml-parser@5.11.2` (6 small deps, same maintainer), `sanitize-html@2.18.1` (pulls `htmlparser2` and `postcss`; mandated by the spec, the most audited HTML sanitizer for Node). Only `packages/safe-fetch` may import `undici` or `node:http(s)` (ESLint).

## ADR-017 — Strict XML validation with `XMLValidator`

- **Date:** 2026-11-03
- **Context:** `fast-xml-parser`'s parser is lenient (it accepts truncated documents). Its `XMLValidator` export is deprecated in favour of a separate `fast-xml-validator` package, which adds another transitive dependency.
- **Decision:** Keep the bundled `XMLValidator` (one justified lint suppression). Order of checks: size → `<!DOCTYPE`/`<!ENTITY` refusal → well-formedness → parse with `processEntities: false` and `maxNestedTags: 64`, all values kept as strings.
- **Consequences:** Revisit when `XMLValidator` is removed upstream (Dependabot will surface it).

## ADR-018 — safeFetch behaviour beyond the spec

- **Date:** 2026-11-03
- **Decision:**
  - The default trust level is `custom` (strictest); built-in sources opt into `default`.
  - Caller-supplied size and time limits can only lower the caps, never raise them.
  - Credentials (`apiKey`, `Authorization`, any non-allowlisted header) are dropped when a redirect leaves the original origin.
  - IPv6 prefixes that embed IPv4 (NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, Teredo) and documentation ranges are blocked too; only `unicast` addresses outside every listed range pass.
  - Extra ranges (e.g. a custom Docker network) come from `SAFE_FETCH_BLOCKED_CIDRS`.
  - Feed text goes through `toPlainText`: one-level entity decoding, tag stripping, removal of control, zero-width and bidi-override characters, truncation on code points.

## ADR-019 — "Trojan Source" guard

- **Date:** 2026-11-03
- **Context:** While writing Phase 3, escape sequences for invisible characters were turned into the literal characters by the editing tooling, which is exactly how bidi/zero-width tricks hide in code.
- **Decision:** A test (`packages/shared/src/source-hygiene.test.ts`) fails if any source, config or workflow file contains a literal control, zero-width, bidi-override or BOM character. Such characters must be written as `\u` escapes.

## ADR-020 — NVD page size and resumable windows

- **Date:** 2026-11-09
- **Context:** A 2000-result NVD page is 10–20 MB, far above safeFetch's 5 MB cap; even 500 results exceeded it in the live run (some records list thousands of CPE matches). 200 results weigh ≈ 1.7 MB.
- **Decision:** `resultsPerPage: 200`, at most 50 pages per run. When a window is too large for one run, the cursor stored in `sources.last_modified` becomes `resume:<start>|<end>|<startIndex>` and the next run continues on the exact page; a complete window stores its end date. Corrupted cursors fall back to a fresh 7-day window.
- **Consequences:** The 5 MB limit stays untouched; no NVD change is skipped.

## ADR-021 — `Accept: application/json` for JSON APIs; EPSS pacing

- **Date:** 2026-11-09
- **Context:** The live run showed FIRST EPSS answering `400 errorNotSupported` to safeFetch's feed-oriented default `Accept` list.
- **Decision:** The runner sends `Accept: application/json` for every non-RSS adapter (GitHub adapters still add their vendor type). EPSS batches of 100 ids are also spaced 2 s apart to stay polite.

## ADR-022 — `events` table as the collector → API change feed

- **Date:** 2026-11-09
- **Context:** The collector and the API are separate processes sharing SQLite; SSE (`/api/stream`) needs to learn about new items.
- **Decision:** The collector appends `item.new`, `cve.updated` and `source.health` rows to an `events` table inside the same transaction as the data; the API tails it by id. Rows are purged after a day.
- **Noise control:** only new high/critical CVEs published within 48 h and KEV additions dated within 7 days produce `cve.updated` events, so the initial KEV catalog sync (≈1 800 entries) and bulk NVD syncs do not flood the stream (the notifier reuses this rule in Phase 8).

## ADR-023 — Scheduling details

- **Date:** 2026-11-09
- **Decision:** One croner job per enabled source, re-synced with the `sources` table every 5 minutes. Jitter is a random delay of 0–10 % of the interval after each trigger (a job can be late, never early). A new-CVE NVD run triggers an immediate EPSS run. Maintenance: purge 03:30, backup 03:00 (when `BACKUP_DIR` is set), FTS optimize + `VACUUM` Sundays 04:00.
- **Health:** `healthy`, `slow` (run ≥ 3 s), `failing` (1–4 consecutive failures), `degraded` (≥ 5: retried at 4× the interval, at most every 6 h; first success closes the breaker).

## ADR-024 — Collector dependencies

- **Date:** 2026-11-09
- **Decision:** `croner` (0 deps, cron scheduling, imposed by the spec), `pino` (the logger Fastify uses; secrets redacted by path), plus `zod` and `drizzle-orm` at the same exact versions as the packages that already use them.

## ADR-025 — API dependencies and validation style

- **Date:** 2026-11-09
- **Decision:** `fastify`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cookie` (all imposed by the spec) and `@node-rs/argon2` (prebuilt Argon2id, no install script). No Zod type-provider plugin: routes call a small `parseInput(schema, …)` helper for input and `sendJson(reply, schema, …)` for output, so every response is validated before it leaves (a mismatch is logged and answered with a generic 500). The HTTP contract lives in `packages/shared/src/api.ts` for the web client to reuse.
- **Note:** `@node-rs/argon2` exports `Algorithm` as a `const enum`, unusable under `verbatimModuleSyntax`; the numeric value (2 = Argon2id) is used with a comment.

## ADR-026 — Sessions, setup token and CSRF

- **Date:** 2026-11-09
- **Decision:**
  - The `__Host-panel_sid` cookie (HttpOnly, Secure, SameSite=Strict, Path=/, 30 days) carries 32 random bytes; the database stores `HMAC-SHA256(SESSION_SECRET, token)`, so a leaked database cannot be replayed. Sliding expiry renews at most hourly. Logging in rotates the session.
  - Failed logins: generic message, 5 attempts per 15 min per IP (rate limit) plus an exponential delay (250 ms doubling, at most 4 s).
  - `/api/auth/setup` only works while no user exists, requires the one-time `SETUP_TOKEN` (generated and printed in the API logs when not provided), compared in constant time, and re-checks inside a transaction against concurrent setups.
  - CSRF: every non-GET request must carry `X-Panel-CSRF: 1` (impossible cross-site without CORS, which is disabled) and, when present, an `Origin` equal to `PANEL_PUBLIC_URL` (or the request host).
  - The user-agent hash is stored for auditing but not enforced: browser updates change it and would log the user out.

## ADR-027 — Read-time ranking, cursors and search

- **Date:** 2026-11-09
- **Decision:** Article rank is recomputed on read (freshness decay is time-dependent). Items use keyset cursors (`publishedAt`, `id`); CVE, breach and release lists use opaque offset cursors. Search turns free text into a quoted-terms FTS5 query (letters and digits only, last term as prefix) and uses escaped `LIKE` for CVEs, repositories and releases; operators, column filters and wildcards typed by the user are inert.
- **CVE scope:** bare CVE ids extracted from articles (no NVD, KEV or GHSA data) are hidden from lists. Matching watchlist labels are stored on each CVE (`watchlist_json`) so filters run in SQL; the collector recomputes them at boot and daily so watchlist edits propagate.

## ADR-028 — Custom sources are HTTPS-only at the schema level too

- **Date:** 2026-11-09
- **Decision:** `POST /api/sources` and `/api/import` reject non-HTTPS URLs in the Zod schema (400), on top of safeFetch's custom policy. Adding a source re-runs the full feed validation server-side; the client's earlier "Test feed" is never trusted. Imports skip known URLs and respect the 100-source cap.

## ADR-029 — SSE through the events table

- **Date:** 2026-11-09
- **Decision:** `/api/stream` polls `events` every 2 s (indexed read), resumes from `Last-Event-ID`, sends a heartbeat every 25 s, re-validates the session on each heartbeat and caps concurrent streams at 10. Frames are `JSON.stringify`-ed, so payload newlines cannot inject events.
- **Test alerts:** `/api/alerts/test` is wired to an `AlertSender` interface; Phase 8 provides the Discord/Telegram implementation (until then it answers 409 when no channel is configured).

## ADR-030 — One Trusted Types policy, for the Service Worker only

- **Date:** 2026-11-09
- **Context:** SPEC § 9.2 asks for `require-trusted-types-for 'script'; trusted-types 'none'` and SPEC § 10 for a Service Worker. `navigator.serviceWorker.register()` is a Trusted Types sink (it needs a `TrustedScriptURL`), and `'none'` forbids creating any policy, so both cannot hold at once.
- **Decision:** `trusted-types panel`: exactly one policy may exist, created once in `main.ts`, whose `createScriptURL` only returns the constant `/sw.js` and throws otherwise. No `createHTML` or `createScript` exists, so every HTML and script sink stays blocked. The CSP is defined once in `packages/shared/src/csp.ts` and reused by the API (helmet), the Vite preview server and Caddy.
- **Verified:** in Chromium with the production headers, zero `securitypolicyviolation` events across all routes, theme and pause toggles, while a deliberate `insertAdjacentHTML` throws a `TypeError`.

## ADR-031 — Front-end foundations

- **Date:** 2026-11-09
- **Decision:**
  - Custom Elements use light DOM: one global stylesheet with design tokens, no per-component shadow styles to keep in sync with the CSP.
  - `h()` is the only DOM builder: text nodes only, no inline handlers or `style` attributes, URL attributes limited to same-site paths and http(s).
  - The API client imports the shared contract as types only, so no Zod code ships to the browser (initial JS: 9.5 KB gzipped, budget 60 KB). `DEFAULT_PREFS` moved to a Zod-free module for the same reason, and `@panel/shared` declares `sideEffects: false`.
  - Fonts: `@font-face` rules written by hand for the latin subsets only (Hanken Grotesk 400–700, IBM Plex Mono 400/500, Newsreader variable with the optical-size axis); a 30-line Vite plugin injects `<link rel=preload>` for Hanken 500/600 once hashed names are known. Assets are never inlined as `data:` URIs (`font-src 'self'`).
  - The web app has its own test tsconfig (`moduleResolution: bundler`, Vite types); its declaration output goes to `.tsbuild/` so Vite owns `dist/`.
  - Dark theme: `html[data-theme]` forces a theme, otherwise `prefers-color-scheme` applies; a test keeps both dark blocks identical and checks every text/background token pair at 4.5:1 in both themes.
  - Touch targets grow to 44 px on coarse pointers and phones; the desktop keeps the mockup's 40 px controls.
  - Preferences are cached in LocalStorage (versioned, size-capped) to avoid a theme or language flash; logout clears it and the Service Worker caches.
