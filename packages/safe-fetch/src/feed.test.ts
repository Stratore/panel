import { describe, expect, it } from 'vitest';
import { asArray, MAX_FEED_ITEMS, parseFeed, textOf } from './feed.js';

const BASE = 'https://feed.example.com/rss';

describe('parseFeed', () => {
  it('detects RSS, Atom and RDF', () => {
    expect(
      parseFeed('<rss><channel><item><title>a</title></item></channel></rss>', BASE).format,
    ).toBe('rss');
    expect(parseFeed('<feed><entry><title>a</title></entry></feed>', BASE).format).toBe('atom');
    expect(parseFeed('<rdf:RDF><item><title>a</title></item></rdf:RDF>', BASE).format).toBe('rdf');
    expect(parseFeed('<html><body/></html>', BASE)).toEqual({ format: null, entries: [] });
  });

  it('resolves relative links and prefers rel=alternate', () => {
    const { entries } = parseFeed(
      '<feed><entry><title>a</title><link rel="enclosure" href="/file.tgz"/><link href="/post"/></entry></feed>',
      BASE,
    );
    expect(entries[0]?.link).toBe('https://feed.example.com/post');
  });

  it('cleans author names and caps the number of entries', () => {
    const items = Array.from(
      { length: 500 },
      (_, i) => `<item><title>${String(i)}</title><author>&lt;b&gt;Ann&lt;/b&gt;</author></item>`,
    ).join('');
    const { entries } = parseFeed(`<rss><channel>${items}</channel></rss>`, BASE);
    expect(entries).toHaveLength(MAX_FEED_ITEMS);
    expect(entries[0]?.author).toBe('Ann');
  });

  it('rejects DTDs through the safe XML parser', () => {
    expect(() => parseFeed('<!DOCTYPE x [<!ENTITY a "b">]><rss/>', BASE)).toThrow();
  });
});

describe('helpers', () => {
  it('normalizes nodes and arrays', () => {
    expect(textOf({ '#text': 'x' })).toBe('x');
    expect(textOf(42)).toBe('42');
    expect(textOf(null)).toBe('');
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(1)).toEqual([1]);
    expect(asArray([1, 2])).toEqual([1, 2]);
  });
});
