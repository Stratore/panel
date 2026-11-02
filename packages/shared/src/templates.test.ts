import { describe, expect, it } from 'vitest';
import { cweNames } from './cwe.js';
import { cveOneLiner, cveTldr, formatEpss, type CveSummaryInput } from './templates.js';

const php: CveSummaryInput = {
  product: 'PHP',
  affectedShort: '< 8.3.14',
  cwe: 'CWE-787',
  cvss: 9.8,
  severity: 'critical',
  kev: true,
  epss: 0.94,
  fix: '8.3.14',
};

const openssh: CveSummaryInput = {
  product: 'OpenSSH',
  affectedShort: null,
  cwe: 'CWE-287',
  cvss: 8.1,
  severity: 'high',
  kev: false,
  epss: null,
  fix: null,
};

describe('cveOneLiner', () => {
  it('renders the full EN line', () => {
    expect(cveOneLiner(php, 'en')).toBe(
      'PHP < 8.3.14 · Out-of-bounds write · CVSS 9.8 · Exploited (KEV) · EPSS 94% · Fix: 8.3.14',
    );
  });

  it('renders the full FR line with French number formatting', () => {
    expect(cveOneLiner(php, 'fr')).toBe(
      'PHP < 8.3.14 · Écriture hors limites · CVSS 9,8 · Exploitée (KEV) · EPSS 94 % · Correctif : 8.3.14',
    );
  });

  it('drops empty parts instead of leaving dangling separators', () => {
    expect(cveOneLiner(openssh, 'en')).toBe(
      'OpenSSH · Authentication bypass · CVSS 8.1 · No fix yet',
    );
  });

  it('handles an unknown product and weakness', () => {
    expect(cveOneLiner({ ...openssh, product: null, cwe: 'CWE-99999' }, 'en')).toBe(
      'affected software · Vulnerability · CVSS 8.1 · No fix yet',
    );
  });
});

describe('cveTldr', () => {
  it('renders EN with exploitation and fix', () => {
    expect(cveTldr(php, 'en')).toBe(
      'Critical out-of-bounds write in PHP < 8.3.14. Actively exploited. Upgrade to 8.3.14.',
    );
  });

  it('renders FR with exploitation and fix', () => {
    expect(cveTldr(php, 'fr')).toBe(
      'Écriture hors limites (gravité critique) dans PHP < 8.3.14. Activement exploitée. Mettre à jour vers 8.3.14.',
    );
  });

  it('renders the no-patch variant in both languages', () => {
    expect(cveTldr(openssh, 'en')).toBe(
      'High-severity improper authentication in OpenSSH. No patch yet — apply vendor mitigation.',
    );
    expect(cveTldr(openssh, 'fr')).toBe(
      'Contournement d’authentification (gravité élevée) dans OpenSSH. Pas encore de correctif — appliquer les mesures de l’éditeur.',
    );
  });
});

describe('formatEpss', () => {
  it('rounds to a whole percentage and flags tiny values', () => {
    expect(formatEpss(0.6149, 'en')).toBe('61%');
    expect(formatEpss(0.001, 'en')).toBe('<1%');
    expect(formatEpss(0, 'en')).toBe('0%');
    expect(formatEpss(0.001, 'fr')).toBe('<1 %');
  });
});

describe('cweNames', () => {
  it('resolves known weaknesses and falls back otherwise', () => {
    expect(cweNames('CWE-89', 'fr')).toEqual({ short: 'Injection SQL', long: 'injection SQL' });
    expect(cweNames(null, 'en')).toEqual({ short: 'Vulnerability', long: 'vulnerability' });
    expect(cweNames('constructor', 'en').short).toBe('Vulnerability');
  });
});
