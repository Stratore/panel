import { eq } from 'drizzle-orm';
import { schema } from '@panel/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LoginThrottle, safeEqual } from './auth.js';
import {
  createTestApp,
  PASSPHRASE,
  request,
  sessionCookie,
  SETUP_TOKEN,
  setupAndLogin,
  type TestContext,
} from './testing.js';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.close();
});

describe('setup', () => {
  it('reports that setup is required, then creates the single user once', async () => {
    const before = await request(ctx.app, 'GET', '/api/auth/session');
    expect(before.json()).toEqual({ authenticated: false, setupRequired: true });

    const cookie = await setupAndLogin(ctx.app);
    const after = await request(ctx.app, 'GET', '/api/auth/session', { cookie });
    expect(after.json()).toEqual({ authenticated: true, setupRequired: false });
    const prefs = await request(ctx.app, 'GET', '/api/prefs', { cookie });
    expect(prefs.json()).toMatchObject({ prefs: { displayName: 'Pierre', lang: 'fr' } });

    const again = await request(ctx.app, 'POST', '/api/auth/setup', {
      body: { token: SETUP_TOKEN, passphrase: PASSPHRASE },
    });
    expect(again.statusCode).toBe(409);
  });

  it('requires the one-time token', async () => {
    const response = await request(ctx.app, 'POST', '/api/auth/setup', {
      body: { token: 'wrong', passphrase: PASSPHRASE },
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
  });

  it('rejects short passphrases with a problem document and no stack', async () => {
    const response = await request(ctx.app, 'POST', '/api/auth/setup', {
      body: { token: SETUP_TOKEN, passphrase: 'short' },
    });
    expect(response.statusCode).toBe(400);
    const problem = response.json<Record<string, unknown>>();
    expect(problem).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      instance: '/api/auth/setup',
    });
    expect(problem['errors']).toEqual([expect.objectContaining({ path: 'passphrase' })]);
    expect(response.body).not.toMatch(/at .*\.(ts|js):\d+/);
  });

  it('stores an Argon2id hash, never the passphrase', async () => {
    await setupAndLogin(ctx.app);
    const user = ctx.handle.db.select().from(schema.users).get();
    expect(user?.passphraseHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(user?.passphraseHash).not.toContain(PASSPHRASE);
  });
});

describe('sessions', () => {
  it('sets a hardened __Host- cookie', async () => {
    const response = await request(ctx.app, 'POST', '/api/auth/setup', {
      body: { token: SETUP_TOKEN, passphrase: PASSPHRASE },
    });
    const cookie = response.cookies.find((c) => c.name === '__Host-panel_sid');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect(cookie?.maxAge).toBe(30 * 86_400);
    expect(cookie?.domain).toBeUndefined();
    // Only an HMAC of the token is stored.
    const stored = ctx.handle.db.select().from(schema.sessions).get();
    expect(stored?.id).not.toBe(cookie?.value);
  });

  it('protects every API route', async () => {
    for (const url of [
      '/api/journal',
      '/api/brief',
      '/api/cves',
      '/api/sources',
      '/api/prefs',
      '/api/health',
      '/api/stream',
    ]) {
      const response = await request(ctx.app, 'GET', url);
      expect(response.statusCode, url).toBe(401);
    }
    expect((await request(ctx.app, 'GET', '/api/health/live')).statusCode).toBe(200);
  });

  it('logs in with a generic error on failure and rotates the session', async () => {
    const setupCookie = await setupAndLogin(ctx.app);
    const wrong = await request(ctx.app, 'POST', '/api/auth/login', {
      body: { passphrase: 'nope nope nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ detail: 'Invalid passphrase.' });

    const ok = await request(ctx.app, 'POST', '/api/auth/login', {
      cookie: setupCookie,
      body: { passphrase: PASSPHRASE },
    });
    expect(ok.statusCode).toBe(200);
    const fresh = sessionCookie(ok);
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(setupCookie);
    expect((await request(ctx.app, 'GET', '/api/prefs', { cookie: setupCookie })).statusCode).toBe(
      401,
    );
    expect((await request(ctx.app, 'GET', '/api/prefs', { cookie: fresh })).statusCode).toBe(200);
  });

  it('rate-limits login attempts', async () => {
    await setupAndLogin(ctx.app);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await request(ctx.app, 'POST', '/api/auth/login', {
            body: { passphrase: 'wrong wrong wrong' },
          })
        ).statusCode,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('logs out and clears the cookie', async () => {
    const cookie = await setupAndLogin(ctx.app);
    const out = await request(ctx.app, 'POST', '/api/auth/logout', { cookie });
    expect(out.statusCode).toBe(204);
    expect(out.cookies.find((c) => c.name === '__Host-panel_sid')?.value).toBe('');
    expect((await request(ctx.app, 'GET', '/api/prefs', { cookie })).statusCode).toBe(401);
  });

  it('expires sessions after 30 days and extends active ones', async () => {
    const cookie = await setupAndLogin(ctx.app);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 2 * 3_600_000);
    await request(ctx.app, 'GET', '/api/prefs', { cookie });
    const extended = ctx.handle.db.select().from(schema.sessions).get();
    expect(extended?.expiresAt.getTime()).toBe(ctx.clock.now.getTime() + 30 * 86_400_000);

    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * 86_400_000);
    expect((await request(ctx.app, 'GET', '/api/prefs', { cookie })).statusCode).toBe(401);
    expect(ctx.handle.db.select().from(schema.sessions).all()).toHaveLength(0);
  });

  it('ignores forged or oversized tokens', async () => {
    await setupAndLogin(ctx.app);
    const session = ctx.handle.db.select().from(schema.sessions).get();
    // The stored id is useless as a cookie value.
    expect(
      (
        await request(ctx.app, 'GET', '/api/prefs', {
          cookie: `__Host-panel_sid=${session?.id ?? ''}`,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await request(ctx.app, 'GET', '/api/prefs', {
          cookie: `__Host-panel_sid=${'a'.repeat(500)}`,
        })
      ).statusCode,
    ).toBe(401);
    ctx.handle.db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, session?.id ?? ''))
      .run();
  });
});

describe('CSRF and headers', () => {
  it('requires the CSRF header on state-changing requests', async () => {
    const response = await request(ctx.app, 'POST', '/api/auth/setup', {
      csrf: false,
      body: { token: SETUP_TOKEN, passphrase: PASSPHRASE },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ detail: 'Missing CSRF header.' });
  });

  it('refuses cross-origin requests', async () => {
    const response = await request(ctx.app, 'POST', '/api/auth/login', {
      headers: { origin: 'https://evil.example' },
      body: { passphrase: PASSPHRASE },
    });
    expect(response.statusCode).toBe(403);
    const same = await request(ctx.app, 'POST', '/api/auth/login', {
      headers: { origin: 'http://localhost:80' },
      body: { passphrase: PASSPHRASE },
    });
    expect(same.statusCode).not.toBe(403);
  });

  it('sends the security headers of SPEC § 9.2', async () => {
    const response = await request(ctx.app, 'GET', '/api/health/live');
    expect(response.headers['content-security-policy']).toContain(
      "require-trusted-types-for 'script'",
    );
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['strict-transport-security']).toBe(
      'max-age=63072000; includeSubDomains',
    );
    expect(response.headers['permissions-policy']).toContain('camera=()');
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers unknown routes and oversized bodies with problems', async () => {
    const missing = await request(ctx.app, 'GET', '/api/nope');
    expect(missing.statusCode).toBe(401);
    const cookie = await setupAndLogin(ctx.app);
    expect((await request(ctx.app, 'GET', '/api/nope', { cookie })).statusCode).toBe(404);
    const big = await request(ctx.app, 'PUT', '/api/prefs', {
      cookie,
      body: { x: 'y'.repeat(70_000) },
    });
    expect(big.statusCode).toBe(413);
    expect(big.headers['content-type']).toMatch(/problem\+json/);
  });
});

describe('helpers', () => {
  it('compares secrets in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('slows down repeated failures', () => {
    const throttle = new LoginThrottle(60_000);
    expect(throttle.delayFor('1.2.3.4', 0)).toBe(0);
    throttle.fail('1.2.3.4', 0);
    throttle.fail('1.2.3.4', 1);
    throttle.fail('1.2.3.4', 2);
    expect(throttle.delayFor('1.2.3.4', 3)).toBe(1000);
    for (let i = 0; i < 10; i++) throttle.fail('1.2.3.4', 4);
    expect(throttle.delayFor('1.2.3.4', 5)).toBe(4000);
    expect(throttle.delayFor('1.2.3.4', 70_000)).toBe(0);
    throttle.succeed('1.2.3.4');
    expect(throttle.delayFor('1.2.3.4', 6)).toBe(0);
  });
});
