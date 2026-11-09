import { z } from 'zod';
import { CATEGORIES, CVE_FILTERS, CVE_SORTS, LIMITS, PASSPHRASE_MIN } from './constants.js';
import {
  alertThresholdsSchema,
  categorySchema,
  cveIdSchema,
  httpUrlSchema,
  isoDateTimeSchema,
  langSchema,
  prefsSchema,
  severitySchema,
  sourceHealthSchema,
  watchlistEntrySchema,
} from './schemas.js';

/**
 * HTTP contract between the API and the front-end (SPEC § 8). Every route validates its input
 * with these schemas and its output before sending it; the web client reuses the types.
 */

const nullableIso = isoDateTimeSchema.nullable();

// ------------------------------------------------------------------------------------------
// Auth
// ------------------------------------------------------------------------------------------

const passphrase = z.string().min(PASSPHRASE_MIN).max(1024);

export const setupBodySchema = z.strictObject({
  token: z.string().min(1).max(256),
  passphrase,
  displayName: z.string().trim().max(40).default(''),
  lang: langSchema.default('en'),
});
export const loginBodySchema = z.strictObject({ passphrase: z.string().min(1).max(1024) });
export const sessionDtoSchema = z.strictObject({
  authenticated: z.boolean(),
  setupRequired: z.boolean(),
});
export type SessionDto = z.infer<typeof sessionDtoSchema>;

// ------------------------------------------------------------------------------------------
// Content
// ------------------------------------------------------------------------------------------

export const itemDtoSchema = z.strictObject({
  id: z.int(),
  title: z.string(),
  summary: z.string(),
  url: httpUrlSchema,
  sourceId: z.string(),
  sourceName: z.string(),
  lang: langSchema,
  category: categorySchema,
  publishedAt: isoDateTimeSchema,
  clusterSize: z.int().min(1),
  hnPoints: z.int().nullable(),
  tags: z.array(z.string()),
  cveIds: z.array(cveIdSchema),
  rank: z.number(),
});
export type ItemDto = z.infer<typeof itemDtoSchema>;

export const cveSummaryDtoSchema = z.strictObject({
  cveId: cveIdSchema,
  product: z.string().nullable(),
  description: z.string(),
  cvss: z.number().nullable(),
  /** CVSS shown when NVD has not scored it yet (GHSA severity or 5), flagged "Awaiting analysis". */
  cvssEffective: z.number(),
  cvssProvisional: z.boolean(),
  severity: severitySchema.nullable(),
  epss: z.number().nullable(),
  epssPercentile: z.number().nullable(),
  kev: z.boolean(),
  kevAdded: z.string().nullable(),
  kevDue: z.string().nullable(),
  kevRansomware: z.boolean(),
  cwe: z.string().nullable(),
  fixedVersions: z.string().nullable(),
  affected: z.array(z.string()),
  watchlist: z.array(z.string()),
  hasPublicExploit: z.boolean(),
  priority: z.number(),
  published: nullableIso,
});
export type CveSummaryDto = z.infer<typeof cveSummaryDtoSchema>;

export const cveDetailDtoSchema = cveSummaryDtoSchema.extend({
  vector: z.string().nullable(),
  cvssVersion: z.string().nullable(),
  references: z.array(httpUrlSchema),
  kevName: z.string().nullable(),
  ghsaId: z.string().nullable(),
  modified: nullableIso,
  articles: z.array(itemDtoSchema),
});
export type CveDetailDto = z.infer<typeof cveDetailDtoSchema>;

export const breachDtoSchema = z.strictObject({
  name: z.string(),
  title: z.string(),
  domain: z.string(),
  accounts: z.int(),
  dataClasses: z.array(z.string()),
  breachDate: z.string(),
  addedDate: isoDateTimeSchema,
  isVerified: z.boolean(),
  isSensitive: z.boolean(),
});
export type BreachDto = z.infer<typeof breachDtoSchema>;

export const releaseDtoSchema = z.strictObject({
  id: z.int(),
  product: z.string(),
  version: z.string(),
  isSecurity: z.boolean(),
  url: httpUrlSchema,
  publishedAt: isoDateTimeSchema,
});
export type ReleaseDto = z.infer<typeof releaseDtoSchema>;

