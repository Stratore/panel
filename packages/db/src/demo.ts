import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PanelDb } from './client.js';
import {
  breaches,
  cves,
  fetchRuns,
  items,
  itemCves,
  releases,
  repos,
  repoStars,
  sources,
} from './schema.js';

/**
 * Clearly fictional sample data (SPEC § 15) for the end-to-end tests and the GitHub Pages
 * demo. Real source ids are reused so the Settings page shows realistic health states.
 */
const H = 3_600_000;

interface DemoArticle {
  source: string;
  category: 'ai' | 'cyber' | 'innovation' | 'dev' | 'hardware';
  title: string;
  summary: string;
  lang: 'en' | 'fr';
  hoursAgo: number;
  cluster?: string;
  hnPoints?: number;
  cves?: string[];
}

const ARTICLES: readonly DemoArticle[] = [
  {
    source: 'arstechnica',
    category: 'ai',
    title: 'Small open models now summarise the news offline on an €80 board',
    summary:
      'A 3-billion-parameter model runs on a single-board computer without any cloud call, with answers in under a second.',
    lang: 'en',
    hoursAgo: 2,
    cluster: 'small-models',
    hnPoints: 640,
  },
  {
    source: 'hn',
    category: 'ai',
    title: 'Small open models now summarise the news offline on an $80 board',
    summary: '',
    lang: 'en',
    hoursAgo: 3,
    cluster: 'small-models',
    hnPoints: 640,
  },
  {
    source: 'next',
    category: 'ai',
    title: 'Un modèle de langue ouvert de 3 milliards de paramètres tient sur un Raspberry Pi',
    summary: 'Les performances surprennent pour un modèle aussi compact.',
    lang: 'fr',
    hoursAgo: 5,
  },
  {
    source: 'theverge',
    category: 'ai',
    title: 'Researchers publish a benchmark for energy use in local inference',
    summary: 'The suite measures joules per token across common hardware.',
    lang: 'en',
    hoursAgo: 9,
  },
  {
    source: 'devto',
    category: 'ai',
    title: 'Building a private document search with embeddings and SQLite',
    summary: 'A step-by-step guide using only local tools.',
    lang: 'en',
    hoursAgo: 14,
  },
  {
    source: 'bleeping',
    category: 'cyber',
    title: 'CVE-2026-41234 in PHP is now exploited in the wild, CISA warns',
    summary: 'The out-of-bounds write affects PHP before 8.3.14 and 8.2.27. Patch now.',
    lang: 'en',
    hoursAgo: 1,
    cves: ['CVE-2026-41234'],
  },
  {
    source: 'cert-fr-alertes',
    category: 'cyber',
    title: 'Multiples vulnérabilités dans OpenSSH',
    summary:
      'Une vulnérabilité permet de contourner l’authentification dans certaines configurations.',
    lang: 'fr',
    hoursAgo: 2,
    cves: ['CVE-2026-40999'],
  },
  {
    source: 'thehackernews',
    category: 'cyber',
    title: 'Northwind Retail confirms a breach affecting 12.4 million accounts',
    summary: 'Email addresses and password hashes were exposed.',
    lang: 'en',
    hoursAgo: 6,
  },
  {
    source: 'theregister',
    category: 'cyber',
    title: 'Container escape in Docker Engine patched in 29.9.3',
    summary: 'CVE-2026-40655 lets a crafted image write outside its root filesystem.',
    lang: 'en',
    hoursAgo: 11,
    cves: ['CVE-2026-40655'],
  },
  {
    source: 'korben',
    category: 'cyber',
    title: 'Pourquoi activer les mises à jour automatiques de vos plugins WordPress',
    summary: 'Une injection SQL dans un plugin populaire rappelle l’importance des correctifs.',
    lang: 'fr',
    hoursAgo: 15,
    cves: ['CVE-2026-40531'],
  },
  {
    source: 'ieee-spectrum',
    category: 'innovation',
    title: 'A solid-state battery cell passes 2,000 charge cycles in lab tests',
    summary: 'The prototype keeps 90% of its capacity after five years of simulated use.',
    lang: 'en',
    hoursAgo: 4,
  },
  {
    source: 'theverge',
    category: 'innovation',
    title: 'Satellite direct-to-phone messaging reaches a new country',
    summary: 'The service works with unmodified handsets.',
    lang: 'en',
    hoursAgo: 8,
  },
  {
    source: 'arstechnica',
    category: 'innovation',
    title: 'Heat pumps outsold gas boilers for the third year in a row',
    summary: 'Installations rose in every region surveyed.',
    lang: 'en',
    hoursAgo: 13,
  },
  {
    source: 'lmi',
    category: 'innovation',
    title: 'Les data centers testent le refroidissement par immersion',
    summary: 'Un retour d’expérience sur deux ans d’exploitation.',
    lang: 'fr',
    hoursAgo: 19,
  },
  {
    source: 'lobsters',
    category: 'dev',
    title: 'TypeScript 6.0 lands with faster builds and stricter defaults',
    summary: 'Project references compile up to 40% faster.',
    lang: 'en',
    hoursAgo: 3,
    hnPoints: 320,
  },
  {
    source: 'theregister',
    category: 'dev',
    title: 'SQLite adds a new JSON storage format',
    summary: 'The binary format speeds up JSON queries without schema changes.',
    lang: 'en',
    hoursAgo: 7,
  },
  {
    source: 'next',
    category: 'dev',
    title: 'Node.js 26 devient la version LTS active',
    summary: 'Le support à long terme court jusqu’en 2029.',
    lang: 'fr',
    hoursAgo: 10,
  },
  {
    source: 'devto',
    category: 'dev',
    title: 'Writing Web Components without a framework in 2026',
    summary: 'Custom Elements, light DOM and a tiny DOM helper go a long way.',
    lang: 'en',
    hoursAgo: 16,
  },
  {
    source: 'tomshardware',
    category: 'hardware',
    title: 'A new low-power GPU targets small boards and home labs',
    summary: 'The card draws 35 W and fits in a mini-ITX case.',
    lang: 'en',
    hoursAgo: 5,
  },
  {
    source: 'tomshardware',
    category: 'hardware',
    title: 'DDR5 prices drop for the fourth month in a row',
    summary: 'Retail kits are now 30% cheaper than in the spring.',
    lang: 'en',
    hoursAgo: 12,
  },
  {
    source: 'next',
    category: 'hardware',
    title: 'Un nouveau processeur ARM vise les serveurs domestiques',
    summary: 'Huit cœurs et une consommation au repos de 3 W.',
    lang: 'fr',
    hoursAgo: 17,
  },
  {
    source: 'ieee-spectrum',
    category: 'hardware',
    title: 'Open-source RISC-V laptop ships to early backers',
    summary: 'The mainboard schematics are published under an open licence.',
    lang: 'en',
    hoursAgo: 21,
  },
];

