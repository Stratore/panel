import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import {
  loadSourcesCatalog,
  migrateDatabase,
  openDatabase,
  schema,
  seedDatabase,
  type DatabaseHandle,
} from '@panel/db';
import {
  compileKeywords,
  DEFAULT_WATCHLIST,
  keywordsConfigSchema,
  type ArticleItem,
  type CveItem,
  type NormalizedItem,
} from '@panel/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cveIdsNeedingEpss, refreshAllPriorities } from './cves.js';
import { processItems, urlHash, type PipelineDeps, type PipelineSource } from './index.js';

const root = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const now = new Date('2026-11-02T21:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

const deps: PipelineDeps = {
  keywords: compileKeywords(
    keywordsConfigSchema.parse(JSON.parse(readFileSync(root('config/keywords.json'), 'utf8'))),
  ),
  watchlist: DEFAULT_WATCHLIST,
};

const source = (id: string, overrides: Partial<PipelineSource> = {}): PipelineSource => ({
  id,
  name: id,
  kind: 'article',
  adapter: 'rss',
  url: 'https://feed.example.com/',
  lang: 'en',
  categoryDefault: 'dev',
  product: null,
  isCustom: false,
  etag: null,
  lastModified: null,
  weight: 1,
  ...overrides,
});

const article = (overrides: Partial<ArticleItem> = {}): ArticleItem => ({
  kind: 'article',
  url: 'https://news.example.com/php-flaw',
  title: 'Critical PHP flaw CVE-2026-41234 exploited by ransomware gangs',
  summary: 'Patch now.',
  lang: 'en',
  publishedAt: hoursAgo(1),
  ...overrides,
});

const nvdCve = (overrides: Partial<CveItem> = {}): CveItem => ({
  kind: 'cve',
  cveId: 'CVE-2026-41234',
  url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-41234',
  description: 'Out-of-bounds write in PHP.',
  cvss: 9.8,
  cvssVersion: '3.1',
  vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
  severity: 'critical',
  cwe: 'CWE-787',
  cpes: ['cpe:2.3:a:php:php:*:*:*:*:*:*:*:*'],
  references: [],
  published: hoursAgo(48),
  modified: hoursAgo(24),
  product: 'Php',
  affected: ['< 8.3.14'],
  fixedVersions: '8.3.14',
  hasPublicExploit: false,
  ...overrides,
});

let dir: string;
let handle: DatabaseHandle;
const run = (items: NormalizedItem[], src = source('bleeping', { categoryDefault: 'cyber' })) =>
  processItems(handle.db, src, items, deps, now);
const eventsOf = () => handle.db.select().from(schema.events).all();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'panel-pipeline-'));
  handle = openDatabase(join(dir, 'panel.db'));
  migrateDatabase(handle.db);
  seedDatabase(handle.db, loadSourcesCatalog(root('config/sources.default.json')), now);
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('articles', () => {
  it('stores a canonical, classified, tagged article with its CVEs and emits item.new', () => {
    const result = run([article({ url: 'https://News.Example.com/php-flaw/?utm_source=rss#top' })]);
    expect(result).toMatchObject({ inserted: 1, updated: 0, events: 1 });

    const [row] = handle.db.select().from(schema.items).all();
    expect(row).toMatchObject({
      url: 'https://news.example.com/php-flaw',
      urlHash: urlHash('https://news.example.com/php-flaw'),
      category: 'cyber',
      tagsJson: ['PHP'],
      sourceId: 'bleeping',
    });
    expect(row?.rankScore).toBeGreaterThan(0);
    expect(handle.db.select().from(schema.itemCves).all()).toEqual([
      { itemId: row?.id, cveId: 'CVE-2026-41234' },
    ]);
    expect(eventsOf()[0]).toMatchObject({
      type: 'item.new',
      payloadJson: { kind: 'article', category: 'cyber' },
    });
  });

  it('dedupes by canonical URL and refreshes HN points only', () => {
    const hn = source('hn', { categoryDefault: 'dev', weight: 1.2 });
    run([article({ url: 'https://example.com/a?utm_medium=x', hnPoints: 10 })], hn);
    const second = run([article({ url: 'https://example.com/a', hnPoints: 600 })], hn);
    expect(second).toMatchObject({ inserted: 0, updated: 1, events: 0 });
    const third = run([article({ url: 'https://example.com/a', hnPoints: 600 })], hn);
    expect(third).toMatchObject({ inserted: 0, updated: 0 });
    const rows = handle.db.select().from(schema.items).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hnPoints).toBe(600);
  });

  it('clusters the same story from two outlets and boosts its rank', () => {
    run([
      article({
        url: 'https://a.example/story',
        title: 'CISA adds PHP remote code execution flaw to KEV catalog',
      }),
    ]);
    const before = handle.db.select().from(schema.items).get()?.rankScore ?? 0;
    run(
      [
        article({
          url: 'https://b.example/story',
          title: 'CISA Adds PHP Remote Code Execution Flaw to KEV Catalog!',
          publishedAt: hoursAgo(2),
        }),
      ],
      source('thehackernews', { categoryDefault: 'cyber' }),
    );
    const rows = handle.db.select().from(schema.items).all();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.clusterId).toBe(rows[1]?.clusterId);
    expect(rows[0]?.rankScore).toBeGreaterThan(before);
  });

  it('keeps unrelated stories in separate clusters', () => {
    run([
      article({ url: 'https://a.example/1', title: 'Nvidia unveils a new GPU for laptops' }),
      article({ url: 'https://a.example/2', title: 'TypeScript 6.0 released with faster builds' }),
    ]);
    const [a, b] = handle.db.select().from(schema.items).all();
    expect(a?.clusterId).not.toBe(b?.clusterId);
    expect(a?.category).toBe('hardware');
    expect(b?.category).toBe('dev');
  });
});

