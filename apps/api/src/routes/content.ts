import { and, count, desc, eq, gte, inArray, lt, max, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readPrefs, schema, type PanelDb } from '@panel/db';
import {
  briefDtoSchema,
  breachDtoSchema,
  CATEGORIES,
  cveDetailDtoSchema,
  cveIdSchema,
  cveSummaryDtoSchema,
  cvesQuerySchema,
  itemDtoSchema,
  itemsQuerySchema,
  journalDtoSchema,
  listQuerySchema,
  pageSchema,
  releaseDtoSchema,
  repoDtoSchema,
  searchDtoSchema,
  searchQuerySchema,
  selectFrontPage,
  selectSections,
  sixtyBreach,
  sixtyCritical,
  sixtyKev,
  sixtyRelease,
  sixtyStory,
  type ItemDto,
  type RepoDto,
  type SixtyEntry,
} from '@panel/shared';
import { decodeCursor, encodeCursor, HttpProblem, parseInput, sendJson } from '../http.js';
import {
  likePattern,
  loadCveDetail,
  loadItems,
  meaningfulCve,
  toBreach,
  toCveSummary,
  toRelease,
} from '../dto.js';

const { items, cves, breaches, releases, repos, repoStars, fetchRuns, watchlist } = schema;

const DAY = 86_400_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
/** Articles below this rank are not worth the ticker (SPEC § 7.7, "rang suffisant"). */
const TICKER_MIN_RANK = 0.3;

export interface ContentDeps {
  db: PanelDb;
  now: () => Date;
}

const offsetCursor = z.strictObject({ o: z.int().min(0).max(100_000) });

function page<T>(rows: T[], limit: number, offset: number) {
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit),
    nextCursor: hasMore ? encodeCursor({ o: offset + limit }) : null,
  };
}

function recentCveScope(now: Date): SQL | undefined {
  const since = new Date(now.getTime() - 30 * DAY);
  return and(meaningfulCve, or(gte(cves.published, since), gte(cves.kevAdded, isoDay(since))));
}

const topCves = (db: PanelDb, now: Date, n: number) =>
  db
    .select()
    .from(cves)
    .where(recentCveScope(now))
    .orderBy(desc(cves.priority), desc(cves.cveId))
    .limit(n)
    .all()
    .map(toCveSummary);

function countCves(db: PanelDb, where: SQL | undefined): number {
  return db.select({ n: count() }).from(cves).where(where).get()?.n ?? 0;
}

function trendingRepos(db: PanelDb, now: Date, limit: number): RepoDto[] {
  const today = isoDay(now);
  const yesterday = isoDay(new Date(now.getTime() - DAY));
  const latest = db
    .select({ fullName: repoStars.fullName, day: max(repoStars.day).as('latest_day') })
    .from(repoStars)
    .groupBy(repoStars.fullName)
    .as('latest');
  const rows = db
    .select({ repo: repos, stars: repoStars.stars })
    .from(repos)
    .innerJoin(latest, eq(latest.fullName, repos.fullName))
    .innerJoin(
      repoStars,
      and(eq(repoStars.fullName, repos.fullName), eq(repoStars.day, latest.day)),
    )
    .orderBy(desc(repoStars.stars))
    .limit(limit)
    .all();
  const names = rows.map((r) => r.repo.fullName);
  const history =
    names.length === 0
      ? []
      : db
          .select()
          .from(repoStars)
          .where(
            and(inArray(repoStars.fullName, names), inArray(repoStars.day, [today, yesterday])),
          )
          .all();
  const starsOn = (name: string, day: string) =>
    history.find((h) => h.fullName === name && h.day === day)?.stars;
  return rows.map(({ repo, stars }) => {
    const t = starsOn(repo.fullName, today);
    const y = starsOn(repo.fullName, yesterday);
    return {
      fullName: repo.fullName,
      description: repo.description,
      language: repo.language,
      url: repo.url,
      stars,
      starsToday: t !== undefined && y !== undefined ? Math.max(0, t - y) : 0,
      createdAt: repo.createdAt.toISOString(),
    };
  });
}

