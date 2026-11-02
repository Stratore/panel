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
