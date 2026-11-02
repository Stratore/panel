import { describe, expect, it } from 'vitest';
import { articleRank, cvePriority, effectiveCvss, severityFromCvss } from './scoring.js';

describe('severityFromCvss', () => {
  it.each([
    [10, 'critical'],
    [9, 'critical'],
    [8.9, 'high'],
    [7, 'high'],
    [6.9, 'medium'],
    [4, 'medium'],
    [3.9, 'low'],
    [0.1, 'low'],
    [0, 'none'],
  ] as const)('%d → %s', (cvss, expected) => {
    expect(severityFromCvss(cvss)).toBe(expected);
  });
});

describe('effectiveCvss', () => {
  it('keeps a real score', () => {
    expect(effectiveCvss(9.8)).toEqual({ score: 9.8, provisional: false });
  });

  it('falls back to the GHSA severity, then to 5', () => {
    expect(effectiveCvss(null, 'critical')).toEqual({ score: 9, provisional: true });
    expect(effectiveCvss(null, 'high')).toEqual({ score: 7.5, provisional: true });
    expect(effectiveCvss(null, 'medium')).toEqual({ score: 5, provisional: true });
    expect(effectiveCvss(null, 'low')).toEqual({ score: 2, provisional: true });
    expect(effectiveCvss(null, 'bogus')).toEqual({ score: 5, provisional: true });
    expect(effectiveCvss(null)).toEqual({ score: 5, provisional: true });
  });

  it('clamps out-of-range scores', () => {
    expect(effectiveCvss(42).score).toBe(10);
  });
});

describe('cvePriority', () => {
  it('reaches 100 for a maximal CVE', () => {
    expect(cvePriority({ cvss: 10, epssPercentile: 1, kev: true, watchlistMatch: true })).toBe(100);
  });

  it('is 0 for a CVSS-0, unknown-EPSS, non-KEV CVE', () => {
    expect(cvePriority({ cvss: 0, epssPercentile: null, kev: false, watchlistMatch: false })).toBe(
      0,
    );
  });

  it('applies 35/30/25/10 weights (demo CVE-2026-41234)', () => {
    // 35·0.98 + 30·0.99 + 25 + 10 = 34.3 + 29.7 + 35 = 99
    expect(cvePriority({ cvss: 9.8, epssPercentile: 0.99, kev: true, watchlistMatch: true })).toBe(
      99,
    );
  });

  it('uses the provisional CVSS when NVD has no score', () => {
    // 35·0.9 = 31.5
    expect(
      cvePriority({
        cvss: null,
        ghsaSeverity: 'critical',
        epssPercentile: 0,
        kev: false,
        watchlistMatch: false,
      }),
    ).toBe(31.5);
  });

  it('clamps an out-of-range percentile', () => {
    expect(cvePriority({ cvss: 0, epssPercentile: 7, kev: false, watchlistMatch: false })).toBe(30);
  });
});

describe('articleRank', () => {
  const now = new Date('2026-11-02T12:00:00Z');

  it('equals the source weight for a fresh, lone article', () => {
    expect(
      articleRank({ sourceWeight: 1, clusterSize: 1, hnPoints: 0, publishedAt: now }, now),
    ).toBe(1);
  });

  it('halves every 12 hours', () => {
    const publishedAt = new Date('2026-11-02T00:00:00Z');
    expect(
      articleRank({ sourceWeight: 1, clusterSize: 1, hnPoints: 0, publishedAt }, now),
    ).toBeCloseTo(0.5);
  });

  it('rewards clusters and HN points', () => {
    // 1 + 0.6·2 + 0.4·log10(1000) = 1 + 1.2 + 1.2
    expect(
      articleRank({ sourceWeight: 1, clusterSize: 3, hnPoints: 999, publishedAt: now }, now),
    ).toBeCloseTo(3.4);
  });

  it('does not boost articles dated in the future', () => {
    const future = new Date('2026-11-03T12:00:00Z');
    expect(
      articleRank({ sourceWeight: 1, clusterSize: 1, hnPoints: 0, publishedAt: future }, now),
    ).toBe(1);
  });
});
