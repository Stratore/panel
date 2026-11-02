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
