import { afterEach, describe, expect, it } from 'vitest';
import { catalogs, formatAge, formatCompact, formatRelative, lang, t } from '../lib/i18n.js';
import en from './en.json';
import fr from './fr.json';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('has the same keys in English and French (a missing FR key fails)', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty strings and the same placeholders in both languages', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(en[key].trim(), key).not.toBe('');
      expect(fr[key].trim(), key).not.toBe('');
      expect(placeholders(fr[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('exposes both catalogs', () => {
    expect(Object.keys(catalogs)).toEqual(['en', 'fr']);
  });
});

describe('t() and formatters', () => {
  afterEach(() => {
    lang.set('en');
  });

  it('interpolates parameters and leaves unknown ones visible', () => {
    expect(t('setup.tooShort', { min: 12 })).toBe('Use at least 12 characters.');
    expect(t('setup.tooShort')).toBe('Use at least {min} characters.');
    lang.set('fr');
    expect(t('setup.tooShort', { min: 12 })).toBe('Utilisez au moins 12 caractères.');
  });

  it('formats numbers per language (12.4M / 12,4 M)', () => {
    expect(formatCompact(12_400_000)).toBe('12.4M');
    lang.set('fr');
    expect(formatCompact(12_400_000).replace(/\s/g, ' ')).toBe('12,4 M');
  });

  it('formats relative times and short ages', () => {
    const now = new Date('2026-11-02T21:00:00Z');
    expect(formatRelative('2026-11-02T19:00:00Z', now)).toBe('2 hours ago');
    expect(formatAge('2026-11-02T19:00:00Z', now)).toBe('2 h');
    expect(formatAge('2026-10-30T21:00:00Z', now)).toBe('3 d');
    lang.set('fr');
    expect(formatRelative('2026-11-02T19:00:00Z', now)).toBe('il y a 2 heures');
    expect(formatAge('2026-10-30T21:00:00Z', now)).toBe('3 j');
  });
});