function buildSixty(db: PanelDb, now: Date, ranked: ItemDto[]): SixtyEntry[] {
  const entries: SixtyEntry[] = [];
  const week = new Date(now.getTime() - 7 * DAY);

  const kev = db
    .select()
    .from(cves)
    .where(and(eq(cves.kev, true), gte(cves.kevAdded, isoDay(new Date(now.getTime() - 2 * DAY)))))
    .orderBy(desc(cves.kevAdded), desc(cves.priority))
    .limit(1)
    .get();
  if (kev)
    entries.push({
      kind: 'kev',
      category: 'cyber',
      text: sixtyKev(kev.cveId, kev.product),
      href: `/threats/${kev.cveId}`,
    });

  const critical = db
    .select()
    .from(cves)
    .where(and(gte(cves.cvss, 9), sql`${cves.watchlistJson} != '[]'`, gte(cves.published, week)))
    .orderBy(desc(cves.priority))
    .limit(1)
    .get();
  if (critical && critical.cveId !== kev?.cveId && critical.cvss !== null) {
    entries.push({
      kind: 'critical',
      category: 'cyber',
      text: sixtyCritical(critical.cveId, critical.product, critical.cvss),
      href: `/threats/${critical.cveId}`,
    });
  }

  const breach = db
    .select()
    .from(breaches)
    .where(gte(breaches.addedDate, week))
    .orderBy(desc(breaches.accounts))
    .limit(1)
    .get();
  if (breach)
    entries.push({
      kind: 'breach',
      category: 'cyber',
      text: sixtyBreach(breach.title, breach.accounts),
      href: '/breaches',
    });

  const release = db
    .select()
    .from(releases)
    .where(and(eq(releases.isSecurity, true), gte(releases.publishedAt, week)))
    .orderBy(desc(releases.publishedAt))
    .limit(1)
    .get();
  if (release) {
    entries.push({
      kind: 'release',
      category: 'dev',
      text: sixtyRelease(release.product, release.version),
      href: release.url,
    });
  }

  for (const story of ranked) {
    if (entries.length >= 5) break;
    entries.push({
      kind: 'story',
      category: story.category,
      text: sixtyStory(story.title),
      href: story.url,
    });
  }
  return entries.slice(0, 5);
}

/**
 * Articles of the last 3 days, ranked (best first), keeping only the best article of each
 * cluster: the same story from two outlets is shown once, with its "N sources" badge.
 */
function rankedArticles(db: PanelDb, now: Date): ItemDto[] {
  const since = new Date(now.getTime() - 3 * DAY);
  const ranked = loadItems(db, { where: gte(items.publishedAt, since), limit: 1000, now }).sort(
    (a, b) => b.rank - a.rank,
  );
  const clusterOf = new Map(
    db
      .select({ id: items.id, clusterId: items.clusterId })
      .from(items)
      .where(and(eq(items.kind, 'article'), gte(items.publishedAt, since)))
      .all()
      .map((row) => [row.id, row.clusterId]),
  );
  const seen = new Set<string>();
  return ranked.filter((item) => {
    const cluster = clusterOf.get(item.id);
    if (cluster === null || cluster === undefined) return true;
    if (seen.has(cluster)) return false;
    seen.add(cluster);
    return true;
  });
}

function withDates(list: ItemDto[]) {
  return list.map((item) => ({
    ...item,
    publishedAt: new Date(item.publishedAt),
    id: String(item.id),
  }));
}

