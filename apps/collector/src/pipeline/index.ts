import { createHash } from 'node:crypto';
import { and, count, eq, gte } from 'drizzle-orm';
import type { PanelDb } from '@panel/db';
import { schema } from '@panel/db';
import {
  articleRank,
  canonicalizeUrl,
  classify,
  CLUSTER_WINDOW_HOURS,
  extractCveIds,
  jaccard,
  CLUSTER_THRESHOLD,
  matchWatchlist,
  titleShingles,
  type ArticleItem,
  type CompiledKeywords,
  type NormalizedItem,
  type WatchlistEntry,
} from '@panel/shared';
import type { SourceConfig } from '../adapters/types.js';
import {
  applyEpssPatch,
  applyGhsaPatch,
  applyKevPatch,
  refreshPriorities,
  upsertNvdCve,
  type CveChange,
} from './cves.js';

const { items, itemCves, cves, releases, breaches, repos, repoStars, events, sources } = schema;
type Tx = Parameters<Parameters<PanelDb['transaction']>[0]>[0];

export interface PipelineDeps {
  keywords: CompiledKeywords;
  watchlist: readonly WatchlistEntry[];
}

export interface PipelineSource extends SourceConfig {
  weight: number;
}

export interface PipelineResult {
  inserted: number;
  updated: number;
  newCves: number;
  events: number;
}

const WINDOW_MS = CLUSTER_WINDOW_HOURS * 3_600_000;
/**
 * Only fresh, high-signal CVEs are pushed live: a bulk NVD sync touches thousands of old
 * records (≈ 4 000 high/critical ones on a first 7-day sync) and would flood the stream.
 */
const LIVE_SEVERITIES = new Set(['critical', 'high']);
export const LIVE_CVE_MAX_AGE_MS = 48 * 3_600_000;

export const urlHash = (canonicalUrl: string): string =>
  createHash('sha256').update(canonicalUrl).digest('hex');

interface ClusterCandidate {
  id: number;
  clusterId: string;
  publishedAt: Date;
  shingles: Set<string>;
}

/**
 * `normalize → dedupe → cluster → classify → score → store → emit` for one source run
 * (SPEC § 7.2), in a single transaction. Alert evaluation hooks onto the returned changes
 * in the notifier (Phase 8).
 */
export function processItems(
  db: PanelDb,
  source: PipelineSource,
  batch: readonly NormalizedItem[],
  deps: PipelineDeps,
  now: Date,
): PipelineResult {
  return db.transaction(
    (tx) => {
      const result: PipelineResult = { inserted: 0, updated: 0, newCves: 0, events: 0 };
      const emit = (type: 'item.new' | 'cve.updated', payload: Record<string, unknown>) => {
        tx.insert(events).values({ type, payloadJson: payload, createdAt: now }).run();
        result.events++;
      };
      const cveChanges: CveChange[] = [];
      let candidates: ClusterCandidate[] | null = null;

      for (const item of batch) {
        switch (item.kind) {
          case 'article': {
            candidates ??= loadClusterCandidates(tx, batch, now);
            const stored = storeArticle(tx, source, item, deps, candidates, now);
            if (stored === 'updated') result.updated++;
            if (stored !== null && stored !== 'updated') {
              result.inserted++;
              emit('item.new', stored);
            }
            break;
          }
          case 'release': {
            const inserted = tx
              .insert(releases)
              .values({
                product: item.product,
                version: item.version,
                isSecurity: item.isSecurity,
                url: item.url,
                publishedAt: new Date(item.publishedAt),
              })
              .onConflictDoNothing()
              .run().changes;
            if (inserted > 0) {
              result.inserted++;
              emit('item.new', {
                kind: 'release',
                product: item.product,
                version: item.version,
                isSecurity: item.isSecurity,
                url: item.url,
              });
            }
            break;
          }
          case 'breach': {
            const existed = tx
              .select({ name: breaches.name })
              .from(breaches)
              .where(eq(breaches.name, item.name))
              .get();
            const fields = {
              title: item.title,
              domain: item.domain,
              accounts: item.accounts,
              dataClassesJson: item.dataClasses,
              breachDate: item.breachDate,
              addedDate: new Date(item.addedDate),
              isVerified: item.isVerified,
              isSensitive: item.isSensitive,
            };
            tx.insert(breaches)
              .values({ name: item.name, ...fields })
              .onConflictDoUpdate({ target: breaches.name, set: fields })
              .run();
            if (existed === undefined) {
              result.inserted++;
              emit('item.new', {
                kind: 'breach',
                name: item.name,
                title: item.title,
                accounts: item.accounts,
              });
            } else {
              result.updated++;
            }
            break;
          }
          case 'repo': {
            const fields = {
              description: item.description,
              language: item.language,
              url: item.url,
              createdAt: new Date(item.createdAt),
            };
            const existed = tx
              .select({ n: repos.fullName })
              .from(repos)
              .where(eq(repos.fullName, item.fullName))
              .get();
            tx.insert(repos)
              .values({ fullName: item.fullName, ...fields })
              .onConflictDoUpdate({ target: repos.fullName, set: fields })
              .run();
            tx.insert(repoStars)
              .values({
                fullName: item.fullName,
                day: now.toISOString().slice(0, 10),
                stars: item.stars,
              })
              .onConflictDoUpdate({
                target: [repoStars.fullName, repoStars.day],
                set: { stars: item.stars },
              })
              .run();
            if (existed === undefined) result.inserted++;
            else result.updated++;
            break;
          }
          case 'cve': {
            const change = upsertNvdCve(tx, item);
            cveChanges.push(change);
            if (change.isNew) {
              result.inserted++;
              result.newCves++;
              const fresh = now.getTime() - Date.parse(item.published) <= LIVE_CVE_MAX_AGE_MS;
              if (fresh && item.severity !== null && LIVE_SEVERITIES.has(item.severity)) {
                emit('cve.updated', {
                  cveId: item.cveId,
                  severity: item.severity,
                  cvss: item.cvss,
                });
              }
            } else {
              result.updated++;
            }
            break;
          }
          case 'cve-kev': {
            const change = applyKevPatch(tx, item, now);
            cveChanges.push(change);
            if (change.isNew) result.newCves++;
            if (change.kevAdded)
              emit('cve.updated', { cveId: item.cveId, kevAdded: true, product: item.product });
            result.updated++;
            break;
          }
          case 'cve-epss': {
            const change = applyEpssPatch(tx, item);
            if (change) {
              cveChanges.push(change);
              result.updated++;
            }
            break;
          }
          case 'cve-ghsa': {
            const change = applyGhsaPatch(tx, item);
            cveChanges.push(change);
            if (change.isNew) result.newCves++;
            result.updated++;
            break;
          }
        }
      }

      refreshPriorities(tx, [...new Set(cveChanges.map((c) => c.cveId))], deps.watchlist);
      return result;
    },
    { behavior: 'immediate' },
  );
}

