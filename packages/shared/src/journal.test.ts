import { describe, expect, it } from 'vitest';
import type { Category } from './constants.js';
import { selectFrontPage, selectSections, type RankedArticle } from './journal.js';

const now = new Date('2026-11-02T21:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const article = (id: string, category: Category, rank: number, age = 1): RankedArticle => ({
  id,
  category,
  rank,
  publishedAt: hoursAgo(age),
});

describe('selectFrontPage', () => {
  it('picks the best article of four different categories', () => {
    const articles = [
      article('a1', 'ai', 9),
      article('a2', 'ai', 8),
      article('c1', 'cyber', 7),
      article('d1', 'dev', 6),
      article('h1', 'hardware', 5),
      article('i1', 'innovation', 4),
    ];
    expect(selectFrontPage(articles, now).map((a) => a.id)).toEqual(['a1', 'c1', 'd1', 'h1']);
  });

  it('ignores articles older than 24 hours', () => {
    const articles = [article('old', 'ai', 99, 25), article('new', 'ai', 1, 2)];
    expect(selectFrontPage(articles, now).map((a) => a.id)).toEqual(['new']);
  });

  it('returns fewer than four when categories are missing', () => {
    expect(selectFrontPage([article('a', 'ai', 1), article('b', 'ai', 2)], now)).toHaveLength(1);
  });
});

describe('selectSections', () => {
  it('keeps the top four per category and excludes front-page items', () => {
    const articles = [
      ...[1, 2, 3, 4, 5, 6].map((n) => article(`ai${String(n)}`, 'ai', n)),
      article('c1', 'cyber', 1),
    ];
    const sections = selectSections(articles, new Set(['ai6']));
    expect(sections.ai.map((a) => a.id)).toEqual(['ai5', 'ai4', 'ai3', 'ai2']);
    expect(sections.cyber.map((a) => a.id)).toEqual(['c1']);
    expect(sections.hardware).toEqual([]);
  });
});
