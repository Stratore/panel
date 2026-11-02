# Security model

> Filled in progressively as each control is implemented. Source of truth until then: [SPEC.md § 9](SPEC.md#9-sécurité-exigences-détaillées).

## Controls in place (Phase 0)

- **Static guards (ESLint):** `fetch` and raw HTTP modules banned outside `packages/safe-fetch`; `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` banned in the front-end; `sql.raw` banned; `any` banned.
- **Secrets:** `.env` ignored, gitleaks in pre-commit and CI.
- **Supply chain:** frozen lockfile, install scripts denied unless allowlisted, 3-day minimum release age, CI actions pinned by SHA, per-job least-privilege permissions.