function loadClusterCandidates(
  tx: Tx,
  batch: readonly NormalizedItem[],
  now: Date,
): ClusterCandidate[] {
  const oldest = batch.reduce(
    (min, item) => (item.kind === 'article' ? Math.min(min, Date.parse(item.publishedAt)) : min),
    now.getTime(),
  );
  return tx
    .select({
      id: items.id,
      title: items.title,
      clusterId: items.clusterId,
      publishedAt: items.publishedAt,
    })
    .from(items)
    .where(and(eq(items.kind, 'article'), gte(items.publishedAt, new Date(oldest - WINDOW_MS))))
    .limit(5000)
    .all()
    .map((row) => ({
      id: row.id,
      clusterId: row.clusterId ?? `i:${String(row.id)}`,
      publishedAt: row.publishedAt,
      shingles: titleShingles(row.title),
    }));
}

function storeArticle(
  tx: Tx,
  source: PipelineSource,
  item: ArticleItem,
  deps: PipelineDeps,
  candidates: ClusterCandidate[],
  now: Date,
): Record<string, unknown> | 'updated' | null {
  const canonical = canonicalizeUrl(item.url);
  if (canonical === null) return null;
  const hash = urlHash(canonical);
  const publishedAt = new Date(item.publishedAt);

  const existing = tx
    .select({ id: items.id, hnPoints: items.hnPoints, clusterId: items.clusterId })
    .from(items)
    .where(eq(items.urlHash, hash))
    .get();
  if (existing) {
    // Same story already stored: only refresh signals that change over time (HN points).
    if (item.hnPoints !== undefined && item.hnPoints !== existing.hnPoints) {
      tx.update(items).set({ hnPoints: item.hnPoints }).where(eq(items.id, existing.id)).run();
      if (existing.clusterId !== null) rerankCluster(tx, existing.clusterId, now);
      return 'updated';
    }
    return null;
  }

  const { category } = classify(
    { title: item.title, summary: item.summary, sourceCategory: source.categoryDefault ?? 'dev' },
    deps.keywords,
  );
  const shingles = titleShingles(item.title);
  const match = candidates.find(
    (c) =>
      Math.abs(c.publishedAt.getTime() - publishedAt.getTime()) <= WINDOW_MS &&
      jaccard(c.shingles, shingles) >= CLUSTER_THRESHOLD,
  );
  const clusterId = match?.clusterId ?? `u:${hash.slice(0, 16)}`;
  const text = `${item.title} ${item.summary}`;

  const inserted = tx
    .insert(items)
    .values({
      sourceId: source.id,
      kind: 'article',
      url: canonical,
      urlHash: hash,
      title: item.title,
      summary: item.summary,
      lang: item.lang,
      author: item.author ?? null,
      publishedAt,
      fetchedAt: now,
      category,
      tagsJson: matchWatchlist(deps.watchlist, { text }),
      clusterId,
      hnPoints: item.hnPoints ?? null,
      extraJson: item.externalId === undefined ? null : { externalId: item.externalId },
    })
    .returning({ id: items.id })
    .get();
  candidates.push({ id: inserted.id, clusterId, publishedAt, shingles });

  for (const cveId of extractCveIds(text)) {
    tx.insert(cves).values({ cveId }).onConflictDoNothing().run();
    tx.insert(itemCves).values({ itemId: inserted.id, cveId }).onConflictDoNothing().run();
  }
  rerankCluster(tx, clusterId, now);

  return {
    kind: 'article',
    id: inserted.id,
    title: item.title,
    url: canonical,
    category,
    sourceId: source.id,
    lang: item.lang,
    publishedAt: item.publishedAt,
    clusterId,
  };
}

/** rank depends on cluster size, so adding a member re-ranks the whole cluster (SPEC § 7.7). */
function rerankCluster(tx: Tx, clusterId: string, now: Date): void {
  const members = tx
    .select({
      id: items.id,
      hnPoints: items.hnPoints,
      publishedAt: items.publishedAt,
      weight: sources.weight,
    })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(eq(items.clusterId, clusterId))
    .all();
  const clusterSize =
    tx.select({ n: count() }).from(items).where(eq(items.clusterId, clusterId)).get()?.n ??
    members.length;
  for (const member of members) {
    const rankScore = articleRank(
      {
        sourceWeight: member.weight,
        clusterSize,
        hnPoints: member.hnPoints ?? 0,
        publishedAt: member.publishedAt,
      },
      now,
    );
    tx.update(items).set({ rankScore }).where(eq(items.id, member.id)).run();
  }
}