describe('releases, breaches, repos', () => {
  it('stores releases once', () => {
    const release: NormalizedItem = {
      kind: 'release',
      product: 'PHP',
      version: '8.3.14',
      isSecurity: true,
      url: 'https://www.php.net/releases/8_3_14.php',
      publishedAt: hoursAgo(3),
    };
    expect(run([release]).inserted).toBe(1);
    expect(run([release]).inserted).toBe(0);
    expect(eventsOf()).toHaveLength(1);
  });

  it('distinguishes new and updated breaches', () => {
    const breach: NormalizedItem = {
      kind: 'breach',
      name: 'NorthwindRetail',
      title: 'Northwind Retail',
      domain: 'northwind.example',
      accounts: 12_400_000,
      dataClasses: ['Email addresses'],
      breachDate: '2026-10-01',
      addedDate: hoursAgo(5),
      isVerified: true,
      isSensitive: false,
    };
    expect(run([breach])).toMatchObject({ inserted: 1, events: 1 });
    expect(run([{ ...breach, accounts: 13_000_000 }])).toMatchObject({
      inserted: 0,
      updated: 1,
      events: 0,
    });
    expect(handle.db.select().from(schema.breaches).get()?.accounts).toBe(13_000_000);
  });

  it('stores repositories and daily star counts', () => {
    const repo: NormalizedItem = {
      kind: 'repo',
      fullName: 'example/panel-demo',
      description: 'Sample',
      language: 'TypeScript',
      url: 'https://github.com/example/panel-demo',
      stars: 100,
      createdAt: hoursAgo(72),
    };
    run([repo]);
    run([{ ...repo, stars: 150 }]);
    expect(handle.db.select().from(schema.repoStars).all()).toEqual([
      { fullName: 'example/panel-demo', day: '2026-11-02', stars: 150 },
    ]);
  });
});