export const repoDtoSchema = z.strictObject({
  fullName: z.string(),
  description: z.string(),
  language: z.string().nullable(),
  url: httpUrlSchema,
  stars: z.int(),
  starsToday: z.int(),
  createdAt: isoDateTimeSchema,
});
export type RepoDto = z.infer<typeof repoDtoSchema>;

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });

// ------------------------------------------------------------------------------------------
// Journal and Brief
// ------------------------------------------------------------------------------------------

const localized = z.strictObject({ en: z.string(), fr: z.string() });

export const sixtyEntrySchema = z.strictObject({
  kind: z.enum(['kev', 'critical', 'breach', 'release', 'story']),
  category: categorySchema,
  text: localized,
  /** Internal path (`/threats/CVE-…`) or external http(s) URL. */
  href: z.string().max(LIMITS.urlLength).nullable(),
});
export type SixtyEntry = z.infer<typeof sixtyEntrySchema>;

export const snapshotSchema = z.strictObject({
  newCves24h: z.int(),
  critical24h: z.int(),
  kevNew7d: z.int(),
  watchlist7d: z.int(),
  top: z.array(cveSummaryDtoSchema),
});

export const journalDtoSchema = z.strictObject({
  generatedAt: isoDateTimeSchema,
  lastUpdated: nullableIso,
  front: z.array(itemDtoSchema).max(4),
  sections: z.strictObject({
    ai: z.array(itemDtoSchema).max(4),
    cyber: z.array(itemDtoSchema).max(4),
    innovation: z.array(itemDtoSchema).max(4),
    dev: z.array(itemDtoSchema).max(4),
    hardware: z.array(itemDtoSchema).max(4),
  }),
  ticker: z.array(itemDtoSchema).max(10),
  wire: z.array(itemDtoSchema).max(30),
  sixty: z.array(sixtyEntrySchema).max(5),
  snapshot: snapshotSchema,
});
export type JournalDto = z.infer<typeof journalDtoSchema>;

const kpiSchema = z.strictObject({
  value: z.int(),
  /** Relative change vs the 7-day daily average, e.g. 0.18 for +18 %; null without history. */
  delta: z.number().nullable(),
  /** Daily values, oldest first, today last. */
  spark: z.array(z.int()).length(7),
});

export const briefDtoSchema = z.strictObject({
  generatedAt: isoDateTimeSchema,
  displayName: z.string(),
  lastVisitAt: nullableIso,
  newSinceLastVisit: z.int(),
  attention: z.int(),
  kpis: z.strictObject({
    newCves: kpiSchema,
    critical: kpiSchema,
    exploited: kpiSchema,
    watchlist: kpiSchema,
  }),
  priority: z.array(cveSummaryDtoSchema).max(5),
  watchlist: z.array(z.strictObject({ id: z.string(), label: z.string(), count: z.int() })),
  latestBreach: breachDtoSchema.nullable(),
  topStories: z.array(itemDtoSchema).max(5),
  trending: z.array(repoDtoSchema).max(5),
  releases: z.array(releaseDtoSchema).max(5),
});
export type BriefDto = z.infer<typeof briefDtoSchema>;

// ------------------------------------------------------------------------------------------
// Queries
// ------------------------------------------------------------------------------------------

const limit = z.coerce.number().int().min(1).max(50).default(20);
const cursor = z.string().max(200).optional();

export const itemsQuerySchema = z.strictObject({
  category: z.enum(CATEGORIES).optional(),
  lang: langSchema.optional(),
  cursor,
  limit,
});

export const cvesQuerySchema = z.strictObject({
  /** Comma-separated, cumulative: `kev,watchlist`. */
  filter: z
    .string()
    .max(100)
    .default('all')
    .transform((value) => value.split(',').filter((f) => f !== ''))
    .pipe(z.array(z.enum(CVE_FILTERS)).max(CVE_FILTERS.length)),
  /** Watchlist entry id. */
  tech: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .optional(),
  sort: z.enum(CVE_SORTS).default('priority'),
  cursor,
  limit,
});

export const listQuerySchema = z.strictObject({ cursor, limit });

export const searchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(LIMITS.searchQueryLength),
});

export const searchDtoSchema = z.strictObject({
  items: z.array(itemDtoSchema),
  cves: z.array(cveSummaryDtoSchema),
  repos: z.array(repoDtoSchema),
  releases: z.array(releaseDtoSchema),
});
export type SearchDto = z.infer<typeof searchDtoSchema>;

