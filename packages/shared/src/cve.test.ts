import { describe, expect, it } from 'vitest';
import { extractCveIds } from './cve.js';

describe('extractCveIds', () => {
  it('finds, uppercases and dedupes CVE identifiers', () => {
    expect(
      extractCveIds('Patch cve-2026-41234 and CVE-2026-41234, plus CVE-2025-1234567.'),
    ).toEqual(['CVE-2026-41234', 'CVE-2025-1234567']);
  });

  it('ignores malformed identifiers', () => {
    expect(extractCveIds('CVE-26-1234 CVE-2026-123 XCVE-2026-12345 CVE-2026-12345678')).toEqual([]);
  });

  it('caps the number of identifiers per item', () => {
    const text = Array.from({ length: 80 }, (_, i) => `CVE-2026-${String(10000 + i)}`).join(' ');
    expect(extractCveIds(text)).toHaveLength(50);
  });
});
