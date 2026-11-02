# Scoring

All weights live in [`packages/shared/src/scoring.ts`](../packages/shared/src/scoring.ts) and [`classify.ts`](../packages/shared/src/classify.ts), and are covered by unit tests.

## CVE priority (0–100)

```
priority = 35·(cvss / 10) + 30·epss_percentile + 25·kev + 10·watchlist_match
```

| Signal          | Weight | Why                                                                   |
| --------------- | ------ | --------------------------------------------------------------------- |
| CVSS base score | 35     | Technical severity, but says nothing about real-world risk on its own |
| EPSS percentile | 30     | Probability of exploitation in the next 30 days, relative to all CVEs |
| CISA KEV        | 25     | Confirmed exploitation in the wild: the strongest "patch now" signal  |
| Watchlist match | 10     | Relevance to the technologies you actually run                        |

- **No CVSS yet** (NVD backlog): a provisional score is taken from the GitHub Advisory severity (critical 9, high 7.5, medium 5, low 2), otherwise 5. The UI shows an "Awaiting analysis" badge.
- Unknown EPSS counts as 0. The result is clamped to [0, 100] and rounded to one decimal.
- Example: CVE-2026-41234 (demo) — CVSS 9.8, EPSS percentile 0.99, KEV, on the watchlist → 34.3 + 29.7 + 25 + 10 = **99**.

## Article rank (front page)

```
rank = (source.weight + 0.6·(cluster_size − 1) + 0.4·log10(1 + hn_points)) · 0.5^(age_hours / 12)
```

- **Cluster bonus:** a story covered by several outlets is more important.
- **Hacker News points:** logarithmic, so 1 000 points is a bonus of 1.2, not 400.
- **Freshness:** the rank halves every 12 hours. Future dates are treated as "now".
- The front page takes the 4 best articles of the last 24 h, **one per category**. Each category box takes its 4 best remaining articles.

## Category classification

1. Start from the source's default category (+1.5).
2. For each keyword in [`config/keywords.json`](../config/keywords.json): title match adds `weight × 2`, summary match adds `weight × 1`. Each term counts once per field.
3. Matching is on whole words, case- and accent-insensitive, using tokenization (no regular expression is built from configuration, so no ReDoS).
4. Highest score wins; ties go to the source category, then to the order `ai, cyber, innovation, dev, hardware`.

## Story clustering

Titles are folded (case, accents), stripped of punctuation and FR/EN stop words, then split into word trigrams. Two titles published within 48 h with a Jaccard similarity ≥ 0.8 share a `cluster_id`.
