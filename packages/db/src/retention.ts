import { and, eq, lt, sql } from 'drizzle-orm';
import type { PanelDb } from './client.js';
import { alertsSent, cves, events, fetchRuns, items, repoStars, sessions } from './schema.js';

/** Retention windows in days (SPEC § 7.4). KEV CVEs are kept forever. */
export const RETENTION_DAYS = {
  items: 30,
  cves: 365,
  fetchRuns: 7,
  alertsSent: 90,
  repoStars: 30,
  events: 1,
} as const;

export interface PurgeResult {
  items: number;
  cves: number;
  fetchRuns: number;
  alertsSent: number;
  repoStars: number;
  sessions: number;
  events: number;
}

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);
const utcDay = (date: Date) => date.toISOString().slice(0, 10);

/** Daily purge. Deleting items cascades to `item_cves`; triggers keep `items_fts` in sync. */
export function purgeExpired(db: PanelDb, now = new Date()): PurgeResult {
  return db.transaction(
    (tx) => {
      const itemsCutoff = daysBefore(now, RETENTION_DAYS.items);
      const cvesCutoff = daysBefore(now, RETENTION_DAYS.cves);
      return {
        items: tx
          .delete(items)
          .where(and(lt(items.publishedAt, itemsCutoff), lt(items.fetchedAt, itemsCutoff)))
          .run().changes,
        cves: tx
          .delete(cves)
          .where(
            and(
              eq(cves.kev, false),
              lt(sql`coalesce(${cves.published}, ${cves.modified}, 0)`, cvesCutoff.getTime()),
            ),
          )
          .run().changes,
        fetchRuns: tx
          .delete(fetchRuns)
          .where(lt(fetchRuns.startedAt, daysBefore(now, RETENTION_DAYS.fetchRuns)))
          .run().changes,
        alertsSent: tx
          .delete(alertsSent)
          .where(lt(alertsSent.sentAt, daysBefore(now, RETENTION_DAYS.alertsSent)))
          .run().changes,
        repoStars: tx
          .delete(repoStars)
          .where(lt(repoStars.day, utcDay(daysBefore(now, RETENTION_DAYS.repoStars))))
          .run().changes,
        sessions: tx.delete(sessions).where(lt(sessions.expiresAt, now)).run().changes,
        events: tx
          .delete(events)
          .where(lt(events.createdAt, daysBefore(now, RETENTION_DAYS.events)))
          .run().changes,
      };
    },
    { behavior: 'immediate' },
  );
}

/** Weekly maintenance: rebuilds the FTS index segments and compacts the file. */
export function compactDatabase(db: PanelDb): void {
  db.run(sql`INSERT INTO items_fts (items_fts) VALUES ('optimize')`);
  db.run(sql`VACUUM`);
}
