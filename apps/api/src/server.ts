import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { count } from 'drizzle-orm';
import { migrateDatabase, openDatabase, schema } from '@panel/db';
import { safeFetch } from '@panel/safe-fetch';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { noAlerts } from './routes/admin.js';

const config = loadConfig();
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path from deployment config
mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
const handle = openDatabase(config.databasePath);
migrateDatabase(handle.db);

const app = await buildApp({
  db: handle.db,
  safeFetch,
  alerts: noAlerts(config.channels),
  sessionSecret: config.sessionSecret,
  setupToken: config.setupToken,
  publicOrigin: config.publicOrigin,
  trustProxy: config.trustProxy,
  version: config.version,
  logLevel: config.logLevel,
});

const users = handle.db.select({ n: count() }).from(schema.users).get()?.n ?? 0;
if (users === 0) {
  // SPEC § 9.5: the one-time token is only shown in this container's logs.
  app.log.warn(
    config.setupTokenGenerated ? { setupToken: config.setupToken } : {},
    config.setupTokenGenerated
      ? 'First launch: open /setup and use this one-time setup token'
      : 'First launch: open /setup and use the SETUP_TOKEN from your environment',
  );
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  handle.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
