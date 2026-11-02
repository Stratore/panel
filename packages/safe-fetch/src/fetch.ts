import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import type { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { Agent, request } from 'undici';
import { SafeFetchError } from './errors.js';
import { isPublicAddress, parseCidrList, type ParsedCidr } from './ip.js';
import { DEFAULT_ALLOWED_PORTS, hostForLookup, validateTargetUrl } from './url.js';

/** Limits from SPEC § 9.3. */
export const SAFE_FETCH_LIMITS = {
  connectTimeoutMs: 5_000,
  totalTimeoutMs: 10_000,
  maxBytesDefault: 5 * 1024 * 1024,
  maxBytesCustom: 2 * 1024 * 1024,
  maxRedirects: 3,
} as const;

export const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'text/xml',
  'application/json',
  'application/feed+json',
  'text/plain',
]);

export const DEFAULT_USER_AGENT = 'Panel (+https://github.com/Stratore/panel)';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Headers that may follow a redirect to another origin; credentials (apiKey, Authorization…) never do. */
const CROSS_ORIGIN_SAFE_HEADERS = new Set([
  'accept',
  'user-agent',
  'if-none-match',
  'if-modified-since',
]);

export interface SafeFetchOptions {
  /**
   * `custom`: user-supplied source, strictest policy (https only, 2 MB).
   * `default`: built-in catalog source (5 MB; plain http only with `allowHttp`).
   * Defaults to `custom`.
   */
  trust?: 'default' | 'custom';
  allowHttp?: boolean;
  headers?: Readonly<Record<string, string>>;
  /** Lowers the size cap; can never raise it above the trust level's limit. */
  maxBytes?: number;
  /** Lowers the total timeout; can never raise it above 10 s. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SafeFetchResponse {
  status: number;
  /** Lowercased header names. */
  headers: Readonly<Record<string, string>>;
  /** Decoded body for 2xx responses; empty for 304 and errors. */
  body: string;
  /** Final URL after redirects. */
  url: string;
  /** Decompressed body size in bytes. */
  bytes: number;
  durationMs: number;
  redirects: number;
}

export type ResolveHost = (hostname: string) => Promise<readonly LookupAddress[]>;

/** Injection points. Production code uses `safeFetch`; tests use them to target a local server. */
export interface SafeFetchDeps {
  resolveHost: ResolveHost;
  isAllowedAddress: (ip: string) => boolean;
  allowedPorts: ReadonlySet<number>;
}

export type SafeFetch = (url: string, options?: SafeFetchOptions) => Promise<SafeFetchResponse>;

const defaultResolveHost: ResolveHost = (hostname) =>
  dnsLookup(hostname, { all: true, order: 'verbatim' });

/** Extra blocked ranges from the environment, e.g. the Docker network: `SAFE_FETCH_BLOCKED_CIDRS=172.30.0.0/16`. */
export function createDefaultDeps(extraBlocked: readonly ParsedCidr[] = []): SafeFetchDeps {
  return {
    resolveHost: defaultResolveHost,
    isAllowedAddress: (ip) => isPublicAddress(ip, extraBlocked),
    allowedPorts: DEFAULT_ALLOWED_PORTS,
  };
}

/** Resolves once and returns the validated address to pin the connection to (anti DNS-rebinding). */
async function resolvePinned(url: URL, deps: SafeFetchDeps): Promise<LookupAddress> {
  const host = hostForLookup(url);
  let addresses: readonly LookupAddress[];
  try {
    addresses = await deps.resolveHost(host);
  } catch (cause) {
    throw new SafeFetchError('DNS_FAILURE', `Could not resolve ${host}`, { cause });
  }
  const [first] = addresses;
  if (!first) throw new SafeFetchError('DNS_FAILURE', `No address for ${host}`);
  // One bad record is enough to refuse: an attacker controls which record a client picks.
  if (!addresses.every((a) => deps.isAllowedAddress(a.address))) {
    throw new SafeFetchError('BLOCKED_ADDRESS', `${host} resolves to a non-public address`);
  }
  return first;
}

