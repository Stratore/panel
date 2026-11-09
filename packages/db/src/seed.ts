import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import {
  DEFAULT_PREFS,
  DEFAULT_WATCHLIST,
  sourcesCatalogSchema,
  type SourcesCatalog,
} from '@panel/shared';
import type { PanelDb } from './client.js';
import { prefs, sources, watchlist } from './schema.js';

export const PREFS_KEY = 'prefs';

/** Reads and validates config/sources.default.json. */
export function loadSourcesCatalog(path: string): SourcesCatalog {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from deployment config
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return sourcesCatalogSchema.parse(raw);
}

export interface SeedResult {
  sources: number;
  watchlistSeeded: boolean;
  prefsSeeded: boolean;
}

/**
 * Idempotent seed, run on every start:
 * - default sources are upserted (catalog fields refreshed; the user's `enabled` toggle,
 *   health and HTTP cache state are preserved);
 * - the default watchlist is inserted only into an empty table, so deletions stick;
 * - default prefs are inserted only when none exist.
 */
export function seedDatabase(db: PanelDb, catalog: SourcesCatalog, now = new Date()): SeedResult {
  return db.transaction(
    (tx) => {
      for (const source of catalog.sources) {
        const catalogFields = {
          name: source.name,
          group: source.group,
          kind: source.kind,
          adapter: source.adapter,
          url: source.url,
          lang: source.lang,
          categoryDefault: source.category,
          product: source.product ?? null,
          schedule: source.schedule,
          weight: source.weight,
          updatedAt: now,
        };
        tx.insert(sources)
          .values({
            id: source.id,
            ...catalogFields,
            enabled: source.enabled,
            isCustom: false,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: sources.id,
            set: catalogFields,
            setWhere: eq(sources.isCustom, false),
          })
          .run();
      }

      const watchlistCount =
        tx
          .select({ n: sql<number>`count(*)` })
          .from(watchlist)
          .get()?.n ?? 0;
      if (watchlistCount === 0) {
        tx.insert(watchlist)
          .values(
            DEFAULT_WATCHLIST.map((entry) => ({
              id: entry.id,
              label: entry.label,
              keywordsJson: entry.keywords,
              cpePatternsJson: entry.cpePatterns,
              enabled: entry.enabled,
            })),
          )
          .run();
      }

      const prefsInsert = tx
        .insert(prefs)
        .values({ key: PREFS_KEY, valueJson: DEFAULT_PREFS })
        .onConflictDoNothing()
        .run();

      return {
        sources: catalog.sources.length,
        watchlistSeeded: watchlistCount === 0,
        prefsSeeded: prefsInsert.changes > 0,
      };
    },
    { behavior: 'immediate' },
  );
}
