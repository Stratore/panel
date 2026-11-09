import { randomBytes } from 'node:crypto';
import { count, eq, inArray, max, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schema, type PanelDb } from '@panel/db';
import type { SafeFetch } from '@panel/safe-fetch';
import {
  alertTestDtoSchema,
  exportDtoSchema,
  healthDtoSchema,
  prefsDtoSchema,
  prefsPutBodySchema,
  sourceCreateBodySchema,
  sourceDtoSchema,
  sourcePatchBodySchema,
  sourceValidateBodySchema,
  sourceValidationSchema,
  watchlistEntrySchema,
  type Prefs,
  type SourceDto,
  type WatchlistEntry,
} from '@panel/shared';
import { validateFeed } from '../feeds.js';
import { HttpProblem, parseInput, sendJson } from '../http.js';
import { readPrefs } from './content.js';

const { sources, fetchRuns, prefs, watchlist, items, cves, breaches } = schema;

export const MAX_CUSTOM_SOURCES = 100;

export type AlertChannel = 'discord' | 'telegram';

/** Implemented by the notifier (Phase 8). */
export interface AlertSender {
  configured(): AlertChannel[];
  sendTest(): Promise<{ sent: AlertChannel[]; failed: AlertChannel[] }>;
}

export interface AdminDeps {
  db: PanelDb;
  now: () => Date;
  safeFetch: SafeFetch;
  alerts: AlertSender;
  version: string;
  startedAt: Date;
}

const sourceIdParams = z.strictObject({ id: z.string().regex(/^[a-z0-9-]{2,40}$/) });

function listSources(db: PanelDb): SourceDto[] {
  const latest = db
    .select({ id: max(fetchRuns.id).as('id') })
    .from(fetchRuns)
    .groupBy(fetchRuns.sourceId)
    .all()
    .map((r) => r.id)
    .filter((id): id is number => id !== null);
  const runs =
    latest.length === 0
      ? []
      : db.select().from(fetchRuns).where(inArray(fetchRuns.id, latest)).all();
  return db
    .select()
    .from(sources)
    .orderBy(sources.group, sources.name)
    .all()
    .map((row) => {
      const run = runs.find((r) => r.sourceId === row.id);
      return {
        id: row.id,
        name: row.name,
        group: row.group,
        kind: row.kind,
        adapter: row.adapter,
        url: row.url,
        lang: row.lang,
        category: row.categoryDefault,
        enabled: row.enabled,
        isCustom: row.isCustom,
        weight: row.weight,
        health: row.health,
        consecutiveFailures: row.consecutiveFailures,
        lastRun: run
          ? {
              status: run.status,
              at: run.startedAt.toISOString(),
              durationMs: run.durationMs,
              httpStatus: run.httpStatus,
              itemsNew: run.itemsNew,
              error: run.error,
            }
          : null,
      };
    });
}

function sourceById(db: PanelDb, id: string): SourceDto {
  const found = listSources(db).find((s) => s.id === id);
  if (!found) throw new HttpProblem(404, 'Not Found', 'Unknown source.');
  return found;
}

function readWatchlist(db: PanelDb): WatchlistEntry[] {
  return db
    .select()
    .from(watchlist)
    .orderBy(watchlist.label)
    .all()
    .flatMap((row) => {
      const parsed = watchlistEntrySchema.safeParse({
        id: row.id,
        label: row.label,
        keywords: row.keywordsJson,
        cpePatterns: row.cpePatternsJson,
        enabled: row.enabled,
      });
      return parsed.success ? [parsed.data] : [];
    });
}

function writePrefs(db: Pick<PanelDb, 'insert'>, value: Prefs): void {
  db.insert(prefs)
    .values({ key: 'prefs', valueJson: value })
    .onConflictDoUpdate({ target: prefs.key, set: { valueJson: value } })
    .run();
}

function replaceWatchlist(
  db: Pick<PanelDb, 'insert' | 'delete'>,
  entries: readonly WatchlistEntry[],
): void {
  db.delete(watchlist).run();
  if (entries.length === 0) return;
  db.insert(watchlist)
    .values(
      entries.map((e) => ({
        id: e.id,
        label: e.label,
        keywordsJson: e.keywords,
        cpePatternsJson: e.cpePatterns,
        enabled: e.enabled,
      })),
    )
    .run();
}