/** A single-use agent whose DNS lookup always returns the pinned, already-checked address. */
function pinnedAgent(pinned: LookupAddress): Agent {
  return new Agent({
    connections: 1,
    headersTimeout: SAFE_FETCH_LIMITS.totalTimeoutMs,
    bodyTimeout: SAFE_FETCH_LIMITS.totalTimeoutMs,
    connect: {
      timeout: SAFE_FETCH_LIMITS.connectTimeoutMs,
      lookup: ((_hostname, options, callback) => {
        if (options.all) callback(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      }) satisfies LookupFunction,
    },
  });
}

function flattenHeaders(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

function decoderFor(encoding: string): Transform {
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return createGunzip();
    case 'deflate':
      return createInflate();
    case 'br':
      return createBrotliDecompress();
    default:
      throw new SafeFetchError('UNSUPPORTED_ENCODING', `Unsupported content-encoding ${encoding}`);
  }
}

/** Streams the body through decompression, aborting as soon as the decompressed size passes `maxBytes`. */
async function readLimited(
  body: Readable,
  contentEncoding: string | undefined,
  maxBytes: number,
): Promise<Buffer> {
  const encodings = (contentEncoding ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '' && e !== 'identity');
  if (encodings.length > 2) {
    throw new SafeFetchError('UNSUPPORTED_ENCODING', 'Too many content-encodings');
  }
  // Encodings are listed in the order applied, so they are undone in reverse.
  const decoders = encodings.reverse().map(decoderFor);
  const chunks: Buffer[] = [];
  let total = 0;
  await pipeline([
    body,
    ...decoders,
    async (source: AsyncIterable<Buffer>) => {
      for await (const chunk of source) {
        total += chunk.length;
        if (total > maxBytes) {
          throw new SafeFetchError('TOO_LARGE', `Body exceeds ${String(maxBytes)} bytes`);
        }
        chunks.push(chunk);
      }
    },
  ]);
  return Buffer.concat(chunks, total);
}

function mediaType(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function decodeText(buffer: Buffer, contentType: string | undefined): string {
  const charset = /charset="?([\w-]{1,40})"?/i.exec(contentType ?? '')?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function toSafeFetchError(error: unknown, signal: AbortSignal): SafeFetchError {
  if (error instanceof SafeFetchError) return error;
  if (signal.aborted)
    return new SafeFetchError('TIMEOUT', 'Request timed out or was aborted', { cause: error });
  const code = (error as { code?: unknown } | null)?.code;
  if (
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  ) {
    return new SafeFetchError('TIMEOUT', 'Request timed out', { cause: error });
  }
  return new SafeFetchError('NETWORK_ERROR', 'Network error', { cause: error });
}

export function createSafeFetch(deps: SafeFetchDeps): SafeFetch {
  return async function safeFetch(input, options = {}) {
    const started = performance.now();
    const trust = options.trust ?? 'custom';
    const policy = {
      allowHttp: trust === 'default' && options.allowHttp === true,
      allowedPorts: deps.allowedPorts,
    };
    const trustLimit =
      trust === 'custom' ? SAFE_FETCH_LIMITS.maxBytesCustom : SAFE_FETCH_LIMITS.maxBytesDefault;
    const maxBytes = Math.min(options.maxBytes ?? trustLimit, trustLimit);
    const timeoutMs = Math.min(
      options.timeoutMs ?? SAFE_FETCH_LIMITS.totalTimeoutMs,
      SAFE_FETCH_LIMITS.totalTimeoutMs,
    );
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeoutMs),
      ...(options.signal ? [options.signal] : []),
    ]);

    const initialUrl = validateTargetUrl(input, policy);
    let url = initialUrl;
    let headers: Record<string, string> = {
      'user-agent': DEFAULT_USER_AGENT,
      accept: [...ALLOWED_CONTENT_TYPES].join(', '),
      'accept-encoding': 'gzip, deflate, br',
    };
    for (const [name, value] of Object.entries(options.headers ?? {}))
      headers[name.toLowerCase()] = value;

    for (let redirects = 0; ; redirects++) {
      const pinned = await resolvePinned(url, deps);
      const agent = pinnedAgent(pinned);
      try {
        const response = await request(url, { method: 'GET', headers, dispatcher: agent, signal });
        const responseHeaders = flattenHeaders(response.headers);

        if (REDIRECT_STATUSES.has(response.statusCode)) {
          await response.body.dump();
          if (redirects >= SAFE_FETCH_LIMITS.maxRedirects) {
            throw new SafeFetchError('TOO_MANY_REDIRECTS', 'Too many redirects');
          }
          const location = responseHeaders['location'];
          if (location === undefined || location === '') {
            throw new SafeFetchError('BAD_REDIRECT', 'Redirect without a Location header');
          }
          let next: URL;
          try {
            next = new URL(location, url);
          } catch (cause) {
            throw new SafeFetchError('BAD_REDIRECT', 'Invalid redirect target', { cause });
          }
          url = validateTargetUrl(next, policy);
          if (url.origin !== initialUrl.origin) {
            headers = Object.fromEntries(
              Object.entries(headers).filter(
                ([name]) => CROSS_ORIGIN_SAFE_HEADERS.has(name) || name === 'accept-encoding',
              ),
            );
          }
          continue;
        }

        const base = {
          status: response.statusCode,
          headers: responseHeaders,
          url: url.href,
          redirects,
        };
        if (response.statusCode < 200 || response.statusCode >= 300) {
          await response.body.dump();
          return {
            ...base,
            body: '',
            bytes: 0,
            durationMs: Math.round(performance.now() - started),
          };
        }

        const type = mediaType(responseHeaders['content-type']);
        if (!ALLOWED_CONTENT_TYPES.has(type)) {
          await response.body.dump();
          throw new SafeFetchError(
            'CONTENT_TYPE_NOT_ALLOWED',
            `Content-Type "${type || 'none'}" is not allowed`,
          );
        }
        const declared = Number(responseHeaders['content-length']);
        if (
          responseHeaders['content-encoding'] === undefined &&
          Number.isFinite(declared) &&
          declared > maxBytes
        ) {
          await response.body.dump();
          throw new SafeFetchError('TOO_LARGE', `Body exceeds ${String(maxBytes)} bytes`);
        }

        const buffer = await readLimited(
          response.body,
          responseHeaders['content-encoding'],
          maxBytes,
        );
        return {
          ...base,
          body: decodeText(buffer, responseHeaders['content-type']),
          bytes: buffer.length,
          durationMs: Math.round(performance.now() - started),
        };
      } catch (error) {
        throw toSafeFetchError(error, signal);
      } finally {
        await agent.destroy();
      }
    }
  };
}

const extraBlocked = (process.env['SAFE_FETCH_BLOCKED_CIDRS'] ?? '')
  .split(',')
  .map((cidr) => cidr.trim())
  .filter((cidr) => cidr !== '');

/**
 * The only way Panel performs outbound HTTP (SPEC § 9.3). GET only. Blocks private and
 * reserved destinations (including after redirects and DNS rebinding), enforces protocol,
 * port, size, content-type and time limits.
 */
export const safeFetch: SafeFetch = createSafeFetch(createDefaultDeps(parseCidrList(extraBlocked)));
