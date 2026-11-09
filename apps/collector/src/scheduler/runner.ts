import { desc, eq } from 'drizzle-orm';
import { schema, type PanelDb } from '@panel/db';
import { isSafeFetchError, type SafeFetch } from '@panel/safe-fetch';
import { normalizedItemSchema, type NormalizedItem, type SourceHealth } from '@panel/shared';
import type { AdapterRegistry } from '../adapters/index.js';
import type { AdapterFetchOptions, FetchContext, SourceConfig } from '../adapters/types.js';
import { cveIdsNeedingEpss } from '../pipeline/cves.js';
import { processItems, type PipelineDeps, type PipelineResult } from '../pipeline/index.js';
import { domainKey, type TaskQueue } from './queue.js';
import { assertOk, HttpStatusError, withRetry } from './retry.js';

const { sources, fetchRuns, events } = schema;

/** SPEC § 7.3 circuit breaker. */
export const BREAKER = {
  failureThreshold: 5,
  intervalMultiplier: 4,
  maxCooldownMs: 6 * 3_600_000,
  slowMs: 3_000,
} as const;

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface RunnerDeps {
  db: PanelDb;
  adapters: AdapterRegistry;
  pipeline: PipelineDeps;
  safeFetch: SafeFetch;
  queue: TaskQueue;
  secrets: { nvdApiKey?: string | undefined; githubToken?: string | undefined };
  userAgent: string;
  logger: Logger;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export type RunOutcome =
  | { status: 'skipped'; reason: 'unknown' | 'disabled' | 'cooling_down' }
  | { status: 'not_modified' }
  | { status: 'ok'; result: PipelineResult; dropped: number }
  | { status: 'error'; error: string };

/** Error text safe for storage and logs: no newlines (log injection), bounded length. */
export function describeError(error: unknown): string {
  const text = isSafeFetchError(error)
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? `${error.name}: ${error.message}`
      : 'Unknown error';
  return text.replace(/[\r\n\t]+/g, ' ').slice(0, 300);
}

/**
 * Degraded sources (≥ 5 consecutive failures) are retried at 4× their normal interval,
 * capped at 6 h; the first success closes the breaker.
 */
export function isCoolingDown(
  failures: number,
  lastStartedAt: Date | undefined,
  intervalMs: number,
  now: Date,
): boolean {
  if (failures < BREAKER.failureThreshold || lastStartedAt === undefined) return false;
  const cooldown = Math.min(intervalMs * BREAKER.intervalMultiplier, BREAKER.maxCooldownMs);
  return now.getTime() - lastStartedAt.getTime() < cooldown;
}

function toConfig(row: typeof sources.$inferSelect): SourceConfig & { weight: number } {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    adapter: row.adapter as SourceConfig['adapter'],
    url: row.url,
    lang: row.lang,
    categoryDefault: row.categoryDefault,
    product: row.product,
    isCustom: row.isCustom,
    etag: row.etag,
    lastModified: row.lastModified,
    weight: row.weight,
  };
}