function insertCustomSource(
  db: Pick<PanelDb, 'insert'>,
  source: {
    name: string;
    url: string;
    lang: 'en' | 'fr';
    category: SourceDto['category'];
    enabled: boolean;
  },
  now: Date,
): string {
  const id = `custom-${randomBytes(4).toString('hex')}`;
  db.insert(sources)
    .values({
      id,
      name: source.name,
      group: 'custom',
      kind: 'article',
      adapter: 'rss',
      url: source.url,
      lang: source.lang,
      categoryDefault: source.category,
      schedule: '0 * * * *',
      enabled: source.enabled,
      isCustom: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): void {
  const { db } = deps;

  // --- Sources ---------------------------------------------------------------------------

  app.get('/api/sources', (_request, reply) =>
    sendJson(reply, z.array(sourceDtoSchema), listSources(db)),
  );

  app.post(
    '/api/sources/validate',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { url } = parseInput(sourceValidateBodySchema, request.body);
      return sendJson(reply, sourceValidationSchema, await validateFeed(deps.safeFetch, url));
    },
  );

  app.post(
    '/api/sources',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parseInput(sourceCreateBodySchema, request.body);
      const customCount =
        db.select({ n: count() }).from(sources).where(eq(sources.isCustom, true)).get()?.n ?? 0;
      if (customCount >= MAX_CUSTOM_SOURCES)
        throw new HttpProblem(409, 'Conflict', 'Too many custom sources.');
      if (db.select({ id: sources.id }).from(sources).where(eq(sources.url, body.url)).get()) {
        throw new HttpProblem(409, 'Conflict', 'This feed is already a source.');
      }
      // Never trust the client's earlier "Test feed": validate again server-side.
      const validation = await validateFeed(deps.safeFetch, body.url);
      if (!validation.ok)
        throw new HttpProblem(422, 'Unprocessable Content', 'The feed did not pass validation.');
      const id = insertCustomSource(db, { ...body, enabled: true }, deps.now());
      return sendJson(reply.code(201), sourceDtoSchema, sourceById(db, id));
    },
  );

  app.patch('/api/sources/:id', (request, reply) => {
    const { id } = parseInput(sourceIdParams, request.params);
    const body = parseInput(sourcePatchBodySchema, request.body);
    const row = db.select().from(sources).where(eq(sources.id, id)).get();
    if (!row) throw new HttpProblem(404, 'Not Found', 'Unknown source.');
    if (!row.isCustom && (body.name !== undefined || body.category !== undefined)) {
      throw new HttpProblem(
        403,
        'Forbidden',
        'Only custom sources can be renamed or recategorized.',
      );
    }
    db.update(sources)
      .set({
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        ...(body.weight === undefined ? {} : { weight: body.weight }),
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.category === undefined ? {} : { categoryDefault: body.category }),
        updatedAt: deps.now(),
      })
      .where(eq(sources.id, id))
      .run();
    return sendJson(reply, sourceDtoSchema, sourceById(db, id));
  });

  app.delete('/api/sources/:id', (request, reply) => {
    const { id } = parseInput(sourceIdParams, request.params);
    const row = db.select().from(sources).where(eq(sources.id, id)).get();
    if (!row) throw new HttpProblem(404, 'Not Found', 'Unknown source.');
    if (!row.isCustom)
      throw new HttpProblem(403, 'Forbidden', 'Built-in sources can be disabled, not deleted.');
    db.delete(sources).where(eq(sources.id, id)).run();
    return reply.code(204).send();
  });

  // --- Preferences -----------------------------------------------------------------------

  const prefsDto = () => {
    const configured = deps.alerts.configured();
    return {
      prefs: readPrefs(db),
      watchlist: readWatchlist(db),
      channels: {
        discord: configured.includes('discord'),
        telegram: configured.includes('telegram'),
      },
    };
  };

  app.get('/api/prefs', (_request, reply) => sendJson(reply, prefsDtoSchema, prefsDto()));

  app.put('/api/prefs', (request, reply) => {
    const body = parseInput(prefsPutBodySchema, request.body);
    db.transaction((tx) => {
      if (body.prefs) writePrefs(tx, body.prefs);
      if (body.watchlist) replaceWatchlist(tx, body.watchlist);
    });
    return sendJson(reply, prefsDtoSchema, prefsDto());
  });

  /** "New since your last visit" (SPEC § 10): the client marks a visit once it has rendered. */
  app.post('/api/visit', (_request, reply) => {
    writePrefs(db, { ...readPrefs(db), lastVisitAt: deps.now().toISOString() });
    return reply.code(204).send();
  });

  // --- Export / import (never any secret) ------------------------------------------------

  app.get('/api/export', (_request, reply) => {
    const custom = db.select().from(sources).where(eq(sources.isCustom, true)).all();
    void reply.header('content-disposition', 'attachment; filename="panel-config.json"');
    return sendJson(reply, exportDtoSchema, {
      version: 1,
      exportedAt: deps.now().toISOString(),
      prefs: readPrefs(db),
      watchlist: readWatchlist(db),
      customSources: custom.map((s) => ({
        name: s.name,
        url: s.url,
        lang: s.lang,
        category: s.categoryDefault ?? 'dev',
        enabled: s.enabled,
      })),
    });
  });

  app.post('/api/import', { bodyLimit: 512 * 1024 }, (request, reply) => {
    const data = parseInput(exportDtoSchema, request.body);
    const now = deps.now();
    db.transaction((tx) => {
      writePrefs(tx, data.prefs);
      replaceWatchlist(tx, data.watchlist);
      const known = new Set(
        tx
          .select({ url: sources.url })
          .from(sources)
          .all()
          .map((s) => s.url),
      );
      const customCount =
        tx.select({ n: count() }).from(sources).where(eq(sources.isCustom, true)).get()?.n ?? 0;
      let room = MAX_CUSTOM_SOURCES - customCount;
      // Imported URLs are not fetched here; the collector reaches them through safeFetch's
      // strictest (custom) policy, like any user source.
      for (const source of data.customSources) {
        if (known.has(source.url) || room <= 0) continue;
        insertCustomSource(tx, source, now);
        known.add(source.url);
        room--;
      }
    });
    return sendJson(reply, prefsDtoSchema, prefsDto());
  });

  // --- Alerts ----------------------------------------------------------------------------

  app.post(
    '/api/alerts/test',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      if (deps.alerts.configured().length === 0) {
        throw new HttpProblem(409, 'Conflict', 'No alert channel is configured.');
      }
      return sendJson(reply, alertTestDtoSchema, await deps.alerts.sendTest());
    },
  );

  // --- Health ----------------------------------------------------------------------------

  app.get('/api/health/live', { config: { public: true } }, (_request, reply) =>
    reply.send({ status: 'ok' }),
  );

  app.get('/api/health', (_request, reply) => {
    const all = db
      .select({ health: sources.health, enabled: sources.enabled })
      .from(sources)
      .all()
      .filter((s) => s.enabled);
    const counts = (table: typeof items | typeof cves | typeof breaches) =>
      db.select({ n: count() }).from(table).get()?.n ?? 0;
    const lastCollect = db
      .select({ at: max(fetchRuns.finishedAt) })
      .from(fetchRuns)
      .where(sql`${fetchRuns.status} != 'error'`)
      .get()?.at;
    const degraded = all.filter((s) => s.health === 'degraded').length;
    return sendJson(reply, healthDtoSchema, {
      status: degraded > 0 ? 'degraded' : 'ok',
      version: deps.version,
      uptimeSeconds: Math.floor((deps.now().getTime() - deps.startedAt.getTime()) / 1000),
      sources: {
        total: all.length,
        healthy: all.filter((s) => s.health === 'healthy' || s.health === 'slow').length,
        degraded,
        failing: all.filter((s) => s.health === 'failing').length,
      },
      counts: { items: counts(items), cves: counts(cves), breaches: counts(breaches) },
      lastCollectAt: lastCollect ? lastCollect.toISOString() : null,
    });
  });
}

/** Until the notifier exists (Phase 8), channels are reported but nothing is sent. */
export function noAlerts(channels: { discord: boolean; telegram: boolean }): AlertSender {
  const configured: AlertChannel[] = [];
  if (channels.discord) configured.push('discord');
  if (channels.telegram) configured.push('telegram');
  return {
    configured: () => configured,
    sendTest: () => Promise.resolve({ sent: [], failed: configured }),
  };
}
