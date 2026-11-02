import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, isSafeHttpUrl } from './url.js';

describe('canonicalizeUrl', () => {
  it.each([
    ['HTTPS://Example.COM/News/Item/', 'https://example.com/News/Item'],
    ['https://example.com/a?utm_source=x&utm_MEDIUM=y&id=3', 'https://example.com/a?id=3'],
    ['https://example.com/a?fbclid=1&gclid=2&ref=hn', 'https://example.com/a'],
    ['https://example.com/a#section', 'https://example.com/a'],
    ['https://example.com:443/a', 'https://example.com/a'],
    ['https://example.com/', 'https://example.com'],
    ['  https://example.com/a  ', 'https://example.com/a'],
    ['http://example.com/a/?b=1', 'http://example.com/a/?b=1'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalizeUrl(input)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>',
    'ftp://example.com/file',
    'https://user:pass@example.com/',
    'not a url',
    `https://example.com/${'a'.repeat(2100)}`,
  ])('rejects %s', (input) => {
    expect(canonicalizeUrl(input)).toBeNull();
  });
});

describe('isSafeHttpUrl', () => {
  it('accepts only http(s)', () => {
    expect(isSafeHttpUrl('https://example.com')).toBe(true);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('/relative')).toBe(false);
  });
});
