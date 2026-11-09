import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desc, eq } from 'drizzle-orm';
import {
  loadSourcesCatalog,
  migrateDatabase,
  openDatabase,
  schema,
  seedDatabase,
  type DatabaseHandle,
} from '@panel/db';
import {
  SafeFetchError,
  type SafeFetch,
  type SafeFetchOptions,
  type SafeFetchResponse,
} from '@panel/safe-fetch';
import { compileKeywords, DEFAULT_WATCHLIST, keywordsConfigSchema } from '@panel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdapters } from '../adapters/index.js';
import { domainKey, TaskQueue } from './queue.js';
import { HttpStatusError, parseRetryAfter, RETRY, withRetry } from './retry.js';
import { describeError, isCoolingDown, runSource, type RunnerDeps } from './runner.js';
import { intervalOf } from './scheduler.js';

const root = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const RSS = readFileSync(new URL('../adapters/__fixtures__/rss2.xml', import.meta.url), 'utf8');

describe('TaskQueue', () => {
  it('runs one task per key and at most N overall', async () => {
    const queue = new TaskQueue(2);
    const log: string[] = [];
    const releases: (() => void)[] = [];
    const task = (name: string) => () =>
      new Promise<string>((resolve) => {
        log.push(`start ${name}`);
        releases.push(() => {
          log.push(`end ${name}`);
          resolve(name);
        });
      });
    const all = Promise.all([
      queue.run('a.com', task('a1')),
      queue.run('a.com', task('a2')),
      queue.run('b.com', task('b1')),
      queue.run('c.com', task('c1')),
    ]);
    await Promise.resolve();
    expect(log).toEqual(['start a1', 'start b1']);
    expect(queue.size).toEqual({ running: 2, pending: 2 });
    releases.shift()?.();
    await vi.waitFor(() => {
      expect(log).toContain('start a2');
    });
    expect(log).not.toContain('start c1');
    while (releases.length > 0) {
      releases.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    await expect(all).resolves.toEqual(['a1', 'a2', 'b1', 'c1']);
  });

  it('propagates failures and keeps going', async () => {
    const queue = new TaskQueue(1);
    await expect(queue.run('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(queue.run('k', () => Promise.resolve(1))).resolves.toBe(1);
  });

  it('keys by hostname', () => {
    expect(domainKey('https://API.github.com/x')).toBe('api.github.com');
    expect(domainKey('nonsense')).toBe('nonsense');
  });
});

describe('withRetry', () => {
  const deps = () => ({
    sleep: vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve()),
    random: () => 0.5,
  });

  it('retries 429/5xx/timeouts with doubling delays, 3 attempts max', async () => {
    const d = deps();
    const task = vi.fn(() => Promise.reject(new HttpStatusError(503, null)));
    await expect(withRetry(task, d)).rejects.toThrow('HTTP 503');
    expect(task).toHaveBeenCalledTimes(RETRY.maxAttempts);
    expect(d.sleep.mock.calls.map((c) => c[0])).toEqual([2000, 4000]);

    const timeout = vi
      .fn()
      .mockRejectedValueOnce(new SafeFetchError('TIMEOUT', 't'))
      .mockResolvedValueOnce('ok');
    await expect(withRetry(timeout, deps())).resolves.toBe('ok');
  });

  it('honours Retry-After and gives up when it is too long', async () => {
    const d = deps();
    const task = vi
      .fn()
      .mockRejectedValueOnce(new HttpStatusError(429, 30_000))
      .mockResolvedValueOnce('ok');
    await expect(withRetry(task, d)).resolves.toBe('ok');
    expect(d.sleep).toHaveBeenCalledWith(30_000);

    const long = vi.fn(() => Promise.reject(new HttpStatusError(429, 3_600_000)));
    await expect(withRetry(long, deps())).rejects.toThrow('HTTP 429');
    expect(long).toHaveBeenCalledTimes(1);
  });

  it('never retries client errors or policy refusals', async () => {
    const forbidden = vi.fn(() => Promise.reject(new HttpStatusError(403, null)));
    await expect(withRetry(forbidden, deps())).rejects.toThrow();
    expect(forbidden).toHaveBeenCalledTimes(1);
    const blocked = vi.fn(() => Promise.reject(new SafeFetchError('BLOCKED_ADDRESS', 'b')));
    await expect(withRetry(blocked, deps())).rejects.toThrow();
    expect(blocked).toHaveBeenCalledTimes(1);
  });

  it('parses Retry-After seconds and dates', () => {
    const now = Date.parse('2026-11-02T21:00:00Z');
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter('Mon, 02 Nov 2026 21:01:00 GMT', now)).toBe(60_000);
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter(undefined, now)).toBeNull();
  });
});

