import { isSafeFetchError, parseFeed, toPlainText, type SafeFetch } from '@panel/safe-fetch';
import { FEED_CHECKS, httpUrlSchema, LIMITS, type SourceValidation } from '@panel/shared';

type CheckId = (typeof FEED_CHECKS)[number];
type Check = SourceValidation['checks'][number];

/** Which check a safeFetch refusal belongs to. */
const CODE_TO_CHECK: Readonly<Record<string, CheckId>> = {
  INVALID_URL: 'https',
  URL_TOO_LONG: 'https',
  PROTOCOL_NOT_ALLOWED: 'https',
  CREDENTIALS_IN_URL: 'https',
  PORT_NOT_ALLOWED: 'https',
  BLOCKED_ADDRESS: 'public_address',
  DNS_FAILURE: 'reachable',
  TIMEOUT: 'reachable',
  NETWORK_ERROR: 'reachable',
  TOO_MANY_REDIRECTS: 'reachable',
  BAD_REDIRECT: 'reachable',
  CONTENT_TYPE_NOT_ALLOWED: 'content_type',
  UNSUPPORTED_ENCODING: 'content_type',
  TOO_LARGE: 'size',
  XML_FORBIDDEN_DECLARATION: 'valid_feed',
  XML_INVALID: 'valid_feed',
};

const kb = (bytes: number) => `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;

/**
 * "Test feed" (SPEC § 4.3 D, § 8 /sources/validate): fetches a user URL with the strictest
 * safeFetch policy and reports, check by check, what actually passed, plus a 3-item preview.
 * Checks after the first failure are reported as not run.
 */
export async function validateFeed(safeFetch: SafeFetch, url: string): Promise<SourceValidation> {
  const results = new Map<CheckId, Check>();
  const pass = (id: CheckId, detail: string) => results.set(id, { id, ok: true, detail });
  const fail = (id: CheckId, detail: string) => results.set(id, { id, ok: false, detail });
  const report = (extra: Partial<SourceValidation> = {}): SourceValidation => {
    const failedAt = FEED_CHECKS.findIndex((id) => results.get(id)?.ok === false);
    return {
      ok: failedAt === -1 && results.size === FEED_CHECKS.length,
      url,
      checks: FEED_CHECKS.map(
        (id, index) =>
          results.get(id) ?? {
            id,
            ok: failedAt !== -1 && index < failedAt,
            detail: failedAt !== -1 && index < failedAt ? 'Passed' : 'Not checked',
          },
      ),
      format: null,
      itemCount: 0,
      bytes: 0,
      durationMs: 0,
      preview: [],
      ...extra,
    };
  };

  let response;
  try {
    response = await safeFetch(url, { trust: 'custom' });
  } catch (error) {
    if (isSafeFetchError(error)) {
      const check = Object.hasOwn(CODE_TO_CHECK, error.code)
        ? CODE_TO_CHECK[error.code]
        : undefined;
      fail(check ?? 'reachable', error.message);
      return report();
    }
    fail('reachable', 'The feed could not be fetched.');
    return report();
  }

  pass('https', 'HTTPS only');
  pass('public_address', 'Public IP, private ranges blocked');
  if (response.status < 200 || response.status >= 300) {
    fail('reachable', `HTTP ${String(response.status)}`);
    return report({ durationMs: response.durationMs });
  }
  pass('reachable', `HTTP ${String(response.status)}`);
  pass('content_type', response.headers['content-type']?.split(';')[0] ?? 'unknown');
  pass('size', `${kb(response.bytes)} in ${String(response.durationMs)} ms`);

  const meta = { bytes: response.bytes, durationMs: response.durationMs };
  let parsed;
  try {
    parsed = parseFeed(response.body, response.url);
  } catch (error) {
    fail('valid_feed', isSafeFetchError(error) ? error.message : 'Not a valid feed.');
    return report(meta);
  }
  if (parsed.format === null || parsed.entries.length === 0) {
    fail(
      'valid_feed',
      parsed.format === null ? 'Not an RSS or Atom feed.' : 'The feed has no items.',
    );
    return report({ ...meta, format: parsed.format });
  }
  const label = { rss: 'RSS 2.0', atom: 'Atom', rdf: 'RSS 1.0' }[parsed.format];
  pass('valid_feed', `Valid ${label} · ${String(parsed.entries.length)} items`);
  return report({
    ...meta,
    format: parsed.format,
    itemCount: parsed.entries.length,
    preview: parsed.entries.slice(0, 3).map((entry) => ({
      title: toPlainText(entry.title, LIMITS.titleLength),
      url: httpUrlSchema.safeParse(entry.link).success ? entry.link : null,
    })),
  });
}
