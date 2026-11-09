import { readFileSync } from 'node:fs';
import type { SafeFetchResponse } from '@panel/safe-fetch';
import { normalizedItemSchema, type NormalizedItem } from '@panel/shared';
import { describe, expect, it, vi } from 'vitest';
import { createAdapters } from './index.js';
import { nextNvdWindow, NVD } from './nvd.js';
import { EPSS_PAUSE_MS } from './security.js';
import type { AdapterFetchOptions, FetchContext, NormalizeContext, SourceConfig } from './types.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const now = new Date('2026-11-02T21:00:00Z');
const adapters = createAdapters();

function source(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: 'test',
    name: 'Test',
    kind: 'article',
    adapter: 'rss',
    url: 'https://feed.example.com/rss',
    lang: 'en',
    categoryDefault: 'dev',
    product: null,
    isCustom: false,
    etag: null,
    lastModified: null,
    ...overrides,
  };
}

const ok = (body: string, headers: Record<string, string> = {}): SafeFetchResponse => ({
  status: 200,
  headers,
  body,
  url: 'https://feed.example.com/rss',
  bytes: body.length,
  durationMs: 1,
  redirects: 0,
});

function ctx(
  src: SourceConfig,
  respond: (url: string, options?: AdapterFetchOptions) => SafeFetchResponse,
) {
  const fetch = vi.fn((url: string, options?: AdapterFetchOptions) =>
    Promise.resolve(respond(url, options)),
  );
  const context: FetchContext = {
    source: src,
    now,
    fetch,
    secrets: {},
    cveIdsForEpss: () => [],
    sleep: vi.fn(() => Promise.resolve()),
  };
  return { context, fetch };
}

const nctx = (src: SourceConfig): NormalizeContext => ({ source: src, now });

/** Mirrors the runner: invalid candidates are dropped by the shared schema. */
const valid = (items: NormalizedItem[]) =>
  items.filter((i) => normalizedItemSchema.safeParse(i).success);

