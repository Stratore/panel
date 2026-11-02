import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SafeFetchError } from './errors.js';
import { createDefaultDeps, createSafeFetch, safeFetch, type SafeFetchDeps } from './fetch.js';
import { isPublicAddress } from './ip.js';

/**
 * A real HTTP server on 127.0.0.1. Test deps map fake hostnames to it and allow exactly that
 * address: every other private address stays blocked, so redirects to internal targets still fail.
 */
let server: Server;
let port: number;
let seen: { url: string; headers: IncomingHttpHeaders }[] = [];

const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title></channel></rss>';

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    const url = new URL(req.url ?? '/', 'http://x');
    const xml = { 'content-type': 'application/rss+xml; charset=utf-8' };
    switch (url.pathname) {
      case '/feed':
        res.writeHead(200, xml).end(RSS);
        return;
      case '/latin1':
        res
          .writeHead(200, { 'content-type': 'text/xml; charset=iso-8859-1' })
          .end(Buffer.from([0x63, 0x61, 0x66, 0xe9]));
        return;
      case '/html':
        res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
        return;
      case '/no-type':
        res.writeHead(200).end('x');
        return;
      case '/not-modified':
        res.writeHead(304, { etag: '"v1"' }).end();
        return;
      case '/rate-limited':
        res.writeHead(429, { 'retry-after': '120', 'content-type': 'text/html' }).end('slow down');
        return;
      case '/redirect': {
        const to = url.searchParams.get('to') ?? '/feed';
        res.writeHead(302, { location: to }).end();
        return;
      }
      case '/redirect-empty':
        res.writeHead(301).end();
        return;
      case '/chain': {
        const n = Number(url.searchParams.get('n') ?? '0');
        res.writeHead(302, { location: n > 0 ? `/chain?n=${String(n - 1)}` : '/feed' }).end();
        return;
      }
      case '/big-chunked': {
        res.writeHead(200, xml);
        const chunk = Buffer.alloc(64 * 1024, 0x61);
        let sent = 0;
        const pump = () => {
          while (sent < 50 * 1024 * 1024) {
            sent += chunk.length;
            if (!res.write(chunk)) {
              res.once('drain', pump);
              return;
            }
          }
          res.end();
        };
        res.on('close', () => {
          sent = Infinity;
        });
        pump();
        return;
      }
      case '/big-declared':
        res
          .writeHead(200, { ...xml, 'content-length': String(3 * 1024 * 1024) })
          .end(Buffer.alloc(3 * 1024 * 1024));
        return;
      case '/size': {
        const bytes = Number(url.searchParams.get('bytes'));
        res.writeHead(200, xml).end(Buffer.alloc(bytes, 0x61));
        return;
      }
      case '/gzip':
        res.writeHead(200, { ...xml, 'content-encoding': 'gzip' }).end(gzipSync(RSS));
        return;
      case '/br':
        res.writeHead(200, { ...xml, 'content-encoding': 'br' }).end(brotliCompressSync(RSS));
        return;
      case '/gzip-bomb':
        res
          .writeHead(200, { ...xml, 'content-encoding': 'gzip' })
          .end(gzipSync(Buffer.alloc(50 * 1024 * 1024)));
        return;
      case '/weird-encoding':
        res.writeHead(200, { ...xml, 'content-encoding': 'compress' }).end('x');
        return;
      case '/hang':
        return; // never responds
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  seen = [];
});

const HOSTS: Record<string, string> = {
  'feed.test': '127.0.0.1',
  'other.test': '127.0.0.1',
  'internal.test': '10.0.0.5',
  'metadata.test': '169.254.169.254',
};

function testDeps(overrides: Partial<SafeFetchDeps> = {}): SafeFetchDeps {
  return {
    resolveHost: vi.fn((hostname: string) => {
      const address = HOSTS[hostname] ?? hostname;
      return Promise.resolve([{ address, family: address.includes(':') ? 6 : 4 }]);
    }),
    isAllowedAddress: (ip) => ip === '127.0.0.1' || isPublicAddress(ip),
    allowedPorts: new Set([80, 443, port]),
    ...overrides,
  };
}

const base = () => `http://feed.test:${String(port)}`;
const httpDefault = { trust: 'default', allowHttp: true } as const;

