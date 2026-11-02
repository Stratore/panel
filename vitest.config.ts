import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['source'],
  },
  test: {
    projects: ['packages/*', 'apps/*'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/*/src/**'],
      exclude: ['**/*.test.ts', '**/__fixtures__/**'],
      // SPEC § 9.7: ≥ 80 % on shared, safe-fetch and the collector pipeline.
      thresholds: {
        'packages/shared/src/**': { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
  },
});