/** Runs one source end to end and records the outcome in `fetch_runs` and `sources`. */
export async function runSource(
  sourceId: string,
  deps: RunnerDeps,
  options: { intervalMs?: number; force?: boolean } = {},
): Promise<RunOutcome> {
  const { db } = deps;
  const row = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!row) return { status: 'skipped', reason: 'unknown' };
  if (!row.enabled && options.force !== true) return { status: 'skipped', reason: 'disabled' };

  const startedAt = deps.now();
  const last = db
    .select({ startedAt: fetchRuns.startedAt })
    .from(fetchRuns)
    .where(eq(fetchRuns.sourceId, sourceId))
    .orderBy(desc(fetchRuns.startedAt))
    .limit(1)
    .get();
  if (
    options.force !== true &&
    isCoolingDown(
      row.consecutiveFailures,
      last?.startedAt,
      options.intervalMs ?? 3_600_000,
      startedAt,
    )
  ) {
    return { status: 'skipped', reason: 'cooling_down' };
  }

  const source = toConfig(row);
  const adapter = deps.adapters[source.adapter];
  const ctx: FetchContext = {
    source,
    now: startedAt,
    secrets: deps.secrets,
    sleep: deps.sleep,
    cveIdsForEpss: (limit) => cveIdsNeedingEpss(db, startedAt, limit),
    fetch: (url: string, fetchOptions: AdapterFetchOptions = {}) => {
      const headers: Record<string, string> = { 'user-agent': deps.userAgent };
      // JSON APIs reject our feed-oriented default Accept list (EPSS: "errorNotSupported").
      if (source.adapter !== 'rss') headers['accept'] = 'application/json';
      if (fetchOptions.conditional === true) {
        if (source.etag) headers['if-none-match'] = source.etag;
        if (source.lastModified) headers['if-modified-since'] = source.lastModified;
      }
      Object.assign(headers, fetchOptions.headers);
      return withRetry(
        async () =>
          assertOk(
            await deps.safeFetch(url, { trust: source.isCustom ? 'custom' : 'default', headers }),
            deps.now().getTime(),
          ),
        deps,
      );
    },
  };

  const finish = (
    status: 'ok' | 'not_modified' | 'error',
    fields: {
      httpStatus?: number | null;
      itemsNew?: number;
      bytes?: number;
      error?: string | null;
    },
  ) => {
    const finishedAt = deps.now();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const failures = status === 'error' ? row.consecutiveFailures + 1 : 0;
    const health: SourceHealth =
      status === 'error'
        ? failures >= BREAKER.failureThreshold
          ? 'degraded'
          : 'failing'
        : durationMs >= BREAKER.slowMs
          ? 'slow'
          : 'healthy';
    db.transaction((tx) => {
      tx.insert(fetchRuns)
        .values({
          sourceId,
          startedAt,
          finishedAt,
          status,
          httpStatus: fields.httpStatus ?? null,
          itemsNew: fields.itemsNew ?? 0,
          bytes: fields.bytes ?? 0,
          durationMs,
          error: fields.error ?? null,
        })
        .run();
      tx.update(sources)
        .set({ health, consecutiveFailures: failures, updatedAt: finishedAt })
        .where(eq(sources.id, sourceId))
        .run();
      if (health !== row.health) {
        tx.insert(events)
          .values({
            type: 'source.health',
            payloadJson: { sourceId, health },
            createdAt: finishedAt,
          })
          .run();
      }
    });
    return health;
  };

  try {
    const fetched = await deps.queue.run(domainKey(source.url), () => adapter.fetch(ctx));
    if (fetched.status === 'not_modified') {
      // A 304 costs no parsing and no database work beyond the run log.
      finish('not_modified', { httpStatus: 304 });
      deps.logger.info({ sourceId }, 'source not modified');
      return { status: 'not_modified' };
    }

    const candidates = adapter.normalize(fetched.raw, { source, now: startedAt });
    const valid: NormalizedItem[] = [];
    for (const candidate of candidates) {
      const parsed = normalizedItemSchema.safeParse(candidate);
      if (parsed.success) valid.push(parsed.data);
    }
    const dropped = candidates.length - valid.length;
    const result = processItems(db, source, valid, deps.pipeline, startedAt);

    db.update(sources)
      .set({
        etag: fetched.etag ?? source.etag,
        lastModified: fetched.lastModified ?? source.lastModified,
      })
      .where(eq(sources.id, sourceId))
      .run();
    finish('ok', {
      httpStatus: fetched.httpStatus,
      itemsNew: result.inserted,
      bytes: fetched.bytes,
    });
    deps.logger.info({ sourceId, ...result, dropped }, 'source run ok');
    return { status: 'ok', result, dropped };
  } catch (error) {
    const message = describeError(error);
    const health = finish('error', {
      httpStatus: error instanceof HttpStatusError ? error.status : null,
      error: message,
    });
    deps.logger.warn({ sourceId, error: message, health }, 'source run failed');
    return { status: 'error', error: message };
  }
}