describe('circuit breaker and helpers', () => {
  const now = new Date('2026-11-02T21:00:00Z');
  it('cools down degraded sources for 4× the interval, at most 6 h', () => {
    const tenMinAgo = new Date(now.getTime() - 10 * 60_000);
    expect(isCoolingDown(4, tenMinAgo, 15 * 60_000, now)).toBe(false);
    expect(isCoolingDown(5, tenMinAgo, 15 * 60_000, now)).toBe(true);
    expect(isCoolingDown(5, new Date(now.getTime() - 61 * 60_000), 15 * 60_000, now)).toBe(false);
    expect(isCoolingDown(9, new Date(now.getTime() - 5 * 3_600_000), 6 * 3_600_000, now)).toBe(
      true,
    );
    expect(isCoolingDown(9, new Date(now.getTime() - 7 * 3_600_000), 6 * 3_600_000, now)).toBe(
      false,
    );
  });

  it('describes errors without newlines', () => {
    expect(describeError(new Error('line1\nline2'))).toBe('Error: line1 line2');
    expect(describeError(new SafeFetchError('TOO_LARGE', 'big'))).toBe('TOO_LARGE: big');
    expect(describeError('x')).toBe('Unknown error');
  });

  it('derives the interval from a cron expression', () => {
    expect(intervalOf('*/30 * * * *')).toBe(30 * 60_000);
    expect(intervalOf('0 */6 * * *')).toBe(6 * 3_600_000);
  });
});

