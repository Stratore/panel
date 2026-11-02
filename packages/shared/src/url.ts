import { LIMITS } from './constants.js';

const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'ref']);

/**
 * Canonical form used for strict dedupe (SPEC § 7.2): lowercase scheme and host, tracking
 * parameters (`utm_*`, `fbclid`, `gclid`, `ref`), fragment and trailing slash removed.
 * The path keeps its case (RFC 3986: paths are case-sensitive; see ADR-010).
 * Returns null for anything that is not a credential-free http(s) URL.
 */
export function canonicalizeUrl(input: string): string | null {
  if (input.length > LIMITS.urlLength) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) url.searchParams.delete(key);
  }
  // URL already lowercases scheme and host and drops default ports.
  let canonical = url.toString();
  if (url.search === '' && canonical.endsWith('/')) canonical = canonical.slice(0, -1);
  return canonical;
}

/** True for absolute http(s) URLs: the only links the UI is allowed to render (SPEC § 9.2). */
export function isSafeHttpUrl(input: string): boolean {
  try {
    const { protocol } = new URL(input);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
