# Panel

A self-hosted tech & cyber watch dashboard: a living front page for IT news, plus continuous monitoring of CVEs, actively exploited vulnerabilities (CISA KEV), major data breaches and software releases.

> **Status:** early development (Phase 0: foundations). The full specification is in [docs/SPEC.md](docs/SPEC.md).

## Development

Requirements: Node.js 26 LTS (see `.nvmrc`), pnpm 12, and [gitleaks](https://github.com/gitleaks/gitleaks) for the pre-commit hook.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Run locally (three terminals): `pnpm --filter @panel/collector collect:once` fills the database, `SESSION_SECRET=… node apps/api/dist/server.js` starts the API on port 3000, and `pnpm --filter @panel/web dev` serves the interface on port 5173 (or `preview` on 4173 with the production security headers).

## License

[MIT](LICENSE)
