import type { Severity } from './constants.js';

/** CVE priority weights, 0–100 total (SPEC § 7.6, docs/SCORING.md). */
export const PRIORITY_WEIGHTS = {
  cvss: 35,
  epssPercentile: 30,
  kev: 25,
  watchlist: 10,
} as const;

/** Provisional CVSS from a GHSA severity when NVD has not scored the CVE yet. */
export const PROVISIONAL_CVSS: Readonly<Record<'critical' | 'high' | 'medium' | 'low', number>> = {
  critical: 9,
  high: 7.5,
  medium: 5,
  low: 2,
};
export const DEFAULT_PROVISIONAL_CVSS = 5;

/** Article rank parameters (SPEC § 7.7). */
export const RANK_PARAMS = {
  clusterBonus: 0.6,
  hnBonus: 0.4,
  halfLifeHours: 12,
} as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** CVSS v3/v4 qualitative rating. */
export function severityFromCvss(cvss: number): Severity {
  if (cvss >= 9) return 'critical';
  if (cvss >= 7) return 'high';
  if (cvss >= 4) return 'medium';
  if (cvss > 0) return 'low';
  return 'none';
}

export interface EffectiveCvss {
  score: number;
  /** True when the score is a placeholder: shown with an "Awaiting analysis" badge. */
  provisional: boolean;
}

export function effectiveCvss(cvss: number | null, ghsaSeverity?: string | null): EffectiveCvss {
  if (cvss !== null && Number.isFinite(cvss))
    return { score: clamp(cvss, 0, 10), provisional: false };
  const fromGhsa =
    ghsaSeverity !== undefined && ghsaSeverity !== null && ghsaSeverity in PROVISIONAL_CVSS
      ? PROVISIONAL_CVSS[ghsaSeverity as keyof typeof PROVISIONAL_CVSS]
      : DEFAULT_PROVISIONAL_CVSS;
  return { score: fromGhsa, provisional: true };
}

export interface CvePriorityInput {
  cvss: number | null;
  ghsaSeverity?: string | null;
  /** EPSS percentile in [0, 1]; null when unknown. */
  epssPercentile: number | null;
  kev: boolean;
  watchlistMatch: boolean;
}

/** priority = 35·(cvss/10) + 30·epss_percentile + 25·kev + 10·watchlist_match, rounded to 0.1. */
export function cvePriority(input: CvePriorityInput): number {
  const { score } = effectiveCvss(input.cvss, input.ghsaSeverity);
  const percentile = clamp(input.epssPercentile ?? 0, 0, 1);
  const raw =
    PRIORITY_WEIGHTS.cvss * (score / 10) +
    PRIORITY_WEIGHTS.epssPercentile * percentile +
    PRIORITY_WEIGHTS.kev * (input.kev ? 1 : 0) +
    PRIORITY_WEIGHTS.watchlist * (input.watchlistMatch ? 1 : 0);
  return Math.round(clamp(raw, 0, 100) * 10) / 10;
}

export interface ArticleRankInput {
  sourceWeight: number;
  clusterSize: number;
  hnPoints: number;
  publishedAt: Date;
}

/** rank = (weight + 0.6·(cluster_size − 1) + 0.4·log10(1 + hn_points)) · 0.5^(age_hours / 12) */
export function articleRank(input: ArticleRankInput, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - input.publishedAt.getTime()) / 3_600_000);
  const base =
    input.sourceWeight +
    RANK_PARAMS.clusterBonus * Math.max(0, input.clusterSize - 1) +
    RANK_PARAMS.hnBonus * Math.log10(1 + Math.max(0, input.hnPoints));
  return base * 0.5 ** (ageHours / RANK_PARAMS.halfLifeHours);
}
