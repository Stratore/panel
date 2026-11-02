import { STOP_WORDS, tokenize } from './text.js';

/** Titles at or above this Jaccard similarity belong to the same story (SPEC § 7.2). */
export const CLUSTER_THRESHOLD = 0.8;
export const CLUSTER_WINDOW_HOURS = 48;

/** Normalized title tokens: folded, punctuation and FR/EN stop words removed. */
export function titleTokens(title: string): string[] {
  return tokenize(title).filter((token) => !STOP_WORDS.has(token));
}

/** Word trigrams of a title. Titles shorter than three words yield a single shingle. */
export function titleShingles(title: string): Set<string> {
  const tokens = titleTokens(title);
  if (tokens.length < 3) return new Set(tokens.length > 0 ? [tokens.join(' ')] : []);
  const shingles = new Set<string>();
  for (let i = 0; i + 3 <= tokens.length; i++) {
    shingles.add(`${tokens[i] ?? ''} ${tokens[i + 1] ?? ''} ${tokens[i + 2] ?? ''}`);
  }
  return shingles;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export function isSameStory(titleA: string, titleB: string): boolean {
  return jaccard(titleShingles(titleA), titleShingles(titleB)) >= CLUSTER_THRESHOLD;
}
