import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import {
  loadSourcesCatalog,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  type DatabaseHandle,
} from '@panel/db';
import { SafeFetchError, type SafeFetch } from '@panel/safe-fetch';
import { buildApp } from './app.js';
import { CSRF_HEADER } from './http.js';
import { noAlerts, type AlertSender } from './routes/admin.js';

export const SETUP_TOKEN = 'test-setup-token-0123456789';
export const PASSPHRASE = 'correct horse battery staple';
export const SESSION_SECRET = 'x'.repeat(48);

export const FEED_XML =
  '<rss version="2.0"><channel><title>Mine</title>' +
  '<item><title>First &lt;b&gt;post&lt;/b&gt;</title><link>https://mine.example/1</link></item>' +
  '<item><title>Second</title><link>javascript:alert(1)</link></item>' +
  '<item><title>Third</title><link>https://mine.example/3</link></item>' +
  '<item><title>Fourth</title><link>https://mine.example/4</link></item>' +
  '</channel></rss>';

/** Fake network: "blocked" hosts are refused like private IPs, everything else serves a feed. */
export const fakeSafeFetch: SafeFetch = (url) => {
  if (url.includes('blocked'))
    return Promise.reject(
      new SafeFetchError('BLOCKED_ADDRESS', 'resolves to a non-public address'),
    );
  if (url.includes('html'))
    return Promise.reject(
      new SafeFetchError('CONTENT_TYPE_NOT_ALLOWED', 'Content-Type "text/html" is not allowed'),
    );
  if (url.includes('missing')) {
    return Promise.resolve({
      status: 404,
      headers: {},
      body: '',
      url,
      bytes: 0,
      durationMs: 3,
      redirects: 0,
    });
  }
  const body = url.includes('empty') ? '<rss><channel></channel></rss>' : FEED_XML;
  return Promise.resolve({
    status: 200,
    headers: { 'content-type': 'application/rss+xml' },
    body,
    url,
    bytes: body.length,
    durationMs: 12,
    redirects: 0,
  });
};

export interface TestContext {
  app: FastifyInstance;
  handle: DatabaseHandle;
  clock: { now: Date };
  close(): Promise<void>;
}

export async function createTestApp(
  options: { alerts?: AlertSender; now?: Date } = {},
): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'panel-api-'));
  const handle = openDatabase(join(dir, 'panel.db'));
  migrateDatabase(handle.db);
  const catalog = fileURLToPath(new URL('../../../config/sources.default.json', import.meta.url));
  seedDatabase(handle.db, loadSourcesCatalog(catalog));
  const clock = { now: options.now ?? new Date('2026-11-02T21:00:00Z') };
  const app = await buildApp({
    db: handle.db,
    sqlite: handle.sqlite,
    safeFetch: fakeSafeFetch,
    alerts: options.alerts ?? noAlerts({ discord: false, telegram: false }),
    sessionSecret: SESSION_SECRET,
    setupToken: SETUP_TOKEN,
    logLevel: process.env['TEST_LOG_LEVEL'] ?? 'silent',
    now: () => clock.now,
    authDelay: () => Promise.resolve(),
  });
  return {
    app,
    handle,
    clock,
    async close() {
      await app.close();
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  cookie?: string | undefined;
  csrf?: boolean;
  headers?: Record<string, string>;
  body?: unknown;
}

export function request(
  app: FastifyInstance,
  method: Method,
  url: string,
  options: RequestOptions = {},
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.cookie !== undefined) headers['cookie'] = options.cookie;
  if (method !== 'GET' && options.csrf !== false) headers[CSRF_HEADER] = '1';
  return app.inject({
    method,
    url,
    headers,
    ...(options.body === undefined ? {} : { payload: options.body as Record<string, unknown> }),
  });
}

export const sessionCookie = (response: LightMyRequestResponse): string | undefined => {
  const cookie = response.cookies.find((c) => c.name === '__Host-panel_sid');
  return cookie ? `${cookie.name}=${cookie.value}` : undefined;
};

/** Runs setup and returns the authenticated cookie. */
export async function setupAndLogin(app: FastifyInstance): Promise<string> {
  const response = await request(app, 'POST', '/api/auth/setup', {
    body: { token: SETUP_TOKEN, passphrase: PASSPHRASE, displayName: 'Pierre', lang: 'fr' },
  });
  const cookie = sessionCookie(response);
  if (response.statusCode !== 201 || cookie === undefined)
    throw new Error(`setup failed: ${response.body}`);
  return cookie;
}
