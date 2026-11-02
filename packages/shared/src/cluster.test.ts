import { describe, expect, it } from 'vitest';
import { isSameStory, jaccard, titleShingles, titleTokens } from './cluster.js';

describe('clustering', () => {
  it('normalizes titles: case, accents, punctuation, stop words', () => {
    expect(titleTokens('La faille critique de PHP : mettez à jour !')).toEqual([
      'faille',
      'critique',
      'php',
      'mettez',
      'jour',
    ]);
  });

  it('builds word trigrams', () => {
    expect([...titleShingles('alpha beta gamma delta')]).toEqual([
      'alpha beta gamma',
      'beta gamma delta',
    ]);
  });

  it('uses a single shingle for very short titles', () => {
    expect([...titleShingles('PHP 8.4')]).toEqual(['php 8 4']);
    expect(titleShingles('the of')).toEqual(new Set());
  });

  it('computes Jaccard similarity', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it('groups the same headline from two outlets', () => {
    expect(
      isSameStory(
        'CISA adds PHP remote code execution flaw CVE-2026-41234 to KEV catalog',
        'CISA Adds PHP Remote Code Execution Flaw CVE-2026-41234 to KEV Catalog!',
      ),
    ).toBe(true);
  });

  it('keeps different stories apart', () => {
    expect(
      isSameStory(
        'PHP releases version 8.4 with new features',
        'Python releases version 3.14 with new features',
      ),
    ).toBe(false);
  });
});
