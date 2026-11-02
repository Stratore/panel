import { chmodSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

export const BACKUPS_KEPT = 7;
const BACKUP_NAME = /^panel-\d{8}T\d{6}Z\.db$/;

function backupName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
  return `panel-${stamp}Z.db`;
}

/**
 * Consistent online copy through SQLite's backup API (safe while the collector writes),
 * then rotation: only the `keep` most recent `panel-*.db` files are kept.
 */
export async function backupDatabase(
  sqlite: Database.Database,
  directory: string,
  options: { now?: Date; keep?: number } = {},
): Promise<string> {
  const now = options.now ?? new Date();
  const keep = options.keep ?? BACKUPS_KEPT;
  /* eslint-disable security/detect-non-literal-fs-filename -- configured backup directory, not user input */
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, backupName(now));
  await sqlite.backup(target);
  if (process.platform !== 'win32') chmodSync(target, 0o600);

  const backups = readdirSync(directory)
    .filter((name) => BACKUP_NAME.test(name))
    .sort()
    .reverse();
  for (const old of backups.slice(keep)) rmSync(join(directory, old));
  /* eslint-enable security/detect-non-literal-fs-filename */
  return target;
}