async function expectCode(promise: Promise<unknown>, code: string): Promise<SafeFetchError> {
  const error = await promise.then(
    () => {
      throw new Error(`Expected ${code}`);
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SafeFetchError);
  expect((error as SafeFetchError).code).toBe(code);
  return error as SafeFetchError;
}

describe('safeFetch: happy path', () => {
  it('fetches through the pinned address and preserves the Host header', async () => {
    const fetcher = createSafeFetch(testDeps());
    const res = await fetcher(`${base()}/feed`, httpDefault);
    expect(res.status).toBe(200);
    expect(res.body).toBe(RSS);
    expect(res.bytes).toBe(RSS.length);
    expect(res.url).toBe(`${base()}/feed`);
    expect(seen[0]?.headers.host).toBe(`feed.test:${String(port)}`);
    expect(seen[0]?.headers['user-agent']).toMatch(/^Panel/);
  });

  it('sends caller headers', async () => {
    const fetcher = createSafeFetch(testDeps());
    await fetcher(`${base()}/feed`, {
      ...httpDefault,
      headers: { 'If-None-Match': '"v1"', apiKey: 'k' },
    });
    expect(seen[0]?.headers['if-none-match']).toBe('"v1"');
    expect(seen[0]?.headers['apikey']).toBe('k');
  });

  it('decodes gzip and brotli', async () => {
    const fetcher = createSafeFetch(testDeps());
    expect((await fetcher(`${base()}/gzip`, httpDefault)).body).toBe(RSS);
    expect((await fetcher(`${base()}/br`, httpDefault)).body).toBe(RSS);
  });

  it('honours the declared charset', async () => {
    const fetcher = createSafeFetch(testDeps());
    expect((await fetcher(`${base()}/latin1`, httpDefault)).body).toBe('café');
  });

  it('returns 304 and error statuses without a body', async () => {
    const fetcher = createSafeFetch(testDeps());
    const notModified = await fetcher(`${base()}/not-modified`, httpDefault);
    expect(notModified).toMatchObject({ status: 304, body: '', bytes: 0 });
    const limited = await fetcher(`${base()}/rate-limited`, httpDefault);
    expect(limited).toMatchObject({ status: 429, body: '' });
    expect(limited.headers['retry-after']).toBe('120');
  });
});

describe('safeFetch: URL policy (no network)', () => {
  const deps = testDeps();
  const fetcher = createSafeFetch(deps);

  it.each([
    ['ftp://feed.test/', 'PROTOCOL_NOT_ALLOWED'],
    ['javascript:alert(1)', 'PROTOCOL_NOT_ALLOWED'],
    ['file:///etc/passwd', 'PROTOCOL_NOT_ALLOWED'],
    ['https://user:pass@feed.test/', 'CREDENTIALS_IN_URL'],
    ['https://feed.test:8443/', 'PORT_NOT_ALLOWED'],
    ['not a url', 'INVALID_URL'],
    [`https://feed.test/${'a'.repeat(2048)}`, 'URL_TOO_LONG'],
  ])('rejects %s', async (url, code) => {
    await expectCode(fetcher(url, { trust: 'default' }), code);
    expect(deps.resolveHost).not.toHaveBeenCalled();
  });

  it('never allows plain http for custom sources', async () => {
    await expectCode(
      fetcher(`${base()}/feed`, { trust: 'custom', allowHttp: true }),
      'PROTOCOL_NOT_ALLOWED',
    );
    await expectCode(fetcher(`${base()}/feed`), 'PROTOCOL_NOT_ALLOWED');
  });
});

describe('safeFetch: SSRF protections', () => {
  it.each([
    'https://127.0.0.1/',
    'https://localhost/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://0x7f000001/',
    'https://2130706433/',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.1/',
    'https://100.100.100.100/',
  ])('production safeFetch blocks %s', async (url) => {
    await expectCode(safeFetch(url), 'BLOCKED_ADDRESS');
  });

  it('blocks a hostname resolving to a private address', async () => {
    const deps = {
      ...createDefaultDeps(),
      resolveHost: () => Promise.resolve([{ address: '192.168.1.1', family: 4 }]),
    };
    await expectCode(createSafeFetch(deps)('https://evil.example/'), 'BLOCKED_ADDRESS');
  });

  it('blocks when any one of several records is private', async () => {
    const deps = testDeps({
      resolveHost: () =>
        Promise.resolve([
          { address: '127.0.0.1', family: 4 },
          { address: '10.0.0.1', family: 4 },
        ]),
    });
    await expectCode(createSafeFetch(deps)(`${base()}/feed`, httpDefault), 'BLOCKED_ADDRESS');
  });

  it('pins the connection to the checked address (DNS rebinding)', async () => {
    let calls = 0;
    const deps = testDeps({
      // First answer is allowed; a rebinding server would answer 10.0.0.5 on the next query.
      resolveHost: () =>
        Promise.resolve([{ address: calls++ === 0 ? '127.0.0.1' : '10.0.0.5', family: 4 }]),
    });
    const res = await createSafeFetch(deps)(`${base()}/feed`, httpDefault);
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  it.each([
    ['http://internal.test/', 'private host'],
    ['http://metadata.test/latest', 'metadata host'],
    ['http://169.254.169.254/latest', 'metadata IP'],
    ['http://[::ffff:10.0.0.1]/', 'mapped IPv6'],
  ])('revalidates redirects: %s (%s)', async (target) => {
    const fetcher = createSafeFetch(testDeps());
    await expectCode(
      fetcher(`${base()}/redirect?to=${encodeURIComponent(target)}`, httpDefault),
      'BLOCKED_ADDRESS',
    );
  });

  it('refuses redirects to forbidden protocols and ports', async () => {
    const fetcher = createSafeFetch(testDeps());
    await expectCode(
      fetcher(`${base()}/redirect?to=${encodeURIComponent('ftp://feed.test/')}`, httpDefault),
      'PROTOCOL_NOT_ALLOWED',
    );
    await expectCode(
      fetcher(`${base()}/redirect?to=${encodeURIComponent('http://feed.test:6379/')}`, httpDefault),
      'PORT_NOT_ALLOWED',
    );
  });

  it('follows up to 3 redirects and refuses the 4th', async () => {
    const fetcher = createSafeFetch(testDeps());
    const ok = await fetcher(`${base()}/chain?n=2`, httpDefault);
    expect(ok).toMatchObject({ status: 200, redirects: 3, url: `${base()}/feed` });
    await expectCode(fetcher(`${base()}/chain?n=3`, httpDefault), 'TOO_MANY_REDIRECTS');
  });

  it('rejects a redirect without Location', async () => {
    await expectCode(
      createSafeFetch(testDeps())(`${base()}/redirect-empty`, httpDefault),
      'BAD_REDIRECT',
    );
  });

  it('drops credentials on cross-origin redirects only', async () => {
    const fetcher = createSafeFetch(testDeps());
    const headers = { apiKey: 'secret', authorization: 'token t' };
    await fetcher(`${base()}/redirect?to=/feed`, { ...httpDefault, headers });
    expect(seen[1]?.headers['apikey']).toBe('secret');

    seen = [];
    const other = `http://other.test:${String(port)}/feed`;
    await fetcher(`${base()}/redirect?to=${encodeURIComponent(other)}`, {
      ...httpDefault,
      headers,
    });
    expect(seen[1]?.headers.host).toBe(`other.test:${String(port)}`);
    expect(seen[1]?.headers['apikey']).toBeUndefined();
    expect(seen[1]?.headers.authorization).toBeUndefined();
    expect(seen[1]?.headers['user-agent']).toMatch(/^Panel/);
  });
});

describe('safeFetch: resource limits', () => {
  it('aborts an endless chunked body at the size limit', async () => {
    const started = performance.now();
    await expectCode(
      createSafeFetch(testDeps())(`${base()}/big-chunked`, {
        ...httpDefault,
        maxBytes: 1024 * 1024,
      }),
      'TOO_LARGE',
    );
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('rejects a declared Content-Length above the limit before reading', async () => {
    await expectCode(
      createSafeFetch(testDeps())(`${base()}/big-declared`, {
        ...httpDefault,
        maxBytes: 1024 * 1024,
      }),
      'TOO_LARGE',
    );
  });

  it('measures size after decompression (gzip bomb)', async () => {
    await expectCode(createSafeFetch(testDeps())(`${base()}/gzip-bomb`, httpDefault), 'TOO_LARGE');
  });

  it('cannot raise the size cap above the trust limit', async () => {
    const fetcher = createSafeFetch(testDeps());
    const fourMb = 4 * 1024 * 1024;
    expect((await fetcher(`${base()}/size?bytes=${String(fourMb)}`, httpDefault)).bytes).toBe(
      fourMb,
    );
    await expectCode(
      fetcher(`${base()}/size?bytes=${String(6 * 1024 * 1024)}`, {
        ...httpDefault,
        maxBytes: 100 * 1024 * 1024,
      }),
      'TOO_LARGE',
    );
  });

  it('rejects unknown content encodings', async () => {
    await expectCode(
      createSafeFetch(testDeps())(`${base()}/weird-encoding`, httpDefault),
      'UNSUPPORTED_ENCODING',
    );
  });

  it.each(['/html', '/no-type'])('rejects disallowed content types (%s)', async (path) => {
    await expectCode(
      createSafeFetch(testDeps())(`${base()}${path}`, httpDefault),
      'CONTENT_TYPE_NOT_ALLOWED',
    );
  });

  it('times out a server that never answers', async () => {
    await expectCode(
      createSafeFetch(testDeps())(`${base()}/hang`, { ...httpDefault, timeoutMs: 300 }),
      'TIMEOUT',
    );
  });

  it('honours the caller abort signal', async () => {
    const controller = new AbortController();
    const pending = createSafeFetch(testDeps())(`${base()}/hang`, {
      ...httpDefault,
      signal: controller.signal,
    });
    setTimeout(() => {
      controller.abort();
    }, 50);
    await expectCode(pending, 'TIMEOUT');
  });

  it('reports DNS failures', async () => {
    const deps = testDeps({ resolveHost: () => Promise.reject(new Error('ENOTFOUND')) });
    await expectCode(createSafeFetch(deps)(`${base()}/feed`, httpDefault), 'DNS_FAILURE');
    const empty = testDeps({ resolveHost: () => Promise.resolve([]) });
    await expectCode(createSafeFetch(empty)(`${base()}/feed`, httpDefault), 'DNS_FAILURE');
  });
});
