export const APP_NAME = 'Panel';

export const CATEGORIES = ['ai', 'cyber', 'innovation', 'dev', 'hardware'] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'none'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ITEM_KINDS = ['cve', 'article', 'breach', 'release', 'repo'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const LANGS = ['en', 'fr'] as const;
export type Lang = (typeof LANGS)[number];

export const SOURCE_HEALTH = ['healthy', 'slow', 'degraded', 'failing', 'unknown'] as const;
export type SourceHealth = (typeof SOURCE_HEALTH)[number];

/** Field limits applied to every piece of external content (SPEC § 9.3). */
export const LIMITS = {
  urlLength: 2048,
  titleLength: 300,
  summaryLength: 1000,
  feedItems: 200,
  searchQueryLength: 100,
  cveIdsPerItem: 50,
} as const;

/** Constants used by the browser live here, apart from the Zod schemas (bundle size, ADR-031). */
export const PASSPHRASE_MIN = 12;
export const CVE_FILTERS = ['all', 'kev', 'watchlist', 'critical', 'high'] as const;
export const CVE_SORTS = ['priority', 'newest', 'cvss', 'epss'] as const;
