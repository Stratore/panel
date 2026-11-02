import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify, compileKeywords } from './classify.js';
import { keywordsConfigSchema, type KeywordsConfig } from './schemas.js';

const fixture: KeywordsConfig = {
  version: 1,
  categories: {
    ai: [
      { term: 'LLM', weight: 3, lang: 'any' },
      { term: 'intelligence artificielle', weight: 2, lang: 'fr' },
    ],
    cyber: [
      { term: 'ransomware', weight: 3, lang: 'any' },
      { term: 'faille', weight: 2, lang: 'fr' },
    ],
    innovation: [{ term: 'quantum', weight: 3, lang: 'any' }],
    dev: [{ term: 'typescript', weight: 3, lang: 'any' }],
    hardware: [{ term: 'GPU', weight: 3, lang: 'any' }],
  },
};
const keywords = compileKeywords(fixture);

describe('classify', () => {
  it('falls back to the source category when nothing matches', () => {
    expect(
      classify({ title: 'Weekly notes', summary: '', sourceCategory: 'dev' }, keywords).category,
    ).toBe('dev');
  });

  it('weights the title ×2 and the summary ×1', () => {
    const { scores } = classify(
      { title: 'New ransomware strain', summary: 'A ransomware group…', sourceCategory: 'dev' },
      keywords,
    );
    expect(scores.cyber).toBe(9);
    expect(scores.dev).toBe(1.5);
  });

  it('beats the source bonus with a strong keyword', () => {
    expect(
      classify({ title: 'Running an LLM locally', summary: '', sourceCategory: 'dev' }, keywords)
        .category,
    ).toBe('ai');
  });

  it('is case- and accent-insensitive and matches multi-word terms', () => {
    const result = classify(
      { title: "L'INTELLIGENCE ARTIFICIELLE à l'école", summary: '', sourceCategory: 'innovation' },
      keywords,
    );
    expect(result.category).toBe('ai');
    expect(result.scores.ai).toBe(4);
  });

  it('matches whole words only', () => {
    // "gpus" and "typescriptish" must not match "gpu" / "typescript".
    const result = classify(
      { title: 'gpus typescriptish', summary: '', sourceCategory: 'cyber' },
      keywords,
    );
    expect(result.scores.hardware).toBe(0);
    expect(result.scores.dev).toBe(0);
  });

  it('breaks ties in favour of the source category', () => {
    // GPU (title, 6) vs typescript (title, 6) + source bonus on dev.
    expect(
      classify({ title: 'GPU typescript', summary: '', sourceCategory: 'dev' }, keywords).category,
    ).toBe('dev');
  });

  it('breaks ties without the source category by category order', () => {
    // innovation source bonus 1.5; cyber 6 vs hardware 6: cyber comes first.
    expect(
      classify({ title: 'ransomware GPU', summary: '', sourceCategory: 'innovation' }, keywords)
        .category,
    ).toBe('cyber');
  });

  it('handles hostile input in linear time', () => {
    const start = performance.now();
    classify(
      { title: 'a'.repeat(50_000), summary: '!'.repeat(50_000), sourceCategory: 'dev' },
      keywords,
    );
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('config/keywords.json', () => {
  it('matches the schema and compiles every term', () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL('../../../config/keywords.json', import.meta.url), 'utf8'),
    );
    const config = keywordsConfigSchema.parse(raw);
    const compiled = compileKeywords(config);
    for (const category of Object.keys(config.categories) as (keyof typeof compiled)[]) {
      expect(compiled[category]).toHaveLength(config.categories[category].length);
    }
  });

  it('classifies typical headlines sensibly', () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL('../../../config/keywords.json', import.meta.url), 'utf8'),
    );
    const real = compileKeywords(keywordsConfigSchema.parse(raw));
    const cases = [
      ['Ransomware gang claims attack on hospital', 'dev', 'cyber'],
      ['Nvidia unveils a new GPU for laptops', 'innovation', 'hardware'],
      ['Une faille critique dans OpenSSH', 'dev', 'cyber'],
      ['Running a small LLM on a Raspberry Pi', 'innovation', 'ai'],
      ['TypeScript 6.0 released', 'innovation', 'dev'],
    ] as const;
    for (const [title, source, expected] of cases) {
      expect(classify({ title, summary: '', sourceCategory: source }, real).category, title).toBe(
        expected,
      );
    }
  });
});
