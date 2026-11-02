import { CATEGORIES, type Category } from './constants.js';

export interface RankedArticle {
  id: string;
  category: Category;
  rank: number;
  publishedAt: Date;
}

export const FRONT_PAGE_SIZE = 4;
export const SECTION_SIZE = 4;
export const FRONT_PAGE_WINDOW_HOURS = 24;

const byRankDesc = (a: RankedArticle, b: RankedArticle): number =>
  b.rank - a.rank || b.publishedAt.getTime() - a.publishedAt.getTime();

/** The 4 best articles of the last 24 h, each from a different category (SPEC § 7.7). */
export function selectFrontPage<T extends RankedArticle>(articles: readonly T[], now: Date): T[] {
  const since = now.getTime() - FRONT_PAGE_WINDOW_HOURS * 3_600_000;
  const seen = new Set<Category>();
  const front: T[] = [];
  for (const article of articles.filter((a) => a.publishedAt.getTime() >= since).sort(byRankDesc)) {
    if (seen.has(article.category)) continue;
    seen.add(article.category);
    front.push(article);
    if (front.length === FRONT_PAGE_SIZE) break;
  }
  return front;
}

/** The 4 best articles per category, excluding those already on the front page. */
export function selectSections<T extends RankedArticle>(
  articles: readonly T[],
  excludeIds: ReadonlySet<string>,
): Record<Category, T[]> {
  const sorted = articles.filter((a) => !excludeIds.has(a.id)).sort(byRankDesc);
  const sections = { ai: [], cyber: [], innovation: [], dev: [], hardware: [] } as Record<
    Category,
    T[]
  >;
  for (const category of CATEGORIES) {
    sections[category] = sorted.filter((a) => a.category === category).slice(0, SECTION_SIZE);
  }
  return sections;
}