describe('runSource', () => {
  let dir: string;
  let handle: DatabaseHandle;
  let clock: Date;
  let responses: ((
    url: string,
    options?: SafeFetchOptions,
  ) => SafeFetchResponse | Promise<never>)[];
  let calls: { url: string; options: SafeFetchOptions | undefined }[];
  let deps: RunnerDeps;

  const respond = (
    status: number,
    body = '',
    headers: Record<string, string> = {},
  ): SafeFetchResponse => ({
    status,
    headers,
    body,
    url: 'https://www.bleepingcomputer.com/feed/',
    bytes: body.length,
    durationMs: 5,
    redirects: 0,
  });
  const lastRun = (sourceId = 'bleeping') =>
    handle.db
      .select()
      .from(schema.fetchRuns)
      .where(eq(schema.fetchRuns.sourceId, sourceId))
      .orderBy(desc(schema.fetchRuns.id))
      .get();
  const sourceRow = (id = 'bleeping') =>
    handle.db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'panel-runner-'));
    handle = openDatabase(join(dir, 'panel.db'));
    migrateDatabase(handle.db);
    seedDatabase(handle.db, loadSourcesCatalog(root('config/sources.default.json')));
    clock = new Date('2026-11-02T21:00:00Z');
    responses = [];
    calls = [];
    const safeFetch: SafeFetch = (url, options) => {
      calls.push({ url, options });
      const next = responses.shift();
      if (!next) return Promise.reject(new Error('no response queued'));
      return Promise.resolve(next(url, options));
    };
    deps = {
      db: handle.db,
      adapters: createAdapters(),
      pipeline: {
        keywords: compileKeywords(
          keywordsConfigSchema.parse(
            JSON.parse(readFileSync(root('config/keywords.json'), 'utf8')),
          ),
        ),
        watchlist: DEFAULT_WATCHLIST,
      },
      safeFetch,
      queue: new TaskQueue(4),
      secrets: {},
      userAgent: 'Panel/test',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => clock,
      sleep: vi.fn(() => Promise.resolve()),
      random: () => 0.5,
    };
  });

  afterEach(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores items, validators and a healthy run on 200', async () => {
    responses.push(() =>
      respond(200, RSS, { etag: '"v1"', 'last-modified': 'Mon, 02 Nov 2026 20:00:00 GMT' }),
    );
    const outcome = await runSource('bleeping', deps);
    expect(outcome).toMatchObject({ status: 'ok', result: { inserted: 3 } });
    expect(calls[0]?.options).toMatchObject({
      trust: 'default',
      headers: { 'user-agent': 'Panel/test' },
    });
    expect(calls[0]?.options?.headers?.['accept']).toBeUndefined();
    expect(sourceRow()).toMatchObject({ etag: '"v1"', health: 'healthy', consecutiveFailures: 0 });
    expect(lastRun()).toMatchObject({ status: 'ok', httpStatus: 200, itemsNew: 3 });
  });

  it('asks JSON APIs for JSON explicitly', async () => {
    responses.push(() => respond(200, '[]'));
    await runSource('hibp', deps);
    expect(calls[0]?.options?.headers?.['accept']).toBe('application/json');
  });

  it('sends validators next time and skips all processing on 304', async () => {
    responses.push(() => respond(200, RSS, { etag: '"v1"' }));
    await runSource('bleeping', deps);
    const normalize = vi.spyOn(deps.adapters.rss, 'normalize');
    responses.push(() => respond(304));
    await expect(runSource('bleeping', deps)).resolves.toEqual({ status: 'not_modified' });
    expect(calls[1]?.options?.headers).toMatchObject({ 'if-none-match': '"v1"' });
    expect(normalize).not.toHaveBeenCalled();
    expect(lastRun()).toMatchObject({ status: 'not_modified', httpStatus: 304, itemsNew: 0 });
    expect(handle.db.select().from(schema.items).all()).toHaveLength(3);
  });

  it('retries server errors, then records the failure', async () => {
    for (let i = 0; i < 3; i++) responses.push(() => respond(503));
    const outcome = await runSource('bleeping', deps);
    expect(outcome).toEqual({ status: 'error', error: 'HttpStatusError: HTTP 503' });
    expect(calls).toHaveLength(3);
    expect(sourceRow()).toMatchObject({ health: 'failing', consecutiveFailures: 1 });
    expect(lastRun()).toMatchObject({ status: 'error', httpStatus: 503 });
  });

  it('opens the breaker after 5 failures, cools down, and closes on success', async () => {
    const failing = () => Promise.reject(new SafeFetchError('BLOCKED_ADDRESS', 'nope'));
    for (let i = 0; i < 5; i++) {
      responses.push(failing);
      await runSource('bleeping', deps, { intervalMs: 30 * 60_000 });
      clock = new Date(clock.getTime() + 60_000);
    }
    expect(sourceRow()).toMatchObject({ health: 'degraded', consecutiveFailures: 5 });
    const healthEvents = handle.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, 'source.health'))
      .all();
    expect(healthEvents.map((e) => e.payloadJson['health'])).toEqual(['failing', 'degraded']);

    await expect(runSource('bleeping', deps, { intervalMs: 30 * 60_000 })).resolves.toEqual({
      status: 'skipped',
      reason: 'cooling_down',
    });
    clock = new Date(clock.getTime() + 2 * 3_600_000);
    responses.push(() => respond(200, RSS));
    await expect(runSource('bleeping', deps, { intervalMs: 30 * 60_000 })).resolves.toMatchObject({
      status: 'ok',
    });
    expect(sourceRow()).toMatchObject({ health: 'healthy', consecutiveFailures: 0 });
  });

  it('marks slow runs', async () => {
    responses.push(() => {
      clock = new Date(clock.getTime() + 4_100);
      return respond(200, RSS);
    });
    await runSource('bleeping', deps);
    expect(sourceRow()?.health).toBe('slow');
  });

  it('drops candidates that fail validation', async () => {
    const rss = RSS.replace('https://news.example.com/2026/11/open-models', 'https://localhost/x');
    responses.push(() => respond(200, rss));
    const outcome = await runSource('bleeping', deps);
    expect(outcome).toMatchObject({ status: 'ok', dropped: 2, result: { inserted: 2 } });
  });

  it('uses the strict trust level for custom sources and skips disabled or unknown ones', async () => {
    handle.db
      .insert(schema.sources)
      .values({
        id: 'custom-feed',
        name: 'Mine',
        group: 'custom',
        kind: 'article',
        adapter: 'rss',
        url: 'https://mine.example/feed',
        lang: 'fr',
        schedule: '0 * * * *',
        isCustom: true,
      })
      .run();
    responses.push(() => respond(200, RSS));
    await runSource('custom-feed', deps);
    expect(calls[0]?.options?.trust).toBe('custom');

    handle.db
      .update(schema.sources)
      .set({ enabled: false })
      .where(eq(schema.sources.id, 'hn'))
      .run();
    await expect(runSource('hn', deps)).resolves.toEqual({ status: 'skipped', reason: 'disabled' });
    await expect(runSource('nope', deps)).resolves.toEqual({
      status: 'skipped',
      reason: 'unknown',
    });
  });
});