describe('CVEs', () => {
  const cveRow = (id = 'CVE-2026-41234') =>
    handle.db.select().from(schema.cves).where(eq(schema.cves.cveId, id)).get();

  it('upserts NVD data and computes priority with the watchlist', () => {
    const result = run([nvdCve()], source('nvd', { kind: 'cve', categoryDefault: null }));
    expect(result).toMatchObject({ inserted: 1, newCves: 1, events: 1 });
    // 35·0.98 + 0 (no EPSS) + 0 (no KEV) + 10 (PHP on watchlist)
    expect(cveRow()?.priority).toBe(44.3);
    expect(cveRow()?.watchlistJson).toEqual(['PHP']);
    expect(run([nvdCve({ cvss: 7.5, severity: 'high' })], source('nvd')).updated).toBe(1);
    expect(cveRow()?.cvss).toBe(7.5);
  });

  it('does not push old CVEs live during a bulk sync', () => {
    const old = nvdCve({ cveId: 'CVE-2024-0001', published: hoursAgo(24 * 400) });
    const low = nvdCve({ cveId: 'CVE-2026-0002', severity: 'medium', cvss: 5 });
    expect(run([old, low], source('nvd'))).toMatchObject({ inserted: 2, events: 0 });
  });

  it('flags recent KEV additions only, and KEV product wins over NVD', () => {
    run([nvdCve()], source('nvd'));
    run(
      [
        {
          kind: 'cve-kev',
          cveId: 'CVE-2026-41234',
          product: 'PHP',
          name: 'PHP RCE',
          dateAdded: '2026-11-02',
          dueDate: '2026-11-23',
          ransomware: false,
          cwe: 'CWE-787',
        },
        {
          kind: 'cve-kev',
          cveId: 'CVE-2021-44228',
          product: 'Log4j',
          name: 'Log4Shell',
          dateAdded: '2021-12-10',
          dueDate: null,
          ransomware: true,
          cwe: null,
        },
      ],
      source('cisa-kev'),
    );
    const kevEvents = eventsOf().filter((e) => e.payloadJson['kevAdded'] === true);
    expect(kevEvents.map((e) => e.payloadJson['cveId'])).toEqual(['CVE-2026-41234']);
    expect(cveRow()).toMatchObject({
      kev: true,
      product: 'PHP',
      kevDue: '2026-11-23',
      kevName: 'PHP RCE',
    });
    // 34.3 + 25 (KEV) + 10 (watchlist)
    expect(cveRow()?.priority).toBe(69.3);

    run(
      [
        {
          kind: 'cve-kev',
          cveId: 'CVE-2026-41234',
          product: 'PHP',
          name: 'PHP RCE',
          dateAdded: '2026-11-02',
          dueDate: '2026-11-23',
          ransomware: false,
          cwe: null,
        },
      ],
      source('cisa-kev'),
    );
    expect(eventsOf().filter((e) => e.payloadJson['kevAdded'] === true)).toHaveLength(1);
  });

  it('applies EPSS to known CVEs only and lists CVEs needing a score', () => {
    run(
      [nvdCve(), nvdCve({ cveId: 'CVE-2026-40999', severity: 'high', cvss: 8.1 })],
      source('nvd'),
    );
    expect(cveIdsNeedingEpss(handle.db, now, 10).sort()).toEqual([
      'CVE-2026-40999',
      'CVE-2026-41234',
    ]);
    const result = run(
      [
        {
          kind: 'cve-epss',
          cveId: 'CVE-2026-41234',
          epss: 0.94,
          percentile: 0.99,
          date: '2026-11-02',
        },
        {
          kind: 'cve-epss',
          cveId: 'CVE-2099-0001',
          epss: 0.1,
          percentile: 0.2,
          date: '2026-11-02',
        },
      ],
      source('epss'),
    );
    expect(result.updated).toBe(1);
    expect(cveRow()).toMatchObject({ epss: 0.94, epssPercentile: 0.99 });
    expect(cveRow('CVE-2099-0001')).toBeUndefined();
    expect(cveIdsNeedingEpss(handle.db, now, 10)).toEqual(['CVE-2026-40999']);
    // 34.3 + 29.7 + 10
    expect(cveRow()?.priority).toBe(74);
  });

  it('GHSA fills gaps without overwriting NVD knowledge', () => {
    run(
      [
        {
          kind: 'cve-ghsa',
          cveId: 'CVE-2026-40531',
          ghsaId: 'GHSA-9x9x-9x9x-9x9x',
          severity: 'high',
          product: 'wp-plugin',
          fixedVersions: '2.0.1',
          url: 'https://github.com/advisories/GHSA-9x9x-9x9x-9x9x',
        },
      ],
      source('ghsa-npm'),
    );
    // No CVSS yet: provisional 7.5 from GHSA → 26.25 rounded to 26.3
    expect(cveRow('CVE-2026-40531')).toMatchObject({
      ghsaSeverity: 'high',
      product: 'wp-plugin',
      priority: 26.3,
    });

    run([nvdCve()], source('nvd'));
    run(
      [
        {
          kind: 'cve-ghsa',
          cveId: 'CVE-2026-41234',
          ghsaId: 'GHSA-2c8m-mx4q-vw9r',
          severity: 'critical',
          product: 'php/php-src',
          fixedVersions: '9.9.9',
          url: 'https://github.com/advisories/GHSA-2c8m-mx4q-vw9r',
        },
      ],
      source('ghsa-npm'),
    );
    expect(cveRow()).toMatchObject({
      product: 'Php',
      fixedVersions: '8.3.14',
      ghsaId: 'GHSA-2c8m-mx4q-vw9r',
    });
  });
});

describe('refreshAllPriorities', () => {
  it('recomputes labels and priority for every CVE after a watchlist change', () => {
    run([nvdCve()], source('nvd'));
    expect(handle.db.select().from(schema.cves).get()?.watchlistJson).toEqual(['PHP']);
    const withoutPhp = DEFAULT_WATCHLIST.filter((e) => e.id !== 'php');
    expect(refreshAllPriorities(handle.db, withoutPhp)).toBe(1);
    expect(handle.db.select().from(schema.cves).get()).toMatchObject({
      watchlistJson: [],
      priority: 34.3,
    });
  });
});
