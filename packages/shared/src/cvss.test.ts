import { describe, expect, it } from 'vitest';
import { decodeCvssVector } from './cvss.js';

describe('decodeCvssVector', () => {
  const v31 = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';

  it('decodes all eight v3.1 base metrics in English', () => {
    const decoded = decodeCvssVector(v31, 'en');
    expect(decoded?.version).toBe('3.1');
    expect(decoded?.metrics.map((m) => `${m.name}: ${m.label} (${m.code})`)).toEqual([
      'Attack vector: Network (AV:N)',
      'Complexity: Low (AC:L)',
      'Privileges: None (PR:N)',
      'User interaction: None (UI:N)',
      'Scope: Unchanged (S:U)',
      'Confidentiality: High (C:H)',
      'Integrity: High (I:H)',
      'Availability: High (A:H)',
    ]);
  });

  it('decodes in French', () => {
    const decoded = decodeCvssVector(v31, 'fr');
    expect(decoded?.metrics[0]).toMatchObject({ name: "Vecteur d'attaque", label: 'Réseau' });
    expect(decoded?.metrics[3]).toMatchObject({ name: 'Interaction utilisateur', label: 'Aucune' });
  });

  it('decodes v3.0 and ignores temporal metrics', () => {
    const decoded = decodeCvssVector('CVSS:3.0/AV:L/AC:H/PR:L/UI:R/S:C/C:L/I:N/A:N/E:U/RL:O', 'en');
    expect(decoded?.metrics).toHaveLength(8);
    expect(decoded?.metrics[0]?.label).toBe('Local');
  });

  it('decodes v4.0 base metrics', () => {
    const decoded = decodeCvssVector(
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:P/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      'en',
    );
    expect(decoded?.version).toBe('4.0');
    expect(decoded?.metrics.map((m) => m.code)).toEqual([
      'AV:N',
      'AC:L',
      'AT:N',
      'PR:N',
      'UI:P',
      'VC:H',
      'VI:H',
      'VA:H',
    ]);
    expect(decoded?.metrics[4]?.label).toBe('Passive');
  });

  it.each([
    '',
    'AV:N/AC:L',
    'CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P',
    'CVSS:3.1/AV:X/AC:L',
    'CVSS:3.1/AV:N/AV:L',
    'CVSS:3.1/E:U',
    'CVSS:3.1/AV:N/'.padEnd(250, 'A'),
    'CVSS:3.1/__proto__:N',
  ])('rejects %j', (vector) => {
    expect(decodeCvssVector(vector, 'en')).toBeNull();
  });
});
