import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type PanelDb = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  db: PanelDb;
  /** Raw connection, for pragmas and the online backup API only. Queries go through `db`. */
  sqlite: Database.Database;
  close(): void;
}

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Opens the SQLite database with the pragmas required by SPEC § 7.4.
 * The file is restricted to its owner (mode 600) on POSIX systems.
 */
export function openDatabase(file: string, options: { readonly?: boolean } = {}): DatabaseHandle {
  const readonly = options.readonly ?? false;
  const sqlite = new Database(file, { readonly, fileMustExist: readonly });
  if (!readonly) sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  // The API and the collector write the same file: waits up to 5 s for the other writer.
  // Write transactions must use behavior 'immediate' (BEGIN IMMEDIATE): a deferred one that
  // reads, then writes after the other process committed, fails at once (ADR-044).
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  if (file !== ':memory:' && !readonly && process.platform !== 'win32') {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- configured database path, not user input
    chmodSync(file, 0o600);
  }
  return { db: drizzle({ client: sqlite, schema }), sqlite, close: () => sqlite.close() };
}

/** Applies pending migrations. Safe to call on every start. */
export function migrateDatabase(db: PanelDb): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