describe('rss adapter', () => {
  const rss = adapters.rss;

  it('normalizes RSS 2.0, neutralizing HTML and dropping unsafe items', () => {
    const items = valid(rss.normalize(fixture('rss2.xml'), nctx(source())));
    expect(items).toHaveLength(3);
    const [first, second, third] = items;
    expect(first).toMatchObject({
      kind: 'article',
      title: 'Critical PHP flaw CVE-2026-41234 exploited in the wild',
      summary: 'Attackers exploit CVE-2026-41234 & more.',
      author: 'Jane Doe',
      publishedAt: '2026-11-02T18:00:00.000Z',
      externalId: 'news-1',
    });
    expect(second).toMatchObject({
      title: 'Small open models now summarise the news offline',
      summary: 'A neutral sample paragraph.',
    });
    // Broken date falls back to "now".
    expect(third).toMatchObject({
      title: 'Item with a broken date',
      publishedAt: now.toISOString(),
    });
    expect(JSON.stringify(items)).not.toMatch(/<script|javascript:/i);
  });

  it('normalizes Atom with the alternate link', () => {
    const items = valid(rss.normalize(fixture('atom.xml'), nctx(source())));
    expect(items.map((i) => i.kind === 'article' && i.url)).toEqual([
      'https://dev.example.org/posts/typescript-6',
      'https://dev.example.org/posts/single',
    ]);
    expect(items[0]).toMatchObject({
      title: 'TypeScript 6.0 & the road ahead',
      author: 'Sam Example',
    });
    expect(items[1]).toMatchObject({ publishedAt: '2026-11-01T09:00:00.000Z' });
  });

  it('normalizes RSS 1.0 (RDF)', () => {
    expect(valid(rss.normalize(fixture('rdf.xml'), nctx(source())))).toHaveLength(1);
  });

  it('rejects a feed with a DOCTYPE (entity bomb)', () => {
    expect(() => rss.normalize(fixture('doctype.xml'), nctx(source()))).toThrow(/DOCTYPE/);
  });

  it('caps a 10,000-item feed at 200 items', () => {
    const entries = Array.from(
      { length: 10_000 },
      (_, i) =>
        `<item><title>Item ${String(i)}</title><link>https://feed.example.com/${String(i)}</link></item>`,
    ).join('');
    const xml = `<rss version="2.0"><channel>${entries}</channel></rss>`;
    expect(rss.normalize(xml, nctx(source()))).toHaveLength(200);
  });

  it('truncates oversized fields', () => {
    const xml = `<rss><channel><item><title>${'T'.repeat(5000)}</title><link>https://feed.example.com/x</link><description>${'D'.repeat(50_000)}</description></item></channel></rss>`;
    const [item] = valid(rss.normalize(xml, nctx(source())));
    expect(item?.kind === 'article' && Array.from(item.title).length).toBe(300);
    expect(item?.kind === 'article' && Array.from(item.summary).length).toBe(1000);
  });

  it('resolves relative links against the feed URL', () => {
    const xml =
      '<feed><entry><title>PHP 8.5.12 Released!</title><link href="/releases/8_5_12.php"/>' +
      '<updated>2026-11-01T12:00:00Z</updated></entry></feed>';
    const src = source({
      kind: 'release',
      product: 'PHP',
      url: 'https://www.php.net/releases/feed.php',
    });
    expect(valid(rss.normalize(xml, nctx(src)))).toEqual([
      expect.objectContaining({
        version: '8.5.12',
        url: 'https://www.php.net/releases/8_5_12.php',
      }),
    ]);
  });

  it('turns release feeds into release items with a security flag', () => {
    const items = valid(
      rss.normalize(fixture('releases.xml'), nctx(source({ kind: 'release', product: 'PHP' }))),
    );
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'release',
        product: 'PHP',
        version: '8.3.14',
        isSecurity: true,
      }),
      expect.objectContaining({
        kind: 'release',
        product: 'PHP',
        version: '8.4.1',
        isSecurity: false,
      }),
    ]);
  });

  it('sends a conditional request and reports 304', async () => {
    const src = source({ etag: '"v1"' });
    const { context, fetch } = ctx(src, () => ({ ...ok(''), status: 304 }));
    await expect(rss.fetch(context)).resolves.toEqual({
      status: 'not_modified',
      httpStatus: 304,
      bytes: 0,
    });
    expect(fetch).toHaveBeenCalledWith(src.url, { headers: {}, conditional: true });
  });

  it('returns the body and validators on 200', async () => {
    const { context } = ctx(source(), () =>
      ok('<rss/>', { etag: '"v2"', 'last-modified': 'Mon, 02 Nov 2026 10:00:00 GMT' }),
    );
    await expect(rss.fetch(context)).resolves.toMatchObject({
      status: 'ok',
      raw: '<rss/>',
      etag: '"v2"',
    });
  });
});

