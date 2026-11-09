import { describe, expect, it } from 'vitest';
import { caddyHeadersSnippet, cspHeader, SECURITY_HEADERS, TRUSTED_TYPES_POLICY } from './csp.js';

describe('CSP', () => {
  const csp = cspHeader();

  it('matches SPEC § 9.2, with the single Trusted Types policy of ADR-030', () => {
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      'upgrade-insecure-requests',
      "require-trusted-types-for 'script'",
      `trusted-types ${TRUSTED_TYPES_POLICY}`,
    ]) {
      expect(csp).toContain(directive);
    }
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('ships the other security headers', () => {
    expect(SECURITY_HEADERS).toMatchObject({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    });
  });
});

describe('Caddy snippet', () => {
  it('contains every security header, quoted, and removes the Server header', () => {
    const snippet = caddyHeadersSnippet();
    expect(snippet.startsWith('# Generated')).toBe(true);
    expect(snippet).toContain('(security_headers) {');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(snippet).toContain(`\t\t${name} "${value}"`);
    }
    expect(snippet).toContain('\t\t-Server');
  });

  it('refuses values that would break out of the Caddyfile string', () => {
    expect(() => caddyHeadersSnippet({ 'X-Test': 'a" }\nimport evil' })).toThrow();
    expect(() => caddyHeadersSnippet({ 'X Bad': 'v' })).toThrow();
  });
});
