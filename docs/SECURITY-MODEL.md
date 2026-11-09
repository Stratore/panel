# Security model

> Filled in progressively as each control is implemented. Source of truth until then: [SPEC.md § 9](SPEC.md#9-sécurité-exigences-détaillées).

## Controls in place (Phase 0)

- **Static guards (ESLint):** `fetch` and raw HTTP modules banned outside `packages/safe-fetch`; `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` banned in the front-end; `sql.raw` banned; `any` banned.
- **Secrets:** `.env` ignored, gitleaks in pre-commit and CI.
- **Supply chain:** frozen lockfile, install scripts denied unless allowlisted, 3-day minimum release age, CI actions pinned by SHA, per-job least-privilege permissions.

## Outbound HTTP: `safeFetch` (Phase 3)

Every outbound request goes through `packages/safe-fetch`. ESLint forbids `fetch`, `undici` and `node:http(s)` everywhere else.

| Threat                         | Control                                                                                                                                                                                    | Test                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| SSRF to internal services      | DNS resolved first; **every** record must be public unicast (private, loopback, link-local, CGNAT/Tailscale, multicast, reserved, documentation, NAT64, 6to4, Teredo, IPv4-mapped refused) | `ip.test.ts`, `fetch.test.ts`       |
| DNS rebinding                  | The connection is pinned to the checked address through a custom `lookup`; DNS is queried once per hop; Host/SNI preserved                                                                 | "pins the connection…"              |
| Redirect to an internal target | Max 3 redirects; each target re-validated (protocol, port, credentials, DNS, IP)                                                                                                           | "revalidates redirects…"            |
| Credential leak on redirect    | Non-allowlisted headers dropped when the origin changes                                                                                                                                    | "drops credentials…"                |
| Protocol / port abuse          | https only for custom sources (http only for opted-in defaults); ports 80/443; no `user:pass@`; URL ≤ 2048                                                                                 | "URL policy"                        |
| Decompression bomb, huge body  | Size measured **after** decompression while streaming, aborted at 5 MB (2 MB custom); declared Content-Length checked first                                                                | "gzip bomb", "endless chunked body" |
| Slowloris / hanging server     | Connect 5 s, total 10 s, caller abort signal                                                                                                                                               | "times out…"                        |
| Unexpected payloads            | Content-Type allowlist (RSS/Atom/XML/JSON/feed+JSON/plain text)                                                                                                                            | "rejects disallowed content types"  |

## XML and HTML (Phase 3)

| Threat                       | Control                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| XXE, billion laughs          | Documents containing `<!DOCTYPE` or `<!ENTITY` are refused before parsing; the parser never expands entities                    |
| Deep nesting, huge documents | 5 M characters max, 64 nested tags max                                                                                          |
| Malformed documents          | Strict well-formedness validation                                                                                               |
| Prototype pollution          | Tag names such as `__proto__` cannot reach `Object.prototype` (tested)                                                          |
| XSS through feed content     | HTML converted to plain text (`sanitize-html`, no tag allowed, script/style contents dropped); rendered with `textContent` only |
| Spoofed titles               | Control, zero-width and bidi-override characters removed                                                                        |

## API (Phase 5)

| Threat                                 | Control                                                                                                                                      | Test                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Unauthenticated access                 | Every `/api` route needs a session except `/auth/session`, `/auth/setup`, `/auth/login`, `/health/live`                                      | "protects every API route"                                                                           |
| Instance takeover at first launch      | `/setup` only while no user exists, one-time token from the container logs, constant-time comparison, transactional re-check                 | "requires the one-time token", "creates the single user once"                                        |
| Brute force                            | Argon2id (m=19 MiB, t=2, p=1), 5 tries / 15 min / IP, exponential delay, generic errors                                                      | "rate-limits login attempts"                                                                         |
| Session theft or replay                | `__Host-` cookie (HttpOnly, Secure, SameSite=Strict), HMAC of the token in the database, rotation at login, 30-day sliding expiry            | "sets a hardened __Host- cookie", "rotates the session", "expires sessions"                          |
| CSRF                                   | SameSite=Strict, mandatory `X-Panel-CSRF` header, Origin check                                                                               | "requires the CSRF header", "refuses cross-origin requests"                                          |
| Injection                              | Zod on every input (strict objects: unknown keys rejected), Drizzle parameters only, FTS query rebuilt from letters and digits, escaped LIKE | "rejects invalid queries", "survives FTS syntax and LIKE wildcards"                                  |
| Information leaks                      | RFC 9457 problems without stack traces, output validated against the contract, secrets never in prefs or export, cookies redacted in logs    | "rejects short passphrases with a problem document and no stack", "never accepts or returns secrets" |
| Clickjacking, sniffing, referrer leaks | CSP of § 9.2 with Trusted Types, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, HSTS, Permissions-Policy, COOP/CORP; no CORS             | "sends the security headers of SPEC § 9.2"                                                           |
| Denial of service                      | Global rate limit (300/min/IP), 64 KB bodies (512 KB for import), list limits of 50, 10 concurrent streams                                   | "answers unknown routes and oversized bodies with problems"                                          |

## Front-end (Phase 6)

| Threat                        | Control                                                                                                                                                                          | Verified by                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| DOM XSS                       | `h()` is the only DOM builder (text nodes, no HTML parsing); ESLint bans `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`; Trusted Types enforced by CSP | `h.test.ts`; browser probe: `insertAdjacentHTML` throws   |
| Malicious links               | `href`/`src` only accept same-site paths or http(s); `javascript:`, `data:`, protocol-relative URLs are dropped                                                                  | "drops inline handlers, style attributes and unsafe URLs" |
| Inline script/style injection | CSP `script-src 'self'`, `style-src 'self'`, no inline script or style in `index.html`; dynamic styles through CSSOM                                                             | Build output check, zero CSP violations in Chromium       |
| Service Worker hijack         | Single Trusted Types policy that only accepts `/sw.js`; the worker caches same-origin GETs only, never `/api/auth`, `/api/stream` or `/api/export`                               | ADR-030                                                   |
| Stale data after logout       | Logout clears LocalStorage entries and every Cache Storage cache                                                                                                                 | `app-context.ts`                                          |
| CSRF from the UI              | Every state-changing call sends `X-Panel-CSRF: 1`, same-origin credentials only                                                                                                  | "sends the CSRF header on state changes only"             |

## Pages (Phase 7)

| Threat                                | Control                                                                                                       | Verified by                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Hostile titles, summaries, references | Rendered as text through `h()`; external links only http(s), `target=_blank` with `rel="noopener noreferrer"` | `ui.ts`, e2e: zero CSP / Trusted Types events |
| SSE payload injection                 | Payload fields coerced to strings and rendered as text; unknown event types ignored                           | `journal.ts`                                  |
| Custom source added without checks    | "Add" stays disabled until a passing validation; the API re-validates on create (ADR-028)                     | e2e: private address refused, Add disabled    |
| Database exfiltration via backup      | `/api/backup` requires a session, is rate limited, `no-store`, never cached by the Service Worker             | `routes.test.ts` (401 without session)        |
| Validation library shipped to clients | Build fails if Zod appears in a browser bundle                                                                | `check-bundle.mjs`                            |
