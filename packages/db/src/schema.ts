import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type {
  Category,
  ItemKind,
  Lang,
  Severity,
  SourceHealth,
  SummaryStatus,
} from '@panel/shared';

/** Millisecond timestamps, returned as Date. */
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });
const bool = (name: string) => integer(name, { mode: 'boolean' });
const now = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  group: text('group').notNull(),
  kind: text('kind').$type<ItemKind>().notNull(),
  adapter: text('adapter').notNull(),
  url: text('url').notNull(),
  lang: text('lang').$type<Lang>().notNull(),
  categoryDefault: text('category_default').$type<Category>(),
  product: text('product'),
  schedule: text('schedule').notNull(),
  enabled: bool('enabled').notNull().default(true),
  isCustom: bool('is_custom').notNull().default(false),
  weight: real('weight').notNull().default(1),
  etag: text('etag'),
  lastModified: text('last_modified'),
  health: text('health').$type<SourceHealth>().notNull().default('unknown'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  createdAt: timestamp('created_at').notNull().default(now),
  updatedAt: timestamp('updated_at').notNull().default(now),
});

export const fetchRuns = sqliteTable(
  'fetch_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at').notNull(),
    finishedAt: timestamp('finished_at'),
    status: text('status').$type<'ok' | 'not_modified' | 'error'>().notNull(),
    httpStatus: integer('http_status'),
    itemsNew: integer('items_new').notNull().default(0),
    bytes: integer('bytes').notNull().default(0),
    durationMs: integer('duration_ms'),
    error: text('error'),
  },
  (t) => [index('fetch_runs_source_started_idx').on(t.sourceId, t.startedAt)],
);

export const items = sqliteTable(
  'items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ItemKind>().notNull(),
    url: text('url').notNull(),
    urlHash: text('url_hash').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    lang: text('lang').$type<Lang>().notNull(),
    author: text('author'),
    publishedAt: timestamp('published_at').notNull(),
    fetchedAt: timestamp('fetched_at').notNull(),
    category: text('category').$type<Category>().notNull(),
    tagsJson: text('tags_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
    clusterId: text('cluster_id'),
    rankScore: real('rank_score').notNull().default(0),
    hnPoints: integer('hn_points'),
    extraJson: text('extra_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    summaryStatus: text('summary_status').$type<SummaryStatus>().notNull().default('none'),
  },
  (t) => [
    uniqueIndex('items_url_hash_idx').on(t.urlHash),
    index('items_published_idx').on(t.publishedAt),
    index('items_category_published_idx').on(t.category, t.publishedAt),
    index('items_cluster_idx').on(t.clusterId),
  ],
);

export const cves = sqliteTable(
  'cves',
  {
    cveId: text('cve_id').primaryKey(),
    descriptionEn: text('description_en').notNull().default(''),
    cvss: real('cvss'),
    cvssVersion: text('cvss_version'),
    vector: text('vector'),
    severity: text('severity').$type<Severity>(),
    ghsaSeverity: text('ghsa_severity'),
    ghsaId: text('ghsa_id'),
    epss: real('epss'),
    epssPercentile: real('epss_percentile'),
    epssDate: text('epss_date'),
    kev: bool('kev').notNull().default(false),
    kevName: text('kev_name'),
    kevAdded: text('kev_added'),
    kevDue: text('kev_due'),
    kevRansomware: bool('kev_ransomware').notNull().default(false),
    cwe: text('cwe'),
    cweName: text('cwe_name'),
    product: text('product'),
    affectedJson: text('affected_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
    cpesJson: text('cpes_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
    fixedVersions: text('fixed_versions'),
    referencesJson: text('references_json', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    hasPublicExploit: bool('has_public_exploit').notNull().default(false),
    published: timestamp('published'),
    modified: timestamp('modified'),
    priority: real('priority').notNull().default(0),
    /** Watchlist labels matched by product, KEV name, description or CPEs (kept by the collector). */
    watchlistJson: text('watchlist_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
  },
  (t) => [
    index('cves_priority_idx').on(t.priority),
    index('cves_published_idx').on(t.published),
    index('cves_kev_idx').on(t.kev),
  ],
);

export const itemCves = sqliteTable(
  'item_cves',
  {
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    cveId: text('cve_id')
      .notNull()
      .references(() => cves.cveId, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.cveId] }), index('item_cves_cve_idx').on(t.cveId)],
);

export const breaches = sqliteTable(
  'breaches',
  {
    name: text('name').primaryKey(),
    title: text('title').notNull(),
    domain: text('domain').notNull().default(''),
    accounts: integer('accounts').notNull(),
    dataClassesJson: text('data_classes_json', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    breachDate: text('breach_date').notNull(),
    addedDate: timestamp('added_date').notNull(),
    isVerified: bool('is_verified').notNull(),
    isSensitive: bool('is_sensitive').notNull(),
  },
  (t) => [index('breaches_added_idx').on(t.addedDate)],
);

export const releases = sqliteTable(
  'releases',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    product: text('product').notNull(),
    version: text('version').notNull(),
    isSecurity: bool('is_security').notNull().default(false),
    url: text('url').notNull(),
    publishedAt: timestamp('published_at').notNull(),
  },
  (t) => [
    uniqueIndex('releases_product_version_idx').on(t.product, t.version),
    index('releases_published_idx').on(t.publishedAt),
  ],
);

export const repos = sqliteTable('repos', {
  fullName: text('full_name').primaryKey(),
  description: text('description').notNull().default(''),
  language: text('language'),
  url: text('url').notNull(),
  createdAt: timestamp('created_at').notNull(),
});

export const repoStars = sqliteTable(
  'repo_stars',
  {
    fullName: text('full_name')
      .notNull()
      .references(() => repos.fullName, { onDelete: 'cascade' }),
    /** UTC day, YYYY-MM-DD. */
    day: text('day').notNull(),
    stars: integer('stars').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fullName, t.day] })],
);

export const watchlist = sqliteTable('watchlist', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  keywordsJson: text('keywords_json', { mode: 'json' }).$type<string[]>().notNull(),
  cpePatternsJson: text('cpe_patterns_json', { mode: 'json' }).$type<string[]>().notNull(),
  enabled: bool('enabled').notNull().default(true),
});

export const alertsSent = sqliteTable(
  'alerts_sent',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    dedupeKey: text('dedupe_key').notNull(),
    channel: text('channel').notNull(),
    payloadHash: text('payload_hash').notNull(),
    sentAt: timestamp('sent_at').notNull(),
  },
  (t) => [
    uniqueIndex('alerts_sent_dedupe_idx').on(t.dedupeKey, t.channel),
    index('alerts_sent_sent_idx').on(t.sentAt),
  ],
);

export const prefs = sqliteTable('prefs', {
  key: text('key').primaryKey(),
  valueJson: text('value_json', { mode: 'json' }).$type<unknown>().notNull(),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  passphraseHash: text('passphrase_hash').notNull(),
  createdAt: timestamp('created_at').notNull().default(now),
});

export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    lastSeenAt: timestamp('last_seen_at').notNull(),
    uaHash: text('ua_hash'),
  },
  (t) => [index('sessions_expires_idx').on(t.expiresAt)],
);

/**
 * Change feed written by the collector and tailed by the API to push SSE events
 * (SPEC § 8 /stream). Rows are short-lived: purged after a day.
 */
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').$type<'item.new' | 'cve.updated' | 'source.health'>().notNull(),
    payloadJson: text('payload_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('events_created_idx').on(t.createdAt)],
);