describe('security adapters', () => {
  it('cisa-kev: maps entries, drops malformed ones, strips markup', () => {
    const items = valid(adapters['cisa-kev'].normalize(fixture('kev.json'), nctx(source())));
    expect(items).toEqual([
      {
        kind: 'cve-kev',
        cveId: 'CVE-2026-41234',
        product: 'PHP',
        name: 'PHP Remote Code Execution Vulnerability',
        dateAdded: '2026-11-02',
        dueDate: '2026-11-23',
        ransomware: false,
        cwe: 'CWE-787',
      },
      expect.objectContaining({
        cveId: 'CVE-2026-40712',
        name: 'Linux Kernel Privilege Escalation',
        ransomware: true,
        cwe: null,
      }),
    ]);
  });

  it('nvd: picks the primary CVSS 3.1 metric, CWE, CPE ranges, fixes and exploit flag', () => {
    const raw = {
      vulnerabilities: (
        JSON.parse(fixture('nvd.json')) as { vulnerabilities: { cve: unknown }[] }
      ).vulnerabilities.map((v) => v.cve),
      cursor: '',
    };
    const items = valid(adapters.nvd.normalize(raw, nctx(source())));
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      kind: 'cve',
      cveId: 'CVE-2026-41234',
      url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-41234',
      description: 'Out-of-bounds write in PHP before 8.3.14 allows remote code execution.',
      cvss: 9.8,
      cvssVersion: '3.1',
      vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      severity: 'critical',
      cwe: 'CWE-787',
      cpes: ['cpe:2.3:a:php:php:*:*:*:*:*:*:*:*'],
      references: ['https://www.php.example/ChangeLog-8.php', 'https://exploits.example/php-41234'],
      published: '2026-10-30T10:00:00.000Z',
      modified: '2026-11-01T10:00:00.000Z',
      product: 'PHP',
      affected: ['8.2.0 – < 8.2.27', '8.3.0 – < 8.3.14'],
      fixedVersions: '8.2.27 · 8.3.14',
      hasPublicExploit: true,
    });
    expect(items[1]).toMatchObject({
      cveId: 'CVE-2026-40999',
      cvss: null,
      severity: null,
      cwe: null,
      cpes: [],
    });
  });

  it('nvd: incremental window, apiKey header, pagination with pauses', async () => {
    const page = (start: number, count: number, total: number) =>
      JSON.stringify({
        resultsPerPage: count,
        startIndex: start,
        totalResults: total,
        vulnerabilities: Array.from({ length: count }, () => ({ cve: {} })),
      });
    const src = source({
      adapter: 'nvd',
      url: 'https://services.nvd.nist.gov/rest/json/cves/2.0',
      lastModified: '2026-11-01T00:00:00.000Z',
    });
    const { context, fetch } = ctx(src, (url) => {
      const startIndex = Number(new URL(url).searchParams.get('startIndex'));
      return ok(
        page(startIndex, startIndex === 0 ? NVD.resultsPerPage : 50, NVD.resultsPerPage + 50),
      );
    });
    context.secrets.nvdApiKey = 'key-123';
    const result = await adapters.nvd.fetch(context);
    expect(fetch).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(fetch.mock.calls[0]?.[0] ?? '');
    expect(firstUrl.searchParams.get('lastModStartDate')).toBe('2026-11-01T00:00:00.000+00:00');
    expect(firstUrl.searchParams.get('lastModEndDate')).toBe('2026-11-02T21:00:00.000+00:00');
    expect(firstUrl.searchParams.has('apiKey')).toBe(false);
    expect(fetch.mock.calls[0]?.[1]).toEqual({ headers: { apiKey: 'key-123' } });
    expect(context.sleep).toHaveBeenCalledWith(NVD.pauseWithKeyMs);
    expect(result).toMatchObject({ status: 'ok', lastModified: now.toISOString() });
  });

  it('nvd: first run looks back 7 days and pauses 6 s without a key', async () => {
    const src = source({ adapter: 'nvd', url: 'https://services.nvd.nist.gov/rest/json/cves/2.0' });
    let calls = 0;
    const { context, fetch } = ctx(src, () => {
      calls++;
      return ok(
        JSON.stringify({
          resultsPerPage: 1,
          startIndex: 0,
          totalResults: 3,
          vulnerabilities: [{ cve: {} }],
        }),
      );
    });
    const result = await adapters.nvd.fetch(context);
    expect(new URL(fetch.mock.calls[0]?.[0] ?? '').searchParams.get('lastModStartDate')).toBe(
      '2026-10-26T21:00:00.000+00:00',
    );
    expect(context.sleep).toHaveBeenCalledWith(NVD.pauseWithoutKeyMs);
    expect(calls).toBe(3);
    expect(result.status).toBe('ok');
  });

  it('nvd: resumes an oversized window on the exact page next run', async () => {
    const src = source({
      adapter: 'nvd',
      url: 'https://services.nvd.nist.gov/rest/json/cves/2.0',
      lastModified: '2026-11-02T01:00:00.000Z',
    });
    const fullPage = () =>
      ok(
        JSON.stringify({
          resultsPerPage: NVD.resultsPerPage,
          startIndex: 0,
          totalResults: 999_999,
          vulnerabilities: Array.from({ length: NVD.resultsPerPage }, () => ({ cve: {} })),
        }),
      );
    const first = ctx(src, fullPage);
    const result = await adapters.nvd.fetch(first.context);
    const resumeAt = NVD.resultsPerPage * NVD.maxPagesPerRun;
    const cursor = `resume:2026-11-02T01:00:00.000Z|2026-11-02T21:00:00.000Z|${String(resumeAt)}`;
    expect(result).toMatchObject({ lastModified: cursor });

    const second = ctx({ ...src, lastModified: cursor }, fullPage);
    await adapters.nvd.fetch(second.context);
    const url = new URL(second.fetch.mock.calls[0]?.[0] ?? '');
    expect(url.searchParams.get('startIndex')).toBe(String(resumeAt));
    expect(url.searchParams.get('lastModEndDate')).toBe('2026-11-02T21:00:00.000+00:00');
  });

  it('nvd: ignores a corrupted resume cursor', () => {
    const window = nextNvdWindow('resume:garbage|x|-1', now);
    expect(window).toMatchObject({ startIndex: 0 });
    expect(window.end.toISOString()).toBe(now.toISOString());
  });

  it('epss: fetches known CVE ids in batches of 100', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `CVE-2026-${String(10000 + i)}`);
    const { context, fetch } = ctx(
      source({ adapter: 'epss', url: 'https://api.first.org/data/v1/epss' }),
      () => ok(fixture('epss.json')),
    );
    context.cveIdsForEpss = () => ids;
    const result = await adapters.epss.fetch(context);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      new URL(fetch.mock.calls[1]?.[0] ?? '').searchParams.get('cve')?.split(','),
    ).toHaveLength(50);
    expect(context.sleep).toHaveBeenCalledTimes(1);
    expect(context.sleep).toHaveBeenCalledWith(EPSS_PAUSE_MS);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(valid(adapters.epss.normalize(result.raw, nctx(context.source)))[0]).toEqual({
      kind: 'cve-epss',
      cveId: 'CVE-2026-41234',
      epss: 0.94,
      percentile: 0.99,
      date: '2026-11-02',
    });
  });

  it('epss: does nothing when no CVE needs a score', async () => {
    const { context, fetch } = ctx(
      source({ adapter: 'epss', url: 'https://api.first.org/data/v1/epss' }),
      () => ok(''),
    );
    await expect(adapters.epss.fetch(context)).resolves.toMatchObject({ status: 'ok', raw: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ghsa: links advisories to CVEs and sends the token as a header', async () => {
    const items = valid(adapters.ghsa.normalize(fixture('ghsa.json'), nctx(source())));
    expect(items).toEqual([
      {
        kind: 'cve-ghsa',
        cveId: 'CVE-2026-41234',
        ghsaId: 'GHSA-2c8m-mx4q-vw9r',
        severity: 'critical',
        product: 'php/php-src',
        fixedVersions: '8.3.14 · 8.2.27',
        url: 'https://github.com/advisories/GHSA-2c8m-mx4q-vw9r',
      },
      expect.objectContaining({
        cveId: 'CVE-2026-40531',
        severity: null,
        product: null,
        fixedVersions: null,
      }),
    ]);
    const { context, fetch } = ctx(source({ adapter: 'ghsa' }), () => ok('[]'));
    context.secrets.githubToken = 'ghp_test';
    await adapters.ghsa.fetch(context);
    expect(fetch.mock.calls[0]?.[1]?.headers?.['authorization']).toBe('Bearer ghp_test');
  });

  it('hibp: keeps real breaches, drops spam lists and malformed rows', () => {
    expect(valid(adapters.hibp.normalize(fixture('hibp.json'), nctx(source())))).toEqual([
      {
        kind: 'breach',
        name: 'NorthwindRetail',
        title: 'Northwind Retail',
        domain: 'northwind.example',
        accounts: 12_400_000,
        dataClasses: ['Email addresses', 'Passwords'],
        breachDate: '2026-10-01',
        addedDate: '2026-11-01T08:00:00.000Z',
        isVerified: true,
        isSensitive: false,
      },
    ]);
  });

  it('rejects non-JSON bodies', () => {
    expect(() => adapters.hibp.normalize('<html>', nctx(source()))).toThrow(/JSON/);
  });
});

