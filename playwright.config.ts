import { defineConfig, devices } from '@playwright/test';

// End-to-end tests (SPEC § 12). Two modes:
// - Default: the real API on a throw-away demo database, served behind the production build of
//   the front-end (`vite preview`, same CSP headers as Caddy). Run `pnpm build` first.
// - PANEL_E2E_URL=https://… : against a fresh deployed stack (Docker, Caddy). The setup token
//   comes from PANEL_E2E_SETUP_TOKEN. Caddy's internal CA is not trusted by the test browser,
//   so certificate errors are ignored in this mode only; the stack's TLS itself is checked by
//   deploy/scripts/check.sh.
// Locally the installed Edge is used; CI installs Playwright's Chromium.
const CI = process.env['CI'] !== undefined;
const API_PORT = 3100;
const WEB_PORT = 4174;
const target = process.env['PANEL_E2E_URL'];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  use: {
    baseURL: target ?? `http://127.0.0.1:${String(WEB_PORT)}`,
    ignoreHTTPSErrors: target !== undefined,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(CI ? {} : { channel: 'msedge' }) },
    },
  ],
  ...(target === undefined
    ? {
        webServer: [
          {
            command: 'node e2e/serve-demo.mjs',
            url: `http://127.0.0.1:${String(API_PORT)}/api/health/live`,
            env: { PORT: String(API_PORT), SETUP_TOKEN: 'e2e-setup-token' },
            reuseExistingServer: false,
            timeout: 60_000,
          },
          {
            command: `node apps/web/node_modules/vite/bin/vite.js preview apps/web --port ${String(WEB_PORT)} --strictPort --host 127.0.0.1`,
            url: `http://127.0.0.1:${String(WEB_PORT)}`,
            env: { PANEL_API_URL: `http://127.0.0.1:${String(API_PORT)}` },
            reuseExistingServer: false,
            timeout: 60_000,
          },
        ],
      }
    : {}),
});
