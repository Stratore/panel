import { describe, expect, it } from 'vitest';
import { cspHeader, SECURITY_HEADERS, TRUSTED_TYPES_POLICY } from './csp.js';

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
