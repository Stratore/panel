import { describe, expect, it } from 'vitest';
import { watchlistEntrySchema } from './schemas.js';
import { cpeMatches, DEFAULT_WATCHLIST, matchWatchlist } from './watchlist.js';

describe('DEFAULT_WATCHLIST', () => {
  it('contains the nine default entries, all valid', () => {
    expect(DEFAULT_WATCHLIST.map((e) => e.label)).toEqual([
      'PHP',
      'Node.js',
      'Python',
      'Linux',
      'Docker',
      'OpenSSH',
      'WordPress',
      'Browsers',
      'Routers',
    ]);
    for (const entry of DEFAULT_WATCHLIST)
      expect(() => watchlistEntrySchema.parse(entry)).not.toThrow();
  });
});

describe('cpeMatches', () => {
  it('matches a vendor:product prefix and wildcards', () => {
    expect(cpeMatches('cpe:2.3:a:php:php', 'cpe:2.3:a:php:php:8.2.1:*:*:*:*:*:*:*')).toBe(true);
    expect(cpeMatches('cpe:2.3:a:*:php', 'cpe:2.3:a:php:php:8.2.1')).toBe(true);
    expect(cpeMatches('cpe:2.3:a:php:php', 'cpe:2.3:a:php:phpmyadmin:5.0')).toBe(false);
    expect(cpeMatches('cpe:2.3:a:php:php:8.2.1:x', 'cpe:2.3:a:php:php')).toBe(false);
  });
});

describe('matchWatchlist', () => {
  it('matches keywords as whole words', () => {
    expect(matchWatchlist(DEFAULT_WATCHLIST, { text: 'Critical flaw in OpenSSH sshd' })).toEqual([
      'OpenSSH',
    ]);
    expect(matchWatchlist(DEFAULT_WATCHLIST, { text: 'A new npm package for Node.js' })).toEqual([
      'Node.js',
    ]);
    expect(matchWatchlist(DEFAULT_WATCHLIST, { text: 'phpMyAdmin release' })).toEqual([]);
  });

  it('matches CPE configurations', () => {
    expect(
      matchWatchlist(DEFAULT_WATCHLIST, {
        text: 'Out-of-bounds write',
        cpes: ['cpe:2.3:o:linux:linux_kernel:6.1'],
      }),
    ).toEqual(['Linux']);
  });

  it('skips disabled entries', () => {
    const disabled = DEFAULT_WATCHLIST.map((e) => ({ ...e, enabled: false }));
    expect(matchWatchlist(disabled, { text: 'PHP' })).toEqual([]);
  });
});
