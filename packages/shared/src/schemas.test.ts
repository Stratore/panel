import { describe, expect, it } from 'vitest';
import {
  httpUrlSchema,
  normalizedItemSchema,
  prefsSchema,
  sourceDefinitionSchema,
  sourcesCatalogSchema,
  type ArticleItem,
} from './schemas.js';
import { DEFAULT_PREFS } from './defaults.js';
import { NoneSummarizer } from './summarizer.js';

const article: ArticleItem = {
  kind: 'article',
  url: 'https://example.com/news/1',
  title: 'Small open models now summarise the news offline',
  summary: 'A neutral sample summary.',
  lang: 'en',
  publishedAt: '2026-11-02T19:00:00Z',
};

describe('httpUrlSchema', () => {
  it.each(['https://example.com/a', 'http://news.example.org/feed.xml'])('accepts %s', (url) => {
    expect(httpUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:pw@example.com/',
    'https://localhost/',
    `https://example.com/${'a'.repeat(2048)}`,
    '/releases/8_3_14.php',
    'not a url',
  ])('rejects %s without throwing', (url) => {
    expect(httpUrlSchema.safeParse(url).success).toBe(false);
  });
});

describe('normalizedItemSchema', () => {
  it('accepts a valid article', () => {
    expect(normalizedItemSchema.parse(article)).toEqual(article);
  });

  it('rejects unknown keys, oversize titles and bad dates', () => {
    expect(normalizedItemSchema.safeParse({ ...article, html: '<script>' }).success).toBe(false);
    expect(normalizedItemSchema.safeParse({ ...article, title: 'x'.repeat(301) }).success).toBe(
      false,
    );
    expect(normalizedItemSchema.safeParse({ ...article, title: '   ' }).success).toBe(false);
    expect(normalizedItemSchema.safeParse({ ...article, publishedAt: 'yesterday' }).success).toBe(
      false,
    );
  });

  it('accepts a CVE and rejects a malformed id', () => {
    const cve = {
      kind: 'cve',
      cveId: 'CVE-2026-41234',
      url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-41234',
      description: 'Sample description.',
      cvss: 9.8,
      cvssVersion: '3.1',
      vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      severity: 'critical',
      cwe: 'CWE-787',
      cpes: ['cpe:2.3:a:php:php:8.2.26'],
      references: ['https://www.php.net/'],
      published: '2026-10-30T10:00:00Z',
      modified: '2026-11-01T10:00:00Z',
      product: 'PHP',
      affected: ['< 8.3.14'],
      fixedVersions: '8.3.14',
      hasPublicExploit: false,
    };
    expect(normalizedItemSchema.safeParse(cve).success).toBe(true);
    expect(normalizedItemSchema.safeParse({ ...cve, cveId: 'CVE-26-1' }).success).toBe(false);
    expect(normalizedItemSchema.safeParse({ ...cve, cvss: 11 }).success).toBe(false);
  });

  it('accepts breach, release and repo items', () => {
    const items = [
      {
        kind: 'breach',
        name: 'NorthwindRetail',
        title: 'Northwind Retail',
        domain: 'northwind.example',
        accounts: 12_400_000,
        dataClasses: ['Email addresses', 'Passwords'],
        breachDate: '2026-10-01',
        addedDate: '2026-11-01T08:00:00Z',
        isVerified: true,
        isSensitive: false,
      },
      {
        kind: 'release',
        product: 'PHP',
        version: '8.3.14',
        isSecurity: true,
        url: 'https://www.php.net/releases/8_3_14.php',
        publishedAt: '2026-11-01T08:00:00Z',
      },
      {
        kind: 'repo',
        fullName: 'example/panel-demo',
        description: 'Sample repository.',
        language: 'TypeScript',
        url: 'https://github.com/example/panel-demo',
        stars: 1200,
        createdAt: '2026-10-28T08:00:00Z',
      },
    ];
    for (const item of items)
      expect(normalizedItemSchema.safeParse(item).success, item.kind).toBe(true);
  });
});

describe('prefsSchema', () => {
  it('validates the defaults', () => {
    expect(prefsSchema.parse(DEFAULT_PREFS)).toEqual(DEFAULT_PREFS);
  });

  it('rejects invalid quiet hours and unknown keys such as secrets', () => {
    expect(
      prefsSchema.safeParse({
        ...DEFAULT_PREFS,
        alerts: { ...DEFAULT_PREFS.alerts, digestAt: '24:00' },
      }).success,
    ).toBe(false);
    expect(
      prefsSchema.safeParse({ ...DEFAULT_PREFS, discordWebhookUrl: 'https://x' }).success,
    ).toBe(false);
  });
});

describe('NoneSummarizer', () => {
  it('never summarizes', async () => {
    await expect(new NoneSummarizer().summarize()).resolves.toBeNull();
  });
});

describe('sourceDefinitionSchema', () => {
  const base = {
    id: 'example',
    name: 'Example',
    group: 'tech',
    kind: 'article',
    adapter: 'rss',
    url: 'https://example.com/feed',
    lang: 'en',
    category: 'dev',
    schedule: '*/30 * * * *',
    weight: 1,
    enabled: true,
  };

  it('accepts five-field cron schedules', () => {
    expect(sourceDefinitionSchema.safeParse(base).success).toBe(true);
    expect(sourceDefinitionSchema.safeParse({ ...base, schedule: '0 6 * * 1-5' }).success).toBe(
      true,
    );
  });

  it.each(['* * * *', '* * * * * *', '@hourly', '0 6 * * ; rm', ''])(
    'rejects schedule %j',
    (schedule) => {
      expect(sourceDefinitionSchema.safeParse({ ...base, schedule }).success).toBe(false);
    },
  );

  it('rejects duplicate ids in a catalog', () => {
    expect(sourcesCatalogSchema.safeParse({ version: 1, sources: [base, base] }).success).toBe(
      false,
    );
  });
});

describe('CVE patch records', () => {
  it('accepts KEV, EPSS and GHSA patches', () => {
    const patches = [
      {
        kind: 'cve-kev',
        cveId: 'CVE-2026-41234',
        product: 'PHP',
        name: 'PHP Remote Code Execution',
        dateAdded: '2026-11-02',
        dueDate: '2026-11-23',
        ransomware: false,
        cwe: 'CWE-787',
      },
      {
        kind: 'cve-epss',
        cveId: 'CVE-2026-41234',
        epss: 0.94,
        percentile: 0.99,
        date: '2026-11-02',
      },
      {
        kind: 'cve-ghsa',
        cveId: 'CVE-2026-41234',
        ghsaId: 'GHSA-2c8m-mx4q-vw9r',
        severity: 'critical',
        product: 'php/php-src',
        fixedVersions: '8.3.14',
        url: 'https://github.com/advisories/GHSA-2c8m-mx4q-vw9r',
      },
    ];
    for (const patch of patches)
      expect(normalizedItemSchema.safeParse(patch).success, patch.kind).toBe(true);
  });

  it('rejects an out-of-range EPSS score and a malformed GHSA id', () => {
    expect(
      normalizedItemSchema.safeParse({
        kind: 'cve-epss',
        cveId: 'CVE-2026-1234',
        epss: 2,
        percentile: 0.5,
        date: '2026-11-02',
      }).success,
    ).toBe(false);
    expect(
      normalizedItemSchema.safeParse({
        kind: 'cve-ghsa',
        cveId: 'CVE-2026-1234',
        ghsaId: 'GHSA-xxxx',
        severity: null,
        product: null,
        fixedVersions: null,
        url: 'https://github.com/advisories/x',
      }).success,
    ).toBe(false);
  });
});
