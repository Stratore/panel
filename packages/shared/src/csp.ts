/**
 * Content-Security-Policy of SPEC § 9.2, defined once and served by the API (helmet), the
 * Vite preview server and Caddy. One deviation (ADR-030): instead of `trusted-types 'none'`,
 * a single policy named `panel` may exist — Service Worker registration is a Trusted Types
 * sink and needs it; it only ever accepts the fixed URL `/sw.js`.
 */
export const TRUSTED_TYPES_POLICY = 'panel';

export const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'object-src': ["'none'"],
  'upgrade-insecure-requests': [],
  'require-trusted-types-for': ["'script'"],
  'trusted-types': [TRUSTED_TYPES_POLICY],
};

export function cspHeader(
  directives: Readonly<Record<string, readonly string[]>> = CSP_DIRECTIVES,
): string {
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(' '))
    .join('; ');
}

/** Other response headers of SPEC § 9.2 for static content. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': cspHeader(),
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
