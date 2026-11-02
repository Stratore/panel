import { z } from 'zod';
import { CATEGORIES, ITEM_KINDS, LANGS, LIMITS, SEVERITIES, SOURCE_HEALTH } from './constants.js';

/** Absolute http(s) URL without credentials. Anything else is rejected (SPEC § 9.2, § 9.3). */
export const httpUrlSchema = z
  .url({ protocol: /^https?$/, hostname: z.regexes.domain })
  .max(LIMITS.urlLength)
  .refine((value) => {
    const url = new URL(value);
    return url.username === '' && url.password === '';
  }, 'URL must not contain credentials');

export const categorySchema = z.enum(CATEGORIES);
export const severitySchema = z.enum(SEVERITIES);
export const itemKindSchema = z.enum(ITEM_KINDS);
export const langSchema = z.enum(LANGS);
export const sourceHealthSchema = z.enum(SOURCE_HEALTH);

export const cveIdSchema = z.string().regex(/^CVE-\d{4}-\d{4,7}$/);
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

const title = z.string().trim().min(1).max(LIMITS.titleLength);
const summary = z.string().trim().max(LIMITS.summaryLength);

export const articleItemSchema = z.strictObject({
  kind: z.literal('article'),
  url: httpUrlSchema,
  title,
  summary,
  lang: langSchema,
  author: z.string().trim().max(120).optional(),
  publishedAt: isoDateTimeSchema,
  hnPoints: z.int().nonnegative().optional(),
  externalId: z.string().max(200).optional(),
});

export const cveItemSchema = z.strictObject({
  kind: z.literal('cve'),
  cveId: cveIdSchema,
  url: httpUrlSchema,
  description: summary,
  cvss: z.number().min(0).max(10).nullable(),
  cvssVersion: z.enum(['2.0', '3.0', '3.1', '4.0']).nullable(),
  vector: z.string().max(200).nullable(),
  severity: severitySchema.nullable(),
  cwe: z
    .string()
    .regex(/^CWE-\d{1,5}$/)
    .nullable(),
  cpes: z.array(z.string().max(300)).max(500),
  references: z.array(httpUrlSchema).max(100),
  published: isoDateTimeSchema,
  modified: isoDateTimeSchema,
});

export const breachItemSchema = z.strictObject({
  kind: z.literal('breach'),
  name: z.string().trim().min(1).max(200),
  title,
  domain: z.string().max(253),
  accounts: z.int().nonnegative(),
  dataClasses: z.array(z.string().max(100)).max(100),
  breachDate: z.iso.date(),
  addedDate: isoDateTimeSchema,
  isVerified: z.boolean(),
  isSensitive: z.boolean(),
});

export const releaseItemSchema = z.strictObject({
  kind: z.literal('release'),
  product: z.string().trim().min(1).max(100),
  version: z.string().trim().min(1).max(100),
  isSecurity: z.boolean(),
  url: httpUrlSchema,
  publishedAt: isoDateTimeSchema,
});

export const repoItemSchema = z.strictObject({
  kind: z.literal('repo'),
  fullName: z.string().regex(/^[\w.-]{1,100}\/[\w.-]{1,100}$/),
  description: summary,
  language: z.string().max(50).nullable(),
  url: httpUrlSchema,
  stars: z.int().nonnegative(),
  createdAt: isoDateTimeSchema,
});

/** Output contract of every source adapter's `normalize()` (SPEC § 7.1). */
export const normalizedItemSchema = z.discriminatedUnion('kind', [
  articleItemSchema,
  cveItemSchema,
  breachItemSchema,
  releaseItemSchema,
  repoItemSchema,
]);

export type ArticleItem = z.infer<typeof articleItemSchema>;
export type CveItem = z.infer<typeof cveItemSchema>;
export type BreachItem = z.infer<typeof breachItemSchema>;
export type ReleaseItem = z.infer<typeof releaseItemSchema>;
export type RepoItem = z.infer<typeof repoItemSchema>;
export type NormalizedItem = z.infer<typeof normalizedItemSchema>;

export const watchlistEntrySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: z.string().trim().min(1).max(40),
  keywords: z.array(z.string().trim().min(1).max(60)).min(1).max(30),
  cpePatterns: z.array(z.string().startsWith('cpe:2.3:').max(200)).max(30),
  enabled: z.boolean(),
});
export type WatchlistEntry = z.infer<typeof watchlistEntrySchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const alertThresholdsSchema = z.strictObject({
  cvss: z.number().min(0).max(10),
  epss: z.number().min(0).max(1),
  breachAccounts: z.int().nonnegative(),
  hnPoints: z.int().nonnegative(),
  maxPerHour: z.int().min(1).max(60),
  quietHours: z.strictObject({ start: hhmm, end: hhmm }).nullable(),
  digestAt: hhmm,
});
export type AlertThresholds = z.infer<typeof alertThresholdsSchema>;

/** Instance preferences. Never contains secrets (SPEC § 8, export/import). */
export const prefsSchema = z.strictObject({
  theme: z.enum(['system', 'light', 'dark']),
  lang: langSchema,
  density: z.enum(['comfortable', 'compact']),
  reduceMotion: z.boolean(),
  displayName: z.string().trim().max(40),
  lastVisitAt: isoDateTimeSchema.nullable(),
  alerts: alertThresholdsSchema,
});
export type Prefs = z.infer<typeof prefsSchema>;

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  lang: 'en',
  density: 'comfortable',
  reduceMotion: false,
  displayName: '',
  lastVisitAt: null,
  alerts: {
    cvss: 9,
    epss: 0.5,
    breachAccounts: 1_000_000,
    hnPoints: 500,
    maxPerHour: 5,
    quietHours: { start: '23:00', end: '07:00' },
    digestAt: '08:00',
  },
};

const keywordTermSchema = z.strictObject({
  term: z.string().trim().min(2).max(60),
  weight: z.number().min(0.1).max(5),
  lang: z.enum(['en', 'fr', 'any']),
});
export type KeywordTerm = z.infer<typeof keywordTermSchema>;

/** Shape of config/keywords.json. Bounded to keep classification cheap (SPEC § 7.5). */
export const keywordsConfigSchema = z.strictObject({
  version: z.literal(1),
  categories: z.strictObject({
    ai: z.array(keywordTermSchema).max(300),
    cyber: z.array(keywordTermSchema).max(300),
    innovation: z.array(keywordTermSchema).max(300),
    dev: z.array(keywordTermSchema).max(300),
    hardware: z.array(keywordTermSchema).max(300),
  }),
});
export type KeywordsConfig = z.infer<typeof keywordsConfigSchema>;
