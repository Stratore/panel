# CLAUDE.md — Panel

Self-hosted tech & cyber watch dashboard (pnpm monorepo: Fastify API, collector, Vite + Web Components front, SQLite/Drizzle).

**The full, authoritative spec is [docs/SPEC.md](docs/SPEC.md).** Read the relevant section before each phase. Decisions are final: do not re-debate them. When something is missing or an external source changed, pick the safest and simplest option, log it in [docs/DECISIONS.md](docs/DECISIONS.md) (short ADR), and continue.

## Non-negotiable rules (SPEC § 0)

1. Security before features. All external content (feeds, APIs, user URLs) is hostile by default.
2. Front: no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`. DOM only via the `h()` helper (`createElement` + `textContent`). CSP enforces Trusted Types; no inline `style=""` (use CSSOM or classes).
3. No secrets in the repo. `.env` is ignored, `.env.example` documents every variable, gitleaks runs in pre-commit and CI.
4. SQL is parameterized only (Drizzle). Never concatenate strings into a query.
5. Every outbound HTTP request goes through `safeFetch` (`packages/safe-fetch`). Direct `fetch` is banned by ESLint.
6. All incoming data is validated with Zod (API inputs/outputs and adapters).
7. Code, comments, file names and commits in English. UI in English by default with a complete French translation.
8. TypeScript strict everywhere. `any` is forbidden unless justified in a comment.
9. Every phase ends green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then a Conventional Commits commit.
10. No superfluous dependency. Check maintenance and dependency count first, and justify it in `docs/DECISIONS.md`.
11. No AI / LLM calls. Only the `NoneSummarizer` implementation of the `Summarizer` extension point ships.
12. WCAG 2.2 AA: contrast, visible focus, keyboard navigation, `prefers-reduced-motion`, pause control on anything that moves.

## Workflow

- Work phase by phase (SPEC § 14). After each phase: summarize in 5 lines what was done and what remains.
- **Stop and ask for validation at the end of phases 3, 6, 8 and 10.**
- Design references (exported mockups) live in `docs/design-reference/`; replicate their values, never copy their code (they use inline styles and Google Fonts, which the CSP forbids).
