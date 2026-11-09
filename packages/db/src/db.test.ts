import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDatabase } from './backup.js';
import { migrateDatabase, openDatabase, type DatabaseHandle } from './client.js';
import { compactDatabase, purgeExpired } from './retention.js';
import * as schema from './schema.js';
import { loadSourcesCatalog, PREFS_KEY, seedDatabase } from './seed.js';

const CATALOG_PATH = fileURLToPath(
  new URL('../../../config/sources.default.json', import.meta.url),
);
const now = new Date('2026-11-02T21:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

let dir: string;
let handle: DatabaseHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'panel-db-'));
  handle = openDatabase(join(dir, 'panel.db'));
  migrateDatabase(handle.db);
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

function insertItem(overrides: Partial<typeof schema.items.$inferInsert> = {}) {
  return handle.db
    .insert(schema.items)
    .values({
      sourceId: 'bleeping',
      kind: 'article',
      url: 'https://example.com/a',
      urlHash: 'hash-a',
      title: 'Sécurité : une faille critique dans PHP',
      summary: 'Sample summary about OpenSSH.',
      lang: 'fr',
      publishedAt: now,
      fetchedAt: now,
      category: 'cyber',
      ...overrides,
    })
    .returning({ id: schema.items.id })
    .get();
}

describe('openDatabase + migrateDatabase', () => {
  it('applies the required pragmas', () => {
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(handle.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('creates every table from scratch, including FTS5', () => {
    const tables = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '%fts_%'")
      .pluck()
      .all();
    expect(tables).toEqual(
      expect.arrayContaining([
        'sources',
        'fetch_runs',
        'items',
        'items_fts',
        'cves',
        'item_cves',
        'breaches',
        'releases',
        'repos',
        'repo_stars',
        'watchlist',
        'alerts_sent',
        'prefs',
        'users',
        'sessions',
      ]),
    );
  });

  it('is idempotent', () => {
    expect(() => {
      migrateDatabase(handle.db);
    }).not.toThrow();
  });
});

describe('seedDatabase', () => {
  it('loads a valid catalog', () => {
    const catalog = loadSourcesCatalog(CATALOG_PATH);
    expect(catalog.sources.length).toBeGreaterThan(20);
    expect(catalog.sources.every((s) => s.url.startsWith('https://'))).toBe(true);
  });

  it('is idempotent and preserves user changes', () => {
    const catalog = loadSourcesCatalog(CATALOG_PATH);
    const first = seedDatabase(handle.db, catalog, now);
    expect(first).toEqual({
      sources: catalog.sources.length,
      watchlistSeeded: true,
      prefsSeeded: true,
    });

    handle.db
      .update(schema.sources)
      .set({ enabled: false })
      .where(eq(schema.sources.id, 'hn'))
      .run();
    handle.db.delete(schema.watchlist).where(eq(schema.watchlist.id, 'wordpress')).run();
    handle.db
      .update(schema.prefs)
      .set({ valueJson: { custom: true } })
      .where(eq(schema.prefs.key, PREFS_KEY))
      .run();

    const second = seedDatabase(handle.db, catalog, now);
    expect(second).toEqual({
      sources: catalog.sources.length,
      watchlistSeeded: false,
      prefsSeeded: false,
    });

    const count = (table: typeof schema.sources | typeof schema.watchlist) =>
      handle.db
        .select({ n: sql<number>`count(*)` })
        .from(table)
        .get()?.n;
    expect(count(schema.sources)).toBe(catalog.sources.length);
    expect(count(schema.watchlist)).toBe(8);
    expect(
      handle.db.select().from(schema.sources).where(eq(schema.sources.id, 'hn')).get()?.enabled,
    ).toBe(false);
    expect(handle.db.select().from(schema.prefs).get()?.valueJson).toEqual({ custom: true });
  });

  it('refreshes catalog fields but never touches custom sources', () => {
    const catalog = loadSourcesCatalog(CATALOG_PATH);
    seedDatabase(handle.db, catalog, now);
    handle.db
      .insert(schema.sources)
      .values({
        id: 'custom-korben',
        name: 'My feed',
        group: 'custom',
        kind: 'article',
        adapter: 'rss',
        url: 'https://korben.info/feed',
        lang: 'fr',
        schedule: '0 * * * *',
        isCustom: true,
      })
      .run();

    const renamed = {
      ...catalog,
      sources: catalog.sources.map((s) => (s.id === 'next' ? { ...s, name: 'Next.ink' } : s)),
    };
    seedDatabase(handle.db, renamed, now);
    const byId = (id: string) =>
      handle.db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
    expect(byId('next')?.name).toBe('Next.ink');
    expect(byId('custom-korben')?.name).toBe('My feed');
  });
});

describe('items and full-text search', () => {
  beforeEach(() => {
    seedDatabase(handle.db, loadSourcesCatalog(CATALOG_PATH), now);
  });

  const search = (query: string) =>
    handle.sqlite.prepare('SELECT rowid FROM items_fts WHERE items_fts MATCH ?').pluck().all(query);

  it('enforces url_hash uniqueness', () => {
    insertItem();
    expect(() => insertItem()).toThrow(/UNIQUE/);
  });

  it('indexes inserts, updates and deletes, accent-insensitively', () => {
    const item = insertItem();
    expect(search('securite')).toEqual([item.id]);
    expect(search('openssh')).toEqual([item.id]);

    handle.db
      .update(schema.items)
      .set({ title: 'Docker update' })
      .where(eq(schema.items.id, item.id))
      .run();
    expect(search('securite')).toEqual([]);
    expect(search('docker')).toEqual([item.id]);

    handle.db.delete(schema.items).where(eq(schema.items.id, item.id)).run();
    expect(search('docker')).toEqual([]);
  });

  it('rejects items pointing at an unknown source', () => {
    expect(() => insertItem({ sourceId: 'nope' })).toThrow(/FOREIGN KEY/);
  });
});

describe('purgeExpired', () => {
  beforeEach(() => {
    seedDatabase(handle.db, loadSourcesCatalog(CATALOG_PATH), now);
  });

  it('applies every retention window and keeps KEV CVEs', () => {
    const old = insertItem({ urlHash: 'old', publishedAt: daysAgo(31), fetchedAt: daysAgo(31) });
    insertItem({ urlHash: 'recent', publishedAt: daysAgo(29), fetchedAt: daysAgo(29) });
    handle.db
      .insert(schema.cves)
      .values([
        { cveId: 'CVE-2025-0001', published: daysAgo(400) },
        { cveId: 'CVE-2025-0002', published: daysAgo(400), kev: true },
        { cveId: 'CVE-2026-0003', published: daysAgo(10) },
      ])
      .run();
    handle.db.insert(schema.itemCves).values({ itemId: old.id, cveId: 'CVE-2026-0003' }).run();
    handle.db
      .insert(schema.fetchRuns)
      .values([
        { sourceId: 'hn', startedAt: daysAgo(8), status: 'ok' },
        { sourceId: 'hn', startedAt: daysAgo(1), status: 'ok' },
      ])
      .run();
    handle.db
      .insert(schema.alertsSent)
      .values([
        {
          dedupeKey: 'kev:CVE-2025-0002',
          channel: 'discord',
          payloadHash: 'x',
          sentAt: daysAgo(91),
        },
        {
          dedupeKey: 'kev:CVE-2026-0003',
          channel: 'discord',
          payloadHash: 'y',
          sentAt: daysAgo(1),
        },
      ])
      .run();
    const user = handle.db.insert(schema.users).values({ passphraseHash: 'x' }).returning().get();
    handle.db
      .insert(schema.sessions)
      .values([
        {
          id: 's1',
          userId: user.id,
          createdAt: daysAgo(40),
          expiresAt: daysAgo(10),
          lastSeenAt: daysAgo(10),
        },
        {
          id: 's2',
          userId: user.id,
          createdAt: daysAgo(1),
          expiresAt: daysAgo(-29),
          lastSeenAt: now,
        },
      ])
      .run();

    handle.db
      .insert(schema.events)
      .values([
        { type: 'item.new', payloadJson: {}, createdAt: daysAgo(2) },
        { type: 'item.new', payloadJson: {}, createdAt: now },
      ])
      .run();

    expect(purgeExpired(handle.db, now)).toEqual({
      items: 1,
      cves: 1,
      fetchRuns: 1,
      alertsSent: 1,
      repoStars: 0,
      sessions: 1,
      events: 1,
    });
    expect(
      handle.db
        .select()
        .from(schema.cves)
        .all()
        .map((c) => c.cveId),
    ).toEqual(['CVE-2025-0002', 'CVE-2026-0003']);
    expect(handle.db.select().from(schema.itemCves).all()).toEqual([]);
  });
});

describe('backupDatabase', () => {
  it('writes a consistent copy and keeps the 7 most recent', async () => {
    seedDatabase(handle.db, loadSourcesCatalog(CATALOG_PATH), now);
    const backups = join(dir, 'backups');
    for (let day = 9; day >= 0; day--) {
      await backupDatabase(handle.sqlite, backups, { now: daysAgo(day) });
    }
    const files = readdirSync(backups).sort();
    expect(files).toHaveLength(7);
    expect(files.at(-1)).toBe('panel-20261102T210000Z.db');

    const latest = join(backups, files.at(-1) ?? '');
    expect(existsSync(latest)).toBe(true);
    const copy = openDatabase(latest, { readonly: true });
    expect(
      copy.db
        .select({ n: sql<number>`count(*)` })
        .from(schema.sources)
        .get()?.n,
    ).toBeGreaterThan(20);
    copy.close();
  });
});

describe('compactDatabase', () => {
  it('optimizes FTS and vacuums without losing data', () => {
    seedDatabase(handle.db, loadSourcesCatalog(CATALOG_PATH), now);
    insertItem();
    compactDatabase(handle.db);
    expect(handle.db.select().from(schema.items).all()).toHaveLength(1);
  });
});