// ------------------------------------------------------------------------------------------
// Sources
// ------------------------------------------------------------------------------------------

export const sourceDtoSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  kind: z.string(),
  adapter: z.string(),
  url: z.string(),
  lang: langSchema,
  category: categorySchema.nullable(),
  enabled: z.boolean(),
  isCustom: z.boolean(),
  weight: z.number(),
  health: sourceHealthSchema,
  consecutiveFailures: z.int(),
  lastRun: z
    .strictObject({
      status: z.enum(['ok', 'not_modified', 'error']),
      at: isoDateTimeSchema,
      durationMs: z.int().nullable(),
      httpStatus: z.int().nullable(),
      itemsNew: z.int(),
      error: z.string().nullable(),
    })
    .nullable(),
});
export type SourceDto = z.infer<typeof sourceDtoSchema>;

export const sourceValidateBodySchema = z.strictObject({
  url: z.string().trim().min(1).max(LIMITS.urlLength),
});

export const FEED_CHECKS = [
  'https',
  'public_address',
  'reachable',
  'content_type',
  'size',
  'valid_feed',
] as const;

export const sourceValidationSchema = z.strictObject({
  ok: z.boolean(),
  url: z.string(),
  checks: z.array(z.strictObject({ id: z.enum(FEED_CHECKS), ok: z.boolean(), detail: z.string() })),
  format: z.enum(['rss', 'atom', 'rdf']).nullable(),
  itemCount: z.int(),
  bytes: z.int(),
  durationMs: z.int(),
  preview: z.array(z.strictObject({ title: z.string(), url: z.string().nullable() })).max(3),
});
export type SourceValidation = z.infer<typeof sourceValidationSchema>;

/** Custom sources are HTTPS only (SPEC § 9.3); safeFetch enforces it again at fetch time. */
const customFeedUrl = httpUrlSchema.refine(
  (url) => url.startsWith('https://'),
  'HTTPS is required',
);

export const sourceCreateBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  url: customFeedUrl,
  lang: langSchema,
  category: categorySchema,
});

export const sourcePatchBodySchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    weight: z.number().min(0.1).max(3).optional(),
    name: z.string().trim().min(1).max(60).optional(),
    category: categorySchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

// ------------------------------------------------------------------------------------------
// Preferences, export/import, alerts
// ------------------------------------------------------------------------------------------

export const prefsDtoSchema = z.strictObject({
  prefs: prefsSchema,
  watchlist: z.array(watchlistEntrySchema).max(30),
  /** Whether each channel has its secret configured on the server. Secrets never leave it. */
  channels: z.strictObject({ discord: z.boolean(), telegram: z.boolean() }),
});
export type PrefsDto = z.infer<typeof prefsDtoSchema>;

export const prefsPutBodySchema = z.strictObject({
  prefs: prefsSchema.optional(),
  watchlist: z
    .array(watchlistEntrySchema)
    .max(30)
    .refine((list) => new Set(list.map((w) => w.id)).size === list.length, 'Duplicate id')
    .optional(),
});

export const exportDtoSchema = z.strictObject({
  version: z.literal(1),
  exportedAt: isoDateTimeSchema,
  prefs: prefsSchema,
  watchlist: z.array(watchlistEntrySchema).max(30),
  customSources: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(60),
        url: customFeedUrl,
        lang: langSchema,
        category: categorySchema,
        enabled: z.boolean(),
      }),
    )
    .max(100),
});
export type ExportDto = z.infer<typeof exportDtoSchema>;

export const alertTestDtoSchema = z.strictObject({
  sent: z.array(z.enum(['discord', 'telegram'])),
  failed: z.array(z.enum(['discord', 'telegram'])),
});

export const alertThresholdsDtoSchema = alertThresholdsSchema;

// ------------------------------------------------------------------------------------------
// Health
// ------------------------------------------------------------------------------------------

export const healthDtoSchema = z.strictObject({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.int(),
  sources: z.strictObject({
    total: z.int(),
    healthy: z.int(),
    degraded: z.int(),
    failing: z.int(),
  }),
  counts: z.strictObject({ items: z.int(), cves: z.int(), breaches: z.int() }),
  lastCollectAt: nullableIso,
});

/** RFC 9457 problem details. */
export const problemSchema = z.strictObject({
  type: z.string(),
  title: z.string(),
  status: z.int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.strictObject({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof problemSchema>;
