import { CATEGORIES, type Category } from './constants.js';
import type { KeywordsConfig } from './schemas.js';
import { containsSequence, tokenize } from './text.js';

/** Scoring factors (SPEC § 7.5). */
export const CLASSIFY_WEIGHTS = {
  title: 2,
  summary: 1,
  sourceDefault: 1.5,
} as const;

/** Keyword dictionary pre-tokenized once, so classifying an item never builds patterns. */
export type CompiledKeywords = Readonly<
  Record<Category, readonly { tokens: string[]; weight: number }[]>
>;

export function compileKeywords(config: KeywordsConfig): CompiledKeywords {
  const compile = (category: Category) =>
    config.categories[category]
      .map((entry) => ({ tokens: tokenize(entry.term), weight: entry.weight }))
      .filter((entry) => entry.tokens.length > 0);
  return {
    ai: compile('ai'),
    cyber: compile('cyber'),
    innovation: compile('innovation'),
    dev: compile('dev'),
    hardware: compile('hardware'),
  };
}

export interface ClassifyInput {
  title: string;
  summary: string;
  sourceCategory: Category;
}

export interface ClassifyResult {
  category: Category;
  scores: Record<Category, number>;
}

/**
 * Whole-word, case- and accent-insensitive keyword scoring. Each term counts once per field
 * (repetition is not rewarded). Ties go to the source category, then to CATEGORIES order.
 */
export function classify(input: ClassifyInput, keywords: CompiledKeywords): ClassifyResult {
  const titleTokens = tokenize(input.title);
  const summaryTokens = tokenize(input.summary);
  const scores = { ai: 0, cyber: 0, innovation: 0, dev: 0, hardware: 0 } satisfies Record<
    Category,
    number
  >;

  for (const category of CATEGORIES) {
    let score = category === input.sourceCategory ? CLASSIFY_WEIGHTS.sourceDefault : 0;
    for (const { tokens, weight } of keywords[category]) {
      if (containsSequence(titleTokens, tokens)) score += weight * CLASSIFY_WEIGHTS.title;
      if (containsSequence(summaryTokens, tokens)) score += weight * CLASSIFY_WEIGHTS.summary;
    }
    scores[category] = score;
  }

  let best: Category = input.sourceCategory;
  for (const category of CATEGORIES) {
    if (scores[category] > scores[best]) best = category;
  }
  return { category: best, scores };
}
