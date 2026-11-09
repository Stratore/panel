// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Outbound HTTP must go through @panel/safe-fetch (SPEC § 0.5, § 9.3). */
const restrictedHttpImports = [
  { name: 'undici', message: 'Use @panel/safe-fetch for outbound HTTP.' },
  { name: 'node:http', message: 'Use @panel/safe-fetch for outbound HTTP.' },
  { name: 'node:https', message: 'Use @panel/safe-fetch for outbound HTTP.' },
  { name: 'http', message: 'Use @panel/safe-fetch for outbound HTTP.' },
  { name: 'https', message: 'Use @panel/safe-fetch for outbound HTTP.' },
  { name: 'node-fetch', message: 'Use @panel/safe-fetch for outbound HTTP.' },
  { name: 'axios', message: 'Use @panel/safe-fetch for outbound HTTP.' },
];

const restrictedFetchGlobal = {
  name: 'fetch',
  message: 'Use safeFetch from @panel/safe-fetch (front-end: the typed API client).',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'docs/design-reference/**',
      'pnpm-lock.yaml',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  security.configs.recommended,

  {
    languageOptions: {
      parserOptions: {
        // Package tsconfigs exclude tests from the build; tsconfig.test.json covers them.
        project: ['./packages/*/tsconfig.json', './apps/*/tsconfig.json', './tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Flags every bracket access, including literal-union keys; see ADR-009.
      'security/detect-object-injection': 'off',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-globals': ['error', restrictedFetchGlobal],
      'no-restricted-imports': ['error', { paths: restrictedHttpImports }],
      'no-restricted-properties': [
        'error',
        {
          object: 'sql',
          property: 'raw',
          message: 'Raw SQL is forbidden: use parameterized Drizzle queries (SPEC § 0.4).',
        },
      ],
    },
  },

  // Node-side code.
  {
    files: ['apps/api/**', 'apps/collector/**', 'packages/**', '*.js', '*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Front-end: no HTML sinks, DOM only through h() (SPEC § 0.2).
  {
    files: ['apps/web/**'],
    languageOptions: { globals: globals.browser },
    plugins: { 'no-unsanitized': noUnsanitized },
    rules: {
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML)$/]',
          message: 'HTML sinks are forbidden: build DOM with h() and textContent.',
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: 'HTML sinks are forbidden: build DOM with h() and textContent.',
        },
        {
          selector:
            "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
          message: 'HTML sinks are forbidden: build DOM with h() and textContent.',
        },
      ],
    },
  },

  // The one place allowed to perform raw HTTP.
  {
    files: ['packages/safe-fetch/**'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // Tests load fixtures from computed paths and assert on detached mock methods.
  {
    files: ['**/*.test.ts'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Plain JS config files are not type-checked.
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  prettier,
);
