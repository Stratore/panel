import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { loadSourcesCatalog, migrateDatabase, openDatabase, schema, seedDatabase } from '@panel/db';
import { safeFetch } from '@panel/safe-fetch';
import { compileKeywords, keywordsConfigSchema, watchlistEntrySchema } from '@panel/shared';
import { createAdapters } from './adapters/index.js';
import { loadConfig } from './config.js';
import { TaskQueue } from './scheduler/queue.js';
import { runSource, type RunnerDeps } from './scheduler/runner.js';
import { intervalOf, startScheduler } from './scheduler/scheduler.js';

const config = loadConfig();
const logger = pino({
  level: config.logLevel,
  base: { service: 'collector' },
  // Secrets never reach the logs, even if an object carrying them is logged by mistake.
  redact: {
    paths: ['*.apiKey', '*.authorization', '*.token', '*.githubToken', '*.nvdApiKey', 'secrets'],
    censor: '[redacted]',
  },
});

// eslint-disable-next-line security/detect-non-literal-fs-filename -- path from deployment config
mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
const handle = openDatabase(config.databasePath);
migrateDatabase(handle.db);
const seeded = seedDatabase(handle.db, loadSourcesCatalog(config.sourcesPath));
logger.info({ ...seeded, database: config.databasePath }, 'database ready');

// eslint-disable-next-line security/detect-non-literal-fs-filename -- path from deployment config
const keywordsFile = readFileSync(config.keywordsPath, 'utf8');
const keywords = compileKeywords(keywordsConfigSchema.parse(JSON.parse(keywordsFile)));
const loadWatchlist = () =>
  handle.db
    .select()
    .from(schema.watchlist)
    .all()
    .map((row) =>
      watchlistEntrySchema.parse({
        id: row.id,
        label: row.label,
        keywords: row.keywordsJson,
        cpePatterns: row.cpePatternsJson,
        enabled: row.enabled,
      }),
    );

const deps: RunnerDeps = {
  db: handle.db,
  adapters: createAdapters(),
  pipeline: {
    keywords,
    get watchlist() {
      return loadWatchlist();
    },
  },
  safeFetch,
  queue: new TaskQueue(4),
  secrets: config.secrets,
  userAgent: config.userAgent,
  logger,
  now: () => new Date(),
  sleep: (ms) => sleep(ms),
  random: Math.random,
};

const enabledSources = () =>
  handle.db
    .select({ id: schema.sources.id, schedule: schema.sources.schedule })
    .from(schema.sources)
    .where(eq(schema.sources.enabled, true))
    .all();

/** Runs every enabled source once; the queue enforces the concurrency limits. */
async function runAll(only?: string): Promise<void> {
  const targets = enabledSources().filter((s) => only === undefined || s.id === only);
  // EPSS last: it scores the CVEs the other sources just stored.
  const run = (s: { id: string; schedule: string }) =>
    runSource(s.id, deps, { intervalMs: intervalOf(s.schedule) });
  await Promise.all(targets.filter((s) => s.id !== 'epss').map(run));
  await Promise.all(targets.filter((s) => s.id === 'epss').map(run));
}

const args = process.argv.slice(2);
if (args[0] === '--once') {
  await runAll(args[1]);
  handle.close();
  logger.info('one-shot collection finished');
} else {
  const scheduler = startScheduler(deps, { sqlite: handle.sqlite, backupDir: config.backupDir });
  void runAll();
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    scheduler.stop();
    handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}
