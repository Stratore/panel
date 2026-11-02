import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Workspace packages resolve to src/ (see ADR-005), so tests never depend on a prior build.
  resolve: {
    conditions: ['source'],
  },
  ssr: {
    resolve: {
      conditions: ['source'],
      externalConditions: ['source'],
    },
  },
  test: {
    include: ['{apps,packages}/*/src/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/*/src/**'],
      exclude: ['**/*.test.ts', '**/__fixtures__/**'],
      // SPEC § 9.7: ≥ 80 % on shared, safe-fetch and the collector pipeline.
      thresholds: {
        'packages/shared/src/**': { lines: 80, functions: 80, branches: 80, statements: 80 },
        'packages/safe-fetch/src/**': { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
  },
});