describe('tech adapters', () => {
  it('hn: fetches the top 30, caches items by id, maps stories', async () => {
    const hn = createAdapters().hn;
    const src = source({
      adapter: 'hn',
      url: 'https://hacker-news.firebaseio.com/v0/topstories.json',
    });
    const ids = Array.from({ length: 40 }, (_, i) => i + 1);
    const { context, fetch } = ctx(src, (url) => {
      if (url.endsWith('topstories.json')) return ok(JSON.stringify(ids));
      const id = Number(/item\/(\d+)\.json$/.exec(url)?.[1]);
      if (id === 2) return ok(JSON.stringify({ id, type: 'job', title: 'Hiring' }));
      if (id === 3)
        return ok(
          JSON.stringify({
            id,
            type: 'story',
            title: 'Ask HN: anything?',
            score: 10,
            time: 1_793_000_000,
          }),
        );
      return ok(
        JSON.stringify({
          id,
          type: 'story',
          title: `Story ${String(id)}`,
          url: `https://example.com/${String(id)}`,
          score: id * 10,
          by: 'pg',
          time: 1_793_000_000,
        }),
      );
    });
    const result = await hn.fetch(context);
    expect(fetch).toHaveBeenCalledTimes(31);
    if (result.status !== 'ok') throw new Error('expected ok');
    const items = valid(hn.normalize(result.raw, nctx(src)));
    expect(items).toHaveLength(29);
    expect(items[0]).toMatchObject({
      url: 'https://example.com/1',
      hnPoints: 10,
      externalId: 'hn:1',
      author: 'pg',
    });
    expect(items[1]).toMatchObject({ url: 'https://news.ycombinator.com/item?id=3' });

    fetch.mockClear();
    await hn.fetch(context);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('lobsters: falls back to the discussion URL for text posts', () => {
    const items = valid(adapters.lobsters.normalize(fixture('lobsters.json'), nctx(source())));
    expect(items).toEqual([
      expect.objectContaining({
        url: 'https://blog.example.com/story',
        author: 'alice',
        publishedAt: '2026-11-02T17:00:00.000Z',
      }),
      expect.objectContaining({ url: 'https://lobste.rs/s/def456', author: 'bob' }),
    ]);
  });

  it('devto: maps articles', () => {
    expect(valid(adapters.devto.normalize(fixture('devto.json'), nctx(source())))).toEqual([
      expect.objectContaining({
        title: 'Building a tiny RSS reader',
        author: 'Sam',
        externalId: 'devto:1001',
      }),
      expect.objectContaining({ title: 'No description', summary: '' }),
    ]);
  });

  it('gh-trending: builds the 7-day search and maps repositories', async () => {
    const src = source({
      adapter: 'gh-trending',
      kind: 'repo',
      url: 'https://api.github.com/search/repositories',
    });
    const { context, fetch } = ctx(src, () => ok(fixture('gh-search.json')));
    const result = await adapters['gh-trending'].fetch(context);
    expect(new URL(fetch.mock.calls[0]?.[0] ?? '').searchParams.get('q')).toBe(
      'created:>2026-10-26',
    );
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(valid(adapters['gh-trending'].normalize(result.raw, nctx(src)))).toEqual([
      expect.objectContaining({
        kind: 'repo',
        fullName: 'example/panel-demo',
        stars: 1200,
        language: 'TypeScript',
      }),
      expect.objectContaining({ fullName: 'example/tiny-llm', description: '', language: null }),
    ]);
  });
});
