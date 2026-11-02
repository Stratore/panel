import { SafeFetchError } from './errors.js';

export const MAX_URL_LENGTH = 2048;
export const DEFAULT_ALLOWED_PORTS: ReadonlySet<number> = new Set([80, 443]);

export interface UrlPolicy {
  /** Plain http is only ever allowed for default sources that require it, never custom ones. */
  allowHttp: boolean;
  allowedPorts: ReadonlySet<number>;
}

/** Static checks performed before any network activity, and again on every redirect hop. */
export function validateTargetUrl(input: string | URL, policy: UrlPolicy): URL {
  const raw = typeof input === 'string' ? input : input.href;
  if (raw.length > MAX_URL_LENGTH) {
    throw new SafeFetchError('URL_TOO_LONG', `URL exceeds ${String(MAX_URL_LENGTH)} characters`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new SafeFetchError('INVALID_URL', 'URL could not be parsed', { cause });
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && policy.allowHttp)) {
    throw new SafeFetchError('PROTOCOL_NOT_ALLOWED', `Protocol ${url.protocol} is not allowed`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new SafeFetchError('CREDENTIALS_IN_URL', 'Credentials in URLs are not allowed');
  }
  if (url.hostname === '') throw new SafeFetchError('INVALID_URL', 'URL has no host');
  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!policy.allowedPorts.has(port)) {
    throw new SafeFetchError('PORT_NOT_ALLOWED', `Port ${String(port)} is not allowed`);
  }
  return url;
}

/** Hostname as given to DNS: IPv6 literals lose their brackets. */
export function hostForLookup(url: URL): string {
  const { hostname } = url;
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}
