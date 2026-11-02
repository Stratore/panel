/**
 * Text helpers used by classification, clustering and watchlist matching.
 * Every pattern here is linear (no nested quantifiers): external text is hostile (SPEC § 9.1, ReDoS).
 */

const COMBINING_MARKS = /\p{M}+/gu;
const NON_WORD = /[^\p{L}\p{N}]+/u;

/** Lowercases and strips accents: "Sécurité" → "securite". */
export function foldText(input: string): string {
  return input.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase();
}

/** Splits folded text into word tokens (letters and digits only). */
export function tokenize(input: string): string[] {
  return foldText(input)
    .split(NON_WORD)
    .filter((token) => token.length > 0);
}

/** Folded FR/EN stop words removed before clustering titles. */
export const STOP_WORDS: ReadonlySet<string> = new Set(
  [
    // English
    'a an and are as at be by for from has have how in is it its new of on or over that the this',
    'to up was what when why will with you your after about into now out',
    // French
    'au aux avec ce ces cette dans de des du en est et il la le les leur mais ne nouveau nouvelle',
    'ou par pas pour qu que qui sa se ses son sont sur un une vers l d',
  ]
    .join(' ')
    .split(' '),
);

/** Returns true when `needle` occurs as a consecutive run inside `haystack`. */
export function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
