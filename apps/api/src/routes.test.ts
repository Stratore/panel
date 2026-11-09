import { eq } from 'drizzle-orm';
import { schema } from '@panel/db';
import {
  briefDtoSchema,
  DEFAULT_WATCHLIST,
  journalDtoSchema,
  type CveSummaryDto,
  type ItemDto,
  type SourceDto,
  type SourceValidation,
} from '@panel/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toFtsQuery } from './routes/content.js';
import { eventsAfter, formatSse, latestEventId } from './routes/stream.js';
import {
  createTestApp,
  request,
  SESSION_SECRET,
  SETUP_TOKEN,
  setupAndLogin,
  type TestContext,
} from './testing.js';

let ctx: TestContext;
let cookie: string;
const now = new Date('2026-11-02T21:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

function seedContent() {
  const db = ctx.handle.db;
  const article = (
    id: number,
    sourceId: string,
    category: 'ai' | 'cyber' | 'dev' | 'hardware' | 'innovation',
    title: string,
    age: number,
  ) => ({
    id,
    sourceId,
    kind: 'article' as const,
    url: `https://news.example.com/${String(id)}`,
    urlHash: `hash-${String(id)}`,
    title,
    summary: `Summary of ${title}`,
    lang: 'en' as const,
    publishedAt: hoursAgo(age),
    fetchedAt: hoursAgo(age),
    category,
    clusterId: `c-${String(id)}`,
  });
  db.insert(schema.items)
    .values([
      article(1, 'bleeping', 'cyber', 'Critical PHP flaw exploited in the wild', 1),
      article(2, 'arstechnica', 'ai', 'Small open models summarise the news offline', 2),
      article(3, 'tomshardware', 'hardware', 'A new GPU for small boards', 3),
      article(4, 'next', 'dev', 'TypeScript 6 lands', 4),
      article(5, 'theverge', 'innovation', 'Batteries get cheaper', 5),
      article(6, 'thehackernews', 'cyber', 'Sécurité : correctif urgent pour OpenSSH', 6),
      article(7, 'lmi', 'dev', 'Old news', 24 * 10),
    ])
    .run();
  db.insert(schema.cves)
    .values([
      {
        cveId: 'CVE-2026-41234',
        descriptionEn: 'Out-of-bounds write in PHP.',
        product: 'PHP',
        cvss: 9.8,
        severity: 'critical',
        epss: 0.94,
        epssPercentile: 0.99,
        kev: true,
        kevAdded: '2026-11-02',
        kevDue: '2026-11-23',
        published: hoursAgo(5),
        priority: 99,
        watchlistJson: ['PHP'],
        vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        referencesJson: ['https://www.php.net/'],
      },
      {
        cveId: 'CVE-2026-40999',
        descriptionEn: 'Authentication bypass in OpenSSH.',
        product: 'OpenSSH',
        cvss: 8.1,
        severity: 'high',
        published: hoursAgo(30),
        priority: 60,
        watchlistJson: ['OpenSSH'],
      },
      {
        cveId: 'CVE-2026-40531',
        ghsaId: 'GHSA-9x9x-9x9x-9x9x',
        ghsaSeverity: 'high',
        priority: 26.3,
      },
      // Bare id extracted from an article: hidden from lists.
      { cveId: 'CVE-2026-11111' },
    ])
    .run();
  db.insert(schema.itemCves).values({ itemId: 1, cveId: 'CVE-2026-41234' }).run();
  db.insert(schema.breaches)
    .values({
      name: 'NorthwindRetail',
      title: 'Northwind Retail',
      domain: 'northwind.example',
      accounts: 12_400_000,
      dataClassesJson: ['Email addresses'],
      breachDate: '2026-10-01',
      addedDate: hoursAgo(10),
      isVerified: true,
      isSensitive: false,
    })
    .run();
  db.insert(schema.releases)
    .values({
      product: 'PHP',
      version: '8.3.14',
      isSecurity: true,
      url: 'https://www.php.net/releases/8_3_14.php',
      publishedAt: hoursAgo(20),
    })
    .run();
  db.insert(schema.repos)
    .values({
      fullName: 'example/panel-demo',
      description: 'Sample',
      language: 'TypeScript',
      url: 'https://github.com/example/panel-demo',
      createdAt: hoursAgo(72),
    })
    .run();
  db.insert(schema.repoStars)
    .values([
      { fullName: 'example/panel-demo', day: '2026-11-01', stars: 1000 },
      { fullName: 'example/panel-demo', day: '2026-11-02', stars: 1200 },
    ])
    .run();
}

beforeEach(async () => {
  ctx = await createTestApp({ now });
  cookie = await setupAndLogin(ctx.app);
  seedContent();
});
afterEach(async () => {
  await ctx.close();
});

const get = (url: string, headers: Record<string, string> = {}) =>
  request(ctx.app, 'GET', url, { cookie, headers });

describe('journal and brief', () => {
  it('composes the front page from four different categories', async () => {
    const response = await get('/api/journal');
    expect(response.statusCode).toBe(200);
    const journal = journalDtoSchema.parse(response.json());
    expect(journal.front).toHaveLength(4);
    expect(new Set(journal.front.map((i) => i.category)).size).toBe(4);
    const frontIds = new Set(journal.front.map((i) => i.id));
    for (const section of Object.values(journal.sections)) {
      for (const item of section) expect(frontIds.has(item.id)).toBe(false);
    }
    expect(journal.wire[0]?.id).toBe(1);
    expect(journal.ticker.every((i) => i.id !== 7)).toBe(true);
    expect(journal.sixty.map((s) => s.kind)).toEqual([
      'kev',
      'breach',
      'release',
      'story',
      'story',
    ]);
    expect(journal.sixty[0]?.text.fr).toContain('CVE-2026-41234');
    expect(journal.snapshot).toMatchObject({
      newCves24h: 1,
      critical24h: 1,
      kevNew7d: 1,
      watchlist7d: 2,
    });
    expect(journal.snapshot.top[0]?.cveId).toBe('CVE-2026-41234');
    expect(journal.wire.find((i) => i.id === 1)?.cveIds).toEqual(['CVE-2026-41234']);
  });

  it('answers 304 when the ETag matches', async () => {
    const first = await get('/api/journal');
    const etag = first.headers.etag;
    expect(typeof etag).toBe('string');
    expect(first.headers['cache-control']).toBe('private, no-cache');
    const second = await get('/api/journal', { 'if-none-match': String(etag) });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
  });

  it('builds the brief with KPIs, sparklines and the priority queue', async () => {
    const brief = briefDtoSchema.parse((await get('/api/brief')).json());
    expect(brief.displayName).toBe('Pierre');
    expect(brief.kpis.newCves.spark).toHaveLength(7);
    expect(brief.kpis.newCves.value).toBe(1);
    expect(brief.kpis.exploited.spark.at(-1)).toBe(1);
    // The GHSA-only CVE has no date: it is not "recent", so it stays out of the queue.
    expect(brief.priority.map((c) => c.cveId)).toEqual(['CVE-2026-41234', 'CVE-2026-40999']);
    expect(brief.watchlist.find((w) => w.label === 'PHP')?.count).toBe(1);
    expect(brief.latestBreach?.accounts).toBe(12_400_000);
    expect(brief.trending[0]).toMatchObject({
      fullName: 'example/panel-demo',
      stars: 1200,
      starsToday: 200,
    });
    expect(brief.releases[0]?.version).toBe('8.3.14');
  });

  it('tracks the last visit', async () => {
    expect((await request(ctx.app, 'POST', '/api/visit', { cookie })).statusCode).toBe(204);
    const brief = briefDtoSchema.parse((await get('/api/brief')).json());
    expect(brief.lastVisitAt).toBe(now.toISOString());
  });
});

describe('lists', () => {
  it('paginates items with an opaque cursor', async () => {
    const first = (await get('/api/items?limit=2')).json<{
      items: ItemDto[];
      nextCursor: string;
    }>();
    expect(first.items.map((i) => i.id)).toEqual([1, 2]);
    const second = (await get(`/api/items?limit=2&cursor=${first.nextCursor}`)).json<{
      items: ItemDto[];
    }>();
    expect(second.items.map((i) => i.id)).toEqual([3, 4]);
    const cyber = (await get('/api/items?category=cyber')).json<{
      items: ItemDto[];
      nextCursor: null;
    }>();
    expect(cyber.items.map((i) => i.id)).toEqual([1, 6]);
    expect(cyber.nextCursor).toBeNull();
  });

  it('rejects invalid queries and cursors with 400', async () => {
    expect((await get('/api/items?limit=500')).statusCode).toBe(400);
    expect((await get('/api/items?cursor=garbage')).statusCode).toBe(400);
    expect((await get('/api/items?category=sports')).statusCode).toBe(400);
    expect((await get('/api/items?extra=1')).statusCode).toBe(400);
  });

  it('filters and sorts CVEs, hiding bare ids', async () => {
    const ids = async (url: string) =>
      (await get(url)).json<{ items: CveSummaryDto[] }>().items.map((c) => c.cveId);
    expect(await ids('/api/cves')).toEqual(['CVE-2026-41234', 'CVE-2026-40999', 'CVE-2026-40531']);
    expect(await ids('/api/cves?filter=kev')).toEqual(['CVE-2026-41234']);
    expect(await ids('/api/cves?filter=high')).toEqual(['CVE-2026-40999', 'CVE-2026-40531']);
    expect(await ids('/api/cves?filter=critical,high')).toHaveLength(3);
    expect(await ids('/api/cves?filter=kev,watchlist')).toEqual(['CVE-2026-41234']);
    expect(await ids('/api/cves?tech=openssh')).toEqual(['CVE-2026-40999']);
    expect(await ids('/api/cves?sort=newest')).toEqual([
      'CVE-2026-41234',
      'CVE-2026-40999',
      'CVE-2026-40531',
    ]);
    expect((await get('/api/cves?tech=unknown')).statusCode).toBe(400);
    expect((await get('/api/cves?filter=bogus')).statusCode).toBe(400);
    const provisional = (await get('/api/cves?filter=high')).json<{ items: CveSummaryDto[] }>()
      .items[1];
    expect(provisional).toMatchObject({ cvss: null, cvssEffective: 7.5, cvssProvisional: true });
  });

  it('returns a CVE detail with related articles', async () => {
    const detail = (await get('/api/cves/CVE-2026-41234')).json<{
      articles: ItemDto[];
      kev: boolean;
    }>();
    expect(detail.kev).toBe(true);
    expect(detail.articles.map((a) => a.id)).toEqual([1]);
    expect((await get('/api/cves/CVE-2099-0001')).statusCode).toBe(404);
    expect((await get('/api/cves/not-a-cve')).statusCode).toBe(400);
  });

  it('lists breaches, releases and repositories', async () => {
    expect((await get('/api/breaches')).json()).toMatchObject({
      items: [{ name: 'NorthwindRetail' }],
      nextCursor: null,
    });
    expect((await get('/api/releases')).json()).toMatchObject({ items: [{ product: 'PHP' }] });
    expect((await get('/api/repos')).json()).toMatchObject({ items: [{ starsToday: 200 }] });
  });
});

describe('search', () => {
  it('finds articles accent-insensitively, CVEs, repos and releases', async () => {
    const result = (await get(`/api/search?q=${encodeURIComponent('securite openssh')}`)).json<{
      items: ItemDto[];
      cves: CveSummaryDto[];
    }>();
    expect(result.items.map((i) => i.id)).toEqual([6]);
    expect(result.cves).toEqual([]);
    const cve = (await get('/api/search?q=cve-2026-41234')).json<{ cves: CveSummaryDto[] }>();
    expect(cve.cves.map((c) => c.cveId)).toEqual(['CVE-2026-41234']);
    expect((await get('/api/search?q=panel')).json()).toMatchObject({
      repos: [{ fullName: 'example/panel-demo' }],
    });
    expect((await get('/api/search?q=8.3')).json()).toMatchObject({
      releases: [{ version: '8.3.14' }],
    });
  });

  it('survives FTS syntax and LIKE wildcards', async () => {
    for (const q of ['"', 'a OR *', 'NEAR(a b)', 'title:x', '%', '_', '\\', '-', '))))', '*']) {
      const response = await get(`/api/search?q=${encodeURIComponent(q)}`);
      expect(response.statusCode, q).toBe(200);
    }
    expect((await get('/api/search?q=%25')).json()).toMatchObject({ cves: [], releases: [] });
    expect((await get(`/api/search?q=${'a'.repeat(101)}`)).statusCode).toBe(400);
  });

  it('builds safe FTS queries', () => {
    expect(toFtsQuery('Sécurité OpenSSH')).toBe('"Sécurité" "OpenSSH"*');
    expect(toFtsQuery('a" OR NEAR(*')).toBe('"a" "OR" "NEAR"*');
    expect(toFtsQuery('!!!')).toBeNull();
  });
});

describe('sources', () => {
  const post = (url: string, body: unknown) => request(ctx.app, 'POST', url, { cookie, body });

  it('lists sources with health', async () => {
    ctx.handle.db
      .insert(schema.fetchRuns)
      .values({
        sourceId: 'hn',
        startedAt: hoursAgo(1),
        status: 'ok',
        httpStatus: 200,
        itemsNew: 3,
        durationMs: 420,
      })
      .run();
    const list = (await get('/api/sources')).json<SourceDto[]>();
    expect(list.length).toBeGreaterThan(20);
    expect(list.find((s) => s.id === 'hn')?.lastRun).toMatchObject({
      status: 'ok',
      durationMs: 420,
    });
  });

  it('validates feeds check by check', async () => {
    const ok = (
      await post('/api/sources/validate', { url: 'https://mine.example/feed' })
    ).json<SourceValidation>();
    expect(ok.ok).toBe(true);
    expect(ok.checks.every((c) => c.ok)).toBe(true);
    expect(ok).toMatchObject({ format: 'rss', itemCount: 4 });
    expect(ok.preview).toEqual([
      { title: 'First post', url: 'https://mine.example/1' },
      { title: 'Second', url: null },
      { title: 'Third', url: 'https://mine.example/3' },
    ]);

    const blocked = (
      await post('/api/sources/validate', { url: 'https://blocked.example/feed' })
    ).json<SourceValidation>();
    expect(blocked.ok).toBe(false);
    expect(blocked.checks.map((c) => [c.id, c.ok])).toEqual([
      ['https', true],
      ['public_address', false],
      ['reachable', false],
      ['content_type', false],
      ['size', false],
      ['valid_feed', false],
    ]);
    expect(
      (
        await post('/api/sources/validate', { url: 'https://html.example/' })
      ).json<SourceValidation>().checks[3],
    ).toMatchObject({ id: 'content_type', ok: false });
    expect(
      (
        await post('/api/sources/validate', { url: 'https://missing.example/' })
      ).json<SourceValidation>().checks[2],
    ).toMatchObject({ id: 'reachable', ok: false, detail: 'HTTP 404' });
    expect(
      (
        await post('/api/sources/validate', { url: 'https://empty.example/' })
      ).json<SourceValidation>().checks[5],
    ).toMatchObject({ ok: false, detail: 'The feed has no items.' });
  });

  it('adds, edits and deletes custom sources only', async () => {
    const created = await post('/api/sources', {
      name: 'Mine',
      url: 'https://mine.example/feed',
      lang: 'fr',
      category: 'dev',
    });
    expect(created.statusCode).toBe(201);
    const source = created.json<SourceDto>();
    expect(source).toMatchObject({ isCustom: true, group: 'custom', enabled: true });
    expect(source.id).toMatch(/^custom-[0-9a-f]{8}$/);

    expect(
      (
        await post('/api/sources', {
          name: 'Dup',
          url: 'https://mine.example/feed',
          lang: 'fr',
          category: 'dev',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await post('/api/sources', {
          name: 'Bad',
          url: 'https://blocked.example/feed',
          lang: 'en',
          category: 'dev',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await post('/api/sources', {
          name: 'Bad',
          url: 'http://plain.example/feed',
          lang: 'en',
          category: 'dev',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post('/api/sources', {
          name: 'Bad',
          url: 'javascript:alert(1)',
          lang: 'en',
          category: 'dev',
        })
      ).statusCode,
    ).toBe(400);

    const patch = (id: string, body: unknown) =>
      request(ctx.app, 'PATCH', `/api/sources/${id}`, { cookie, body });
    expect((await patch('hn', { enabled: false })).json()).toMatchObject({ enabled: false });
    expect((await patch('hn', { name: 'Renamed' })).statusCode).toBe(403);
    expect((await patch(source.id, { name: 'Renamed', category: 'ai' })).json()).toMatchObject({
      name: 'Renamed',
      category: 'ai',
    });
    expect((await patch(source.id, {})).statusCode).toBe(400);

    const del = (id: string) => request(ctx.app, 'DELETE', `/api/sources/${id}`, { cookie });
    expect((await del('hn')).statusCode).toBe(403);
    expect((await del(source.id)).statusCode).toBe(204);
    expect((await del(source.id)).statusCode).toBe(404);
  });
});

describe('preferences, export and import', () => {
  it('never accepts or returns secrets', async () => {
    const prefs = (await get('/api/prefs')).json<Record<string, unknown>>();
    expect(prefs['channels']).toEqual({ discord: false, telegram: false });
    const withSecret = await request(ctx.app, 'PUT', '/api/prefs', {
      cookie,
      body: {
        prefs: { ...(prefs['prefs'] as object), discordWebhookUrl: 'https://discord.example/x' },
      },
    });
    expect(withSecret.statusCode).toBe(400);

    const exported = await get('/api/export');
    expect(exported.headers['content-disposition']).toContain('panel-config.json');
    for (const secret of [SESSION_SECRET, SETUP_TOKEN, 'argon2', 'passphrase'])
      expect(exported.body).not.toContain(secret);
  });

  it('updates the watchlist and round-trips an export', async () => {
    const watchlist = DEFAULT_WATCHLIST.slice(0, 2);
    const put = await request(ctx.app, 'PUT', '/api/prefs', { cookie, body: { watchlist } });
    expect(put.json()).toMatchObject({ watchlist: [{ label: 'Node.js' }, { label: 'PHP' }] });
    const duplicate = await request(ctx.app, 'PUT', '/api/prefs', {
      cookie,
      body: { watchlist: [watchlist[0], watchlist[0]] },
    });
    expect(duplicate.statusCode).toBe(400);

    const exported = (await get('/api/export')).json<Record<string, unknown>>();
    const custom = {
      name: 'Mine',
      url: 'https://mine.example/feed',
      lang: 'fr',
      category: 'dev',
      enabled: true,
    };
    const imported = await request(ctx.app, 'POST', '/api/import', {
      cookie,
      body: { ...exported, watchlist: DEFAULT_WATCHLIST, customSources: [custom, custom] },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json<{ watchlist: unknown[] }>().watchlist).toHaveLength(9);
    const customs = ctx.handle.db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.isCustom, true))
      .all();
    expect(customs).toHaveLength(1);
    expect(
      (await request(ctx.app, 'POST', '/api/import', { cookie, body: { version: 2 } })).statusCode,
    ).toBe(400);
  });

  it('refuses a test alert without any channel', async () => {
    expect((await request(ctx.app, 'POST', '/api/alerts/test', { cookie })).statusCode).toBe(409);
  });

  it('reports health', async () => {
    expect((await get('/api/health')).json()).toMatchObject({
      status: 'ok',
      counts: { items: 7, breaches: 1 },
    });
  });
});

describe('stream helpers', () => {
  it('formats frames and tails the events table', () => {
    expect(formatSse(3, 'item.new', { title: 'a\nb' })).toBe(
      'id: 3\nevent: item.new\ndata: {"title":"a\\nb"}\n\n',
    );
    const db = ctx.handle.db;
    expect(latestEventId(db)).toBe(0);
    db.insert(schema.events)
      .values([
        { type: 'item.new', payloadJson: { id: 1 }, createdAt: now },
        { type: 'cve.updated', payloadJson: { cveId: 'CVE-2026-41234' }, createdAt: now },
      ])
      .run();
    expect(eventsAfter(db, 0).map((e) => e.type)).toEqual(['item.new', 'cve.updated']);
    expect(eventsAfter(db, 1).map((e) => e.id)).toEqual([2]);
    expect(latestEventId(db)).toBe(2);
  });
});