const day = (now: Date, daysAgo: number) =>
  new Date(now.getTime() - daysAgo * 24 * H).toISOString().slice(0, 10);

export function seedDemoData(db: PanelDb, now: Date = new Date()): void {
  db.transaction((tx) => {
    const ago = (hours: number) => new Date(now.getTime() - hours * H);

    tx.insert(cves)
      .values([
        {
          cveId: 'CVE-2026-41234',
          descriptionEn:
            'Out-of-bounds write in PHP before 8.3.14 and 8.2.27 allows remote code execution.',
          product: 'PHP',
          cvss: 9.8,
          cvssVersion: '3.1',
          vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          severity: 'critical',
          epss: 0.94,
          epssPercentile: 0.998,
          epssDate: day(now, 0),
          kev: true,
          kevName: 'PHP Remote Code Execution Vulnerability',
          kevAdded: day(now, 0),
          kevDue: day(now, -21),
          cwe: 'CWE-787',
          affectedJson: ['8.1.x', '8.2.0 – < 8.2.27', '8.3.0 – < 8.3.14'],
          cpesJson: ['cpe:2.3:a:php:php:*:*:*:*:*:*:*:*'],
          fixedVersions: '8.3.14 · 8.2.27',
          referencesJson: [
            'https://www.php.net/ChangeLog-8.php',
            'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
            'https://exploits.example.org/php-41234',
          ],
          hasPublicExploit: true,
          published: ago(30),
          modified: ago(2),
          priority: 99.4,
          watchlistJson: ['PHP'],
        },
        {
          cveId: 'CVE-2026-40999',
          descriptionEn: 'Authentication bypass in OpenSSH under specific PAM configurations.',
          product: 'OpenSSH',
          cvss: 8.1,
          cvssVersion: '3.1',
          vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H',
          severity: 'high',
          epss: 0.61,
          epssPercentile: 0.97,
          epssDate: day(now, 0),
          cwe: 'CWE-287',
          affectedJson: ['< 9.9p2'],
          cpesJson: ['cpe:2.3:a:openbsd:openssh:*:*:*:*:*:*:*:*'],
          fixedVersions: '9.9p2',
          referencesJson: ['https://www.openssh.example.org/security.html'],
          published: ago(20),
          modified: ago(6),
          priority: 67.5,
          watchlistJson: ['OpenSSH'],
        },
        {
          cveId: 'CVE-2026-40712',
          descriptionEn: 'Use-after-free in the Linux kernel allows local privilege escalation.',
          product: 'Linux kernel',
          cvss: 7.8,
          cvssVersion: '3.1',
          vector: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H',
          severity: 'high',
          epss: 0.12,
          epssPercentile: 0.91,
          epssDate: day(now, 0),
          kev: true,
          kevName: 'Linux Kernel Use-After-Free Vulnerability',
          kevAdded: day(now, 2),
          kevDue: day(now, -19),
          kevRansomware: true,
          cwe: 'CWE-416',
          affectedJson: ['6.1 – < 6.1.118', '6.6 – < 6.6.62'],
          cpesJson: ['cpe:2.3:o:linux:linux_kernel:*:*:*:*:*:*:*:*'],
          fixedVersions: '6.1.118 · 6.6.62',
          referencesJson: ['https://kernel.example.org/stable/'],
          published: ago(70),
          modified: ago(30),
          priority: 89.6,
          watchlistJson: ['Linux'],
        },
        {
          cveId: 'CVE-2026-40655',
          descriptionEn: 'Container escape in Docker Engine through a crafted image layer.',
          product: 'Docker',
          cvss: 8.6,
          cvssVersion: '3.1',
          vector: 'CVSS:3.1/AV:L/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:H',
          severity: 'high',
          epss: 0.08,
          epssPercentile: 0.86,
          epssDate: day(now, 0),
          cwe: 'CWE-22',
          affectedJson: ['< 29.9.3'],
          cpesJson: ['cpe:2.3:a:docker:docker:*:*:*:*:*:*:*:*'],
          fixedVersions: '29.9.3',
          referencesJson: ['https://docs.docker.example.org/security/'],
          published: ago(12),
          modified: ago(12),
          priority: 65.9,
          watchlistJson: ['Docker'],
        },
        {
          cveId: 'CVE-2026-40531',
          descriptionEn: 'SQL injection in a popular WordPress forms plugin.',
          product: 'WordPress plugin',
          cvss: 7.5,
          cvssVersion: '3.1',
          vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N',
          severity: 'high',
          epss: 0.33,
          epssPercentile: 0.95,
          epssDate: day(now, 0),
          cwe: 'CWE-89',
          ghsaId: 'GHSA-9x9x-9x9x-9x9x',
          ghsaSeverity: 'high',
          affectedJson: ['< 4.2.1'],
          fixedVersions: '4.2.1',
          referencesJson: ['https://wordpress.example.org/plugins/forms/'],
          published: ago(40),
          modified: ago(20),
          priority: 64.7,
          watchlistJson: ['WordPress'],
        },
      ])
      .onConflictDoNothing()
      .run();

    ARTICLES.forEach((a, i) => {
      const url = `https://news.example.com/${a.source}/${String(i + 1)}`;
      const row = tx
        .insert(items)
        .values({
          sourceId: a.source,
          kind: 'article',
          url,
          urlHash: createHash('sha256').update(url).digest('hex'),
          title: a.title,
          summary: a.summary,
          lang: a.lang,
          publishedAt: ago(a.hoursAgo),
          fetchedAt: ago(a.hoursAgo),
          category: a.category,
          clusterId: a.cluster ?? `demo-${String(i)}`,
          hnPoints: a.hnPoints ?? null,
          rankScore: 1,
        })
        .onConflictDoNothing()
        .returning({ id: items.id })
        .get() as { id: number } | undefined; // undefined on conflict, despite the type
      if (row) {
        for (const cveId of a.cves ?? [])
          tx.insert(itemCves).values({ itemId: row.id, cveId }).onConflictDoNothing().run();
      }
    });

    tx.insert(breaches)
      .values({
        name: 'NorthwindRetail',
        title: 'Northwind Retail',
        domain: 'northwind.example',
        accounts: 12_400_000,
        dataClassesJson: ['Email addresses', 'Passwords', 'Phone numbers', 'Purchases'],
        breachDate: day(now, 21),
        addedDate: ago(6),
        isVerified: true,
        isSensitive: false,
      })
      .onConflictDoNothing()
      .run();

    tx.insert(releases)
      .values([
        {
          product: 'PHP',
          version: '8.3.14',
          isSecurity: true,
          url: 'https://www.php.net/releases/8_3_14.php',
          publishedAt: ago(26),
        },
        {
          product: 'Docker',
          version: '29.9.3',
          isSecurity: true,
          url: 'https://github.com/moby/moby/releases',
          publishedAt: ago(11),
        },
        {
          product: 'Node.js',
          version: '26.13.0',
          isSecurity: false,
          url: 'https://nodejs.org/en/blog/release',
          publishedAt: ago(48),
        },
        {
          product: 'Python',
          version: '3.15.2',
          isSecurity: true,
          url: 'https://blog.python.org/',
          publishedAt: ago(72),
        },
      ])
      .onConflictDoNothing()
      .run();

    const demoRepos = [
      ['example/panel-demo', 'A self-hosted tech watch dashboard.', 'TypeScript', 1240, 180],
      [
        'example/tiny-llm',
        'Run small language models on single-board computers.',
        'Rust',
        980,
        140,
      ],
      ['example/feedkit', 'Safe RSS and Atom parsing for Node.js.', 'TypeScript', 610, 75],
    ] as const;
    for (const [fullName, description, language, stars, gained] of demoRepos) {
      tx.insert(repos)
        .values({
          fullName,
          description,
          language,
          url: `https://github.com/${fullName}`,
          createdAt: ago(100),
        })
        .onConflictDoNothing()
        .run();
      tx.insert(repoStars)
        .values([
          { fullName, day: day(now, 1), stars: stars - gained },
          { fullName, day: day(now, 0), stars },
        ])
        .onConflictDoNothing()
        .run();
    }

    // Recent runs so Settings shows realistic health, including one slow source.
    const sourceIds = tx
      .select({ id: sources.id })
      .from(sources)
      .all()
      .map((s) => s.id);
    for (const sourceId of sourceIds) {
      const slow = sourceId === 'next';
      tx.insert(fetchRuns)
        .values({
          sourceId,
          startedAt: ago(0.5),
          finishedAt: ago(0.49),
          status: 'ok',
          httpStatus: 200,
          itemsNew: 3,
          bytes: 48_000,
          durationMs: slow ? 4_100 : 310,
        })
        .run();
    }
    tx.update(sources).set({ health: 'healthy' }).run();
    tx.update(sources).set({ health: 'slow' }).where(eq(sources.id, 'next')).run();
  });
}
