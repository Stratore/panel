import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { PanelDb } from '@panel/db';
import { schema } from '@panel/db';
import {
  cvePriority,
  matchWatchlist,
  type CveItem,
  type EpssPatch,
  type GhsaPatch,
  type KevPatch,
  type WatchlistEntry,
} from '@panel/shared';

const { cves } = schema;
type Tx = Parameters<Parameters<PanelDb['transaction']>[0]>[0];
type Db = PanelDb | Tx;

/** KEV additions older than this are history (initial catalog sync), not news. */
export const KEV_NEWS_DAYS = 7;

export interface CveChange {
  cveId: string;
  isNew: boolean;
  kevAdded: boolean;
}

export function upsertNvdCve(db: Db, item: CveItem): CveChange {
  const existing = db
    .select({ cveId: cves.cveId })
    .from(cves)
    .where(eq(cves.cveId, item.cveId))
    .get();
  const nvdFields = {
    descriptionEn: item.description,
    cvss: item.cvss,
    cvssVersion: item.cvssVersion,
    vector: item.vector,
    severity: item.severity,
    cpesJson: item.cpes,
    affectedJson: item.affected,
    referencesJson: item.references,
    hasPublicExploit: item.hasPublicExploit,
    published: new Date(item.published),
    modified: new Date(item.modified),
  };
  db.insert(cves)
    .values({
      cveId: item.cveId,
      ...nvdFields,
      cwe: item.cwe,
      product: item.product,
      fixedVersions: item.fixedVersions,
    })
    .onConflictDoUpdate({
      target: cves.cveId,
      set: {
        ...nvdFields,
        // KEV/GHSA may already know these better: only fill gaps.
        cwe: sql`coalesce(${cves.cwe}, excluded.cwe)`,
        product: sql`coalesce(${cves.product}, excluded.product)`,
        fixedVersions: sql`coalesce(excluded.fixed_versions, ${cves.fixedVersions})`,
      },
    })
    .run();
  return { cveId: item.cveId, isNew: existing === undefined, kevAdded: false };
}

export function applyKevPatch(db: Db, patch: KevPatch, now: Date): CveChange {
  const existing = db.select({ kev: cves.kev }).from(cves).where(eq(cves.cveId, patch.cveId)).get();
  const kevFields = {
    kev: true,
    kevName: patch.name,
    kevAdded: patch.dateAdded,
    kevDue: patch.dueDate,
    kevRansomware: patch.ransomware,
    product: patch.product,
  };
  db.insert(cves)
    .values({ cveId: patch.cveId, ...kevFields, cwe: patch.cwe })
    .onConflictDoUpdate({
      target: cves.cveId,
      set: { ...kevFields, cwe: sql`coalesce(${cves.cwe}, excluded.cwe)` },
    })
    .run();
  const recent = now.getTime() - Date.parse(patch.dateAdded) <= KEV_NEWS_DAYS * 86_400_000;
  return {
    cveId: patch.cveId,
    isNew: existing === undefined,
    kevAdded: existing?.kev !== true && recent,
  };
}

export function applyEpssPatch(db: Db, patch: EpssPatch): CveChange | null {
  const result = db
    .update(cves)
    .set({ epss: patch.epss, epssPercentile: patch.percentile, epssDate: patch.date })
    .where(eq(cves.cveId, patch.cveId))
    .run();
  return result.changes > 0 ? { cveId: patch.cveId, isNew: false, kevAdded: false } : null;
}

export function applyGhsaPatch(db: Db, patch: GhsaPatch): CveChange {
  const existing = db
    .select({ cveId: cves.cveId })
    .from(cves)
    .where(eq(cves.cveId, patch.cveId))
    .get();
  db.insert(cves)
    .values({
      cveId: patch.cveId,
      ghsaId: patch.ghsaId,
      ghsaSeverity: patch.severity,
      product: patch.product,
      fixedVersions: patch.fixedVersions,
    })
    .onConflictDoUpdate({
      target: cves.cveId,
      set: {
        ghsaId: patch.ghsaId,
        ghsaSeverity: patch.severity,
        product: sql`coalesce(${cves.product}, excluded.product)`,
        fixedVersions: sql`coalesce(${cves.fixedVersions}, excluded.fixed_versions)`,
      },
    })
    .run();
  return { cveId: patch.cveId, isNew: existing === undefined, kevAdded: false };
}

/** Recomputes the 0–100 priority (SPEC § 7.6) of the given CVEs. */
export function refreshPriorities(
  db: Db,
  cveIds: readonly string[],
  watchlist: readonly WatchlistEntry[],
): void {
  for (let i = 0; i < cveIds.length; i += 500) {
    const rows = db
      .select()
      .from(cves)
      .where(inArray(cves.cveId, cveIds.slice(i, i + 500)))
      .all();
    for (const row of rows) {
      const text = [row.product, row.kevName, row.descriptionEn].filter(Boolean).join(' ');
      const labels = matchWatchlist(watchlist, { text, cpes: row.cpesJson });
      const priority = cvePriority({
        cvss: row.cvss,
        ghsaSeverity: row.ghsaSeverity,
        epssPercentile: row.epssPercentile,
        kev: row.kev,
        watchlistMatch: labels.length > 0,
      });
      const labelsChanged = labels.join('\n') !== row.watchlistJson.join('\n');
      if (priority !== row.priority || labelsChanged) {
        db.update(cves)
          .set({ priority, watchlistJson: labels })
          .where(eq(cves.cveId, row.cveId))
          .run();
      }
    }
  }
}

/** CVEs worth an EPSS lookup: recent or KEV, with no score from today. */
export function cveIdsNeedingEpss(db: PanelDb, now: Date, limit: number): string[] {
  const today = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 30 * 86_400_000);
  return db
    .select({ cveId: cves.cveId })
    .from(cves)
    .where(
      and(
        or(isNull(cves.epssDate), lt(cves.epssDate, today)),
        or(gte(cves.published, since), eq(cves.kev, true)),
      ),
    )
    .orderBy(desc(cves.published))
    .limit(limit)
    .all()
    .map((row) => row.cveId);
}

/**
 * Recomputes every CVE's priority and watchlist labels. Run at boot and daily, so edits to
 * the watchlist (made through the API) and schema upgrades reach all records.
 */
export function refreshAllPriorities(db: PanelDb, watchlist: readonly WatchlistEntry[]): number {
  const ids = db
    .select({ cveId: cves.cveId })
    .from(cves)
    .all()
    .map((row) => row.cveId);
  db.transaction(
    (tx) => {
      refreshPriorities(tx, ids, watchlist);
    },
    { behavior: 'immediate' },
  );
  return ids.length;
}
