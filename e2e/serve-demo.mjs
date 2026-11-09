// Starts the real API on a throw-away database filled with the fictional demo data (SPEC § 15).
// Used by the Playwright tests and for local visual checks. Requires `pnpm build` first.
// The network is faked: "Test feed" accepts any https URL containing "feed".
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { openDatabase, migrateDatabase, seedDatabase, loadSourcesCatalog, seedDemoData } =
  await import(new URL('../packages/db/dist/index.js', import.meta.url).href);
const { buildApp } = await import(new URL('../apps/api/dist/app.js', import.meta.url).href);
const { noAlerts } = await import(
  new URL('../apps/api/dist/routes/admin.js', import.meta.url).href
);

const FEED =
  '<rss version="2.0"><channel><title>Demo feed</title>' +
  '<item><title>A neutral sample headline</title><link>https://feed.example.org/1</link></item>' +
  '<item><title>Another sample headline</title><link>https://feed.example.org/2</link></item>' +
  '<item><title>A third sample headline</title><link>https://feed.example.org/3</link></item>' +
  '</channel></rss>';

const fakeFetch = (url) => {
  if (!url.startsWith('https://') || !url.includes('feed')) {
    return Promise.reject(
      Object.assign(new Error('resolves to a non-public address'), {
        name: 'SafeFetchError',
        code: 'BLOCKED_ADDRESS',
      }),
    );
  }
  return Promise.resolve({
    status: 200,
    headers: { 'content-type': 'application/rss+xml' },
    body: FEED,
    url,
    bytes: FEED.length,
    durationMs: 312,
    redirects: 0,
  });
};

const dir = mkdtempSync(join(tmpdir(), 'panel-demo-'));
const handle = openDatabase(join(dir, 'panel.db'));
migrateDatabase(handle.db);
seedDatabase(handle.db, loadSourcesCatalog(join(root, 'config', 'sources.default.json')));
seedDemoData(handle.db);

const app = await buildApp({
  db: handle.db,
  sqlite: handle.sqlite,
  safeFetch: fakeFetch,
  alerts: noAlerts({ discord: true, telegram: false }),
  sessionSecret: 'e2e-session-secret-0123456789abcdef0123456789',
  setupToken: process.env.SETUP_TOKEN ?? 'e2e-setup-token',
  logLevel: 'warn',
});

const port = Number(process.env.PORT ?? 3100);
await app.listen({ host: '127.0.0.1', port });
console.log(`demo API on http://127.0.0.1:${port}`);

const stop = async () => {
  await app.close();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
