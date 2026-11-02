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
