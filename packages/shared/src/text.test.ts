import { describe, expect, it } from 'vitest';
import { containsSequence, foldText, tokenize } from './text.js';

describe('text helpers', () => {
  it('folds case and accents', () => {
    expect(foldText('Sécurité ÉLEVÉE à Noël')).toBe('securite elevee a noel');
  });

  it('tokenizes on anything that is not a letter or digit', () => {
    expect(tokenize("Node.js 26 — l'IA, c'est «cool»!")).toEqual([
      'node',
      'js',
      '26',
      'l',
      'ia',
      'c',
      'est',
      'cool',
    ]);
  });

  it('returns no tokens for punctuation only', () => {
    expect(tokenize('—!?…')).toEqual([]);
  });

  it('finds consecutive token runs', () => {
    expect(containsSequence(['a', 'b', 'c'], ['b', 'c'])).toBe(true);
    expect(containsSequence(['a', 'b', 'c'], ['a', 'c'])).toBe(false);
    expect(containsSequence(['a'], ['a', 'b'])).toBe(false);
    expect(containsSequence(['a'], [])).toBe(false);
  });
});
