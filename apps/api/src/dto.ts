import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { schema, type PanelDb } from '@panel/db';
import {
  articleRank,
  effectiveCvss,
  type BreachDto,
  type CveDetailDto,
  type CveSummaryDto,
  type ItemDto,
  type ReleaseDto,
} from '@panel/shared';

const { items, sources, itemCves, cves } = schema;

type CveRow = typeof cves.$inferSelect;
const iso = (date: Date | null) => (date === null ? null : date.toISOString());

const clusterSize =
  sql<number>`(select count(*) from items as c where c.cluster_id = ${items.clusterId})`.mapWith(
    Number,
  );

/**
 * Loads articles with their source, cluster size and linked CVEs; the rank is recomputed at
 * read time so freshness decay is always current (SPEC § 7.7).
 */
export function loadItems(
  db: PanelDb,
  options: { where?: SQL | undefined; limit: number; offset?: number; now: Date },
): ItemDto[] {
  const rows = db
    .select({
      id: items.id,
      title: items.title,
      summary: items.summary,
      url: items.url,
      sourceId: items.sourceId,
      sourceName: sources.name,
      weight: sources.weight,
      lang: items.lang,
      category: items.category,
      publishedAt: items.publishedAt,
      hnPoints: items.hnPoints,
      tags: items.tagsJson,
      clusterSize,
    })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(and(eq(items.kind, 'article'), options.where))
    .orderBy(desc(items.publishedAt), desc(items.id))
    .limit(options.limit)
    .offset(options.offset ?? 0)
    .all();

  const cveMap = new Map<number, string[]>();
  if (rows.length > 0) {
    const links = db
      .select()
      .from(itemCves)
      .where(
        inArray(
          itemCves.itemId,
          rows.map((r) => r.id),
        ),
      )
      .all();
    for (const link of links)
      cveMap.set(link.itemId, [...(cveMap.get(link.itemId) ?? []), link.cveId]);
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    lang: row.lang,
    category: row.category,
    publishedAt: row.publishedAt.toISOString(),
    clusterSize: Math.max(1, row.clusterSize),
    hnPoints: row.hnPoints,
    tags: row.tags,
    cveIds: cveMap.get(row.id) ?? [],
    rank: articleRank(
      {
        sourceWeight: row.weight,
        clusterSize: Math.max(1, row.clusterSize),
        hnPoints: row.hnPoints ?? 0,
        publishedAt: row.publishedAt,
      },
      options.now,
    ),
  }));
}

export function toCveSummary(row: CveRow): CveSummaryDto {
  const effective = effectiveCvss(row.cvss, row.ghsaSeverity);
  return {
    cveId: row.cveId,
    product: row.product,
    description: row.descriptionEn,
    cvss: row.cvss,
    cvssEffective: effective.score,
    cvssProvisional: effective.provisional,
    severity: row.severity,
    epss: row.epss,
    epssPercentile: row.epssPercentile,
    kev: row.kev,
    kevAdded: row.kevAdded,
    kevDue: row.kevDue,
    kevRansomware: row.kevRansomware,
    cwe: row.cwe,
    fixedVersions: row.fixedVersions,
    affected: row.affectedJson,
    watchlist: row.watchlistJson,
    hasPublicExploit: row.hasPublicExploit,
    priority: row.priority,
    published: iso(row.published),
  };
}

export function loadCveDetail(db: PanelDb, cveId: string, now: Date): CveDetailDto | null {
  const row = db.select().from(cves).where(eq(cves.cveId, cveId)).get();
  if (!row) return null;
  const linked = db
    .select({ id: itemCves.itemId })
    .from(itemCves)
    .where(eq(itemCves.cveId, cveId))
    .all()
    .map((r) => r.id);
  const articles =
    linked.length === 0
      ? []
      : loadItems(db, { where: inArray(items.id, linked.slice(0, 50)), limit: 20, now });
  return {
    ...toCveSummary(row),
    vector: row.vector,
    cvssVersion: row.cvssVersion,
    references: row.referencesJson,
    kevName: row.kevName,
    ghsaId: row.ghsaId,
    modified: iso(row.modified),
    articles,
  };
}

export const toBreach = (row: typeof schema.breaches.$inferSelect): BreachDto => ({
  name: row.name,
  title: row.title,
  domain: row.domain,
  accounts: row.accounts,
  dataClasses: row.dataClassesJson,
  breachDate: row.breachDate,
  addedDate: row.addedDate.toISOString(),
  isVerified: row.isVerified,
  isSensitive: row.isSensitive,
});

export const toRelease = (row: typeof schema.releases.$inferSelect): ReleaseDto => ({
  id: row.id,
  product: row.product,
  version: row.version,
  isSecurity: row.isSecurity,
  url: row.url,
  publishedAt: row.publishedAt.toISOString(),
});

/** CVE rows that carry real data (bare ids extracted from articles are hidden). */
export const meaningfulCve = sql`(${cves.published} is not null or ${cves.kev} = 1 or ${cves.ghsaId} is not null)`;

/** LIKE pattern for user text, with wildcards escaped (used with `ESCAPE '\'`). */
export const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