export function registerContentRoutes(app: FastifyInstance, deps: ContentDeps): void {
  const { db } = deps;

  app.get('/api/journal', (_request, reply) => {
    const now = deps.now();
    const ranked = rankedArticles(db, now);
    const byId = new Map(ranked.map((item) => [String(item.id), item]));
    const front = selectFrontPage(withDates(ranked), now)
      .map((a) => byId.get(a.id))
      .filter((i) => i !== undefined);
    const sectionsRaw = selectSections(withDates(ranked), new Set(front.map((f) => String(f.id))));
    const sections = Object.fromEntries(
      CATEGORIES.map((c) => [
        c,
        sectionsRaw[c].map((a) => byId.get(a.id)).filter((i) => i !== undefined),
      ]),
    ) as Record<(typeof CATEGORIES)[number], ItemDto[]>;
    const day = now.getTime() - DAY;
    const ticker = ranked
      .filter((i) => i.rank >= TICKER_MIN_RANK && Date.parse(i.publishedAt) >= day)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 10);
    const wire = loadItems(db, { limit: 30, now });
    const since24h = new Date(day);
    const lastRun = db
      .select({ at: max(fetchRuns.finishedAt) })
      .from(fetchRuns)
      .where(inArray(fetchRuns.status, ['ok', 'not_modified']))
      .get()?.at;

    return sendJson(reply, journalDtoSchema, {
      generatedAt: now.toISOString(),
      lastUpdated: lastRun ? lastRun.toISOString() : null,
      front,
      sections,
      ticker,
      wire,
      sixty: buildSixty(db, now, ranked),
      snapshot: {
        newCves24h: countCves(db, gte(cves.published, since24h)),
        critical24h: countCves(db, and(gte(cves.published, since24h), gte(cves.cvss, 9))),
        kevNew7d: countCves(db, gte(cves.kevAdded, isoDay(new Date(now.getTime() - 7 * DAY)))),
        watchlist7d: countCves(
          db,
          and(
            sql`${cves.watchlistJson} != '[]'`,
            gte(cves.published, new Date(now.getTime() - 7 * DAY)),
          ),
        ),
        top: topCves(db, now, 3),
      },
    });
  });

  app.get('/api/brief', (_request, reply) => {
    const now = deps.now();
    const userPrefs = readPrefs(db);
    const days = Array.from({ length: 7 }, (_, i) =>
      isoDay(new Date(now.getTime() - (6 - i) * DAY)),
    );
    const since7 = new Date(Date.parse(`${days[0] ?? isoDay(now)}T00:00:00Z`));
    const dayOf = sql<string>`strftime('%Y-%m-%d', ${cves.published} / 1000, 'unixepoch')`;

    const daily = (where: SQL | undefined, dayExpr: SQL<string>) => {
      const rows = db
        .select({ day: dayExpr, n: count() })
        .from(cves)
        .where(where)
        .groupBy(dayExpr)
        .all();
      return days.map((d) => rows.find((r) => r.day === d)?.n ?? 0);
    };
    const kpi = (spark: number[], value: number) => {
      const previous = spark.slice(0, 6);
      const avg = previous.reduce((a, b) => a + b, 0) / previous.length;
      return { value, delta: avg > 0 ? (value - avg) / avg : null, spark };
    };
    const since24h = new Date(now.getTime() - DAY);
    const watchlisted = sql`${cves.watchlistJson} != '[]'`;
    const kevDay = sql<string>`${cves.kevAdded}`;

    const lastVisit = userPrefs.lastVisitAt === null ? null : new Date(userPrefs.lastVisitAt);
    const newItems = lastVisit
      ? (db.select({ n: count() }).from(items).where(gte(items.fetchedAt, lastVisit)).get()?.n ?? 0)
      : 0;
    const newCves = lastVisit ? countCves(db, gte(cves.published, lastVisit)) : 0;
    const attention = lastVisit
      ? countCves(
          db,
          or(
            gte(cves.kevAdded, isoDay(lastVisit)),
            and(gte(cves.published, lastVisit), gte(cves.cvss, 9), watchlisted),
          ),
        )
      : 0;

    const entries = db.select().from(watchlist).where(eq(watchlist.enabled, true)).all();
    const latestBreach = db
      .select()
      .from(breaches)
      .orderBy(desc(breaches.addedDate))
      .limit(1)
      .get();

    return sendJson(reply, briefDtoSchema, {
      generatedAt: now.toISOString(),
      displayName: userPrefs.displayName,
      lastVisitAt: userPrefs.lastVisitAt,
      newSinceLastVisit: newItems + newCves,
      attention,
      kpis: {
        newCves: kpi(
          daily(gte(cves.published, since7), dayOf),
          countCves(db, gte(cves.published, since24h)),
        ),
        critical: kpi(
          daily(and(gte(cves.published, since7), gte(cves.cvss, 9)), dayOf),
          countCves(db, and(gte(cves.published, since24h), gte(cves.cvss, 9))),
        ),
        exploited: kpi(
          daily(gte(cves.kevAdded, days[0] ?? ''), kevDay),
          countCves(db, gte(cves.kevAdded, isoDay(new Date(now.getTime() - 7 * DAY)))),
        ),
        watchlist: kpi(
          daily(and(gte(cves.published, since7), watchlisted), dayOf),
          countCves(db, and(gte(cves.published, since24h), watchlisted)),
        ),
      },
      priority: topCves(db, now, 5),
      watchlist: entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        count: countCves(
          db,
          and(
            gte(cves.published, new Date(now.getTime() - 7 * DAY)),
            sql`exists (select 1 from json_each(${cves.watchlistJson}) where value = ${entry.label})`,
          ),
        ),
      })),
      latestBreach: latestBreach ? toBreach(latestBreach) : null,
      topStories: rankedArticles(db, now)
        .filter((i) => Date.parse(i.publishedAt) >= since24h.getTime())
        .slice(0, 5),
      trending: trendingRepos(db, now, 5),
      releases: db
        .select()
        .from(releases)
        .orderBy(desc(releases.publishedAt))
        .limit(5)
        .all()
        .map(toRelease),
    });
  });

  app.get('/api/items', (request, reply) => {
    const query = parseInput(itemsQuerySchema, request.query);
    const cursor = decodeCursor(z.strictObject({ t: z.int(), id: z.int() }), query.cursor);
    const where = and(
      query.category ? eq(items.category, query.category) : undefined,
      query.lang ? eq(items.lang, query.lang) : undefined,
      cursor
        ? or(
            lt(items.publishedAt, new Date(cursor.t)),
            and(eq(items.publishedAt, new Date(cursor.t)), lt(items.id, cursor.id)),
          )
        : undefined,
    );
    const rows = loadItems(db, { where, limit: query.limit + 1, now: deps.now() });
    const last = rows[query.limit - 1];
    return sendJson(reply, pageSchema(itemDtoSchema), {
      items: rows.slice(0, query.limit),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ t: Date.parse(last.publishedAt), id: last.id })
          : null,
    });
  });

  app.get('/api/cves', (request, reply) => {
    const query = parseInput(cvesQuerySchema, request.query);
    const offset = decodeCursor(offsetCursor, query.cursor)?.o ?? 0;
    const filters = new Set(query.filter);
    const severities: SQL[] = [];
    if (filters.has('critical'))
      severities.push(
        or(gte(cves.cvss, 9), and(sql`${cves.cvss} is null`, eq(cves.ghsaSeverity, 'critical'))) ??
          sql`0`,
      );
    if (filters.has('high')) {
      severities.push(
        or(
          and(gte(cves.cvss, 7), lt(cves.cvss, 9)),
          and(sql`${cves.cvss} is null`, eq(cves.ghsaSeverity, 'high')),
        ) ?? sql`0`,
      );
    }
    let techLabel: string | undefined;
    if (query.tech !== undefined) {
      techLabel = db.select().from(watchlist).where(eq(watchlist.id, query.tech)).get()?.label;
      if (techLabel === undefined) throw new HttpProblem(400, 'Bad Request', 'Unknown technology.');
    }
    const where = and(
      meaningfulCve,
      filters.has('kev') ? eq(cves.kev, true) : undefined,
      filters.has('watchlist') ? sql`${cves.watchlistJson} != '[]'` : undefined,
      severities.length > 0 ? or(...severities) : undefined,
      techLabel === undefined
        ? undefined
        : sql`exists (select 1 from json_each(${cves.watchlistJson}) where value = ${techLabel})`,
    );
    const order = {
      priority: [desc(cves.priority), desc(cves.cveId)],
      newest: [desc(sql`coalesce(${cves.published}, 0)`), desc(cves.cveId)],
      cvss: [desc(sql`coalesce(${cves.cvss}, -1)`), desc(cves.priority)],
      epss: [desc(sql`coalesce(${cves.epss}, -1)`), desc(cves.priority)],
    }[query.sort];
    const rows = db
      .select()
      .from(cves)
      .where(where)
      .orderBy(...order)
      .limit(query.limit + 1)
      .offset(offset)
      .all()
      .map(toCveSummary);
    return sendJson(reply, pageSchema(cveSummaryDtoSchema), page(rows, query.limit, offset));
  });

  app.get('/api/cves/:id', (request, reply) => {
    const { id } = parseInput(z.strictObject({ id: cveIdSchema }), request.params);
    const detail = loadCveDetail(db, id, deps.now());
    if (!detail) throw new HttpProblem(404, 'Not Found', 'Unknown CVE.');
    return sendJson(reply, cveDetailDtoSchema, detail);
  });

  app.get('/api/breaches', (request, reply) => {
    const query = parseInput(listQuerySchema, request.query);
    const offset = decodeCursor(offsetCursor, query.cursor)?.o ?? 0;
    const rows = db
      .select()
      .from(breaches)
      .orderBy(desc(breaches.addedDate))
      .limit(query.limit + 1)
      .offset(offset)
      .all();
    return sendJson(
      reply,
      pageSchema(breachDtoSchema),
      page(rows.map(toBreach), query.limit, offset),
    );
  });

  app.get('/api/releases', (request, reply) => {
    const query = parseInput(listQuerySchema, request.query);
    const offset = decodeCursor(offsetCursor, query.cursor)?.o ?? 0;
    const rows = db
      .select()
      .from(releases)
      .orderBy(desc(releases.publishedAt))
      .limit(query.limit + 1)
      .offset(offset)
      .all();
    return sendJson(
      reply,
      pageSchema(releaseDtoSchema),
      page(rows.map(toRelease), query.limit, offset),
    );
  });

  app.get('/api/repos', (request, reply) => {
    const query = parseInput(listQuerySchema, request.query);
    const offset = decodeCursor(offsetCursor, query.cursor)?.o ?? 0;
    const rows = trendingRepos(db, deps.now(), offset + query.limit + 1).slice(offset);
    return sendJson(reply, pageSchema(repoDtoSchema), page(rows, query.limit, offset));
  });

  app.get('/api/search', (request, reply) => {
    const { q } = parseInput(searchQuerySchema, request.query);
    const now = deps.now();
    const match = toFtsQuery(q);
    const ids =
      match === null
        ? []
        : db
            .all<{ rowid: number }>(
              sql`select rowid from items_fts where items_fts match ${match} order by rank limit 10`,
            )
            .map((r) => r.rowid);
    const found =
      ids.length === 0 ? [] : loadItems(db, { where: inArray(items.id, ids), limit: 10, now });
    const pattern = likePattern(q);
    const cveExact = cveIdSchema.safeParse(q.toUpperCase());
    const cveRows = db
      .select()
      .from(cves)
      .where(
        and(
          meaningfulCve,
          cveExact.success
            ? eq(cves.cveId, cveExact.data)
            : or(
                sql`${cves.descriptionEn} like ${pattern} escape '\\'`,
                sql`${cves.product} like ${pattern} escape '\\'`,
              ),
        ),
      )
      .orderBy(desc(cves.priority))
      .limit(10)
      .all();
    const repoNames = db
      .select({ name: repos.fullName })
      .from(repos)
      .where(
        or(
          sql`${repos.fullName} like ${pattern} escape '\\'`,
          sql`${repos.description} like ${pattern} escape '\\'`,
        ),
      )
      .limit(10)
      .all()
      .map((r) => r.name);
    const releaseRows = db
      .select()
      .from(releases)
      .where(
        or(
          sql`${releases.product} like ${pattern} escape '\\'`,
          sql`${releases.version} like ${pattern} escape '\\'`,
        ),
      )
      .orderBy(desc(releases.publishedAt))
      .limit(10)
      .all();
    return sendJson(reply, searchDtoSchema, {
      items: ids.map((id) => found.find((f) => f.id === id)).filter((i) => i !== undefined),
      cves: cveRows.map(toCveSummary),
      repos: trendingRepos(db, now, 500)
        .filter((r) => repoNames.includes(r.fullName))
        .slice(0, 10),
      releases: releaseRows.map(toRelease),
    });
  });
}

/**
 * Turns free text into a safe FTS5 query: only letters and digits survive, each word is
 * quoted (no operators, columns or NEAR), the last one is a prefix. Null when nothing is left.
 */
export function toFtsQuery(input: string): string | null {
  const words = (input.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  if (words.length === 0) return null;
  return words.map((w, i) => (i === words.length - 1 ? `"${w}"*` : `"${w}"`)).join(' ');
}
