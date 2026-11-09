import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { hash, verify } from '@node-rs/argon2';
import { count, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { schema, type PanelDb } from '@panel/db';
import {
  DEFAULT_PREFS,
  loginBodySchema,
  prefsSchema,
  sessionDtoSchema,
  setupBodySchema,
} from '@panel/shared';
import { HttpProblem, parseInput, sendJson } from './http.js';

const { users, sessions, prefs } = schema;

export const SESSION_COOKIE = '__Host-panel_sid';
export const SESSION_TTL_MS = 30 * 86_400_000;
/** Sliding expiry: an active session is extended at most once an hour. */
const RENEW_AFTER_MS = 3_600_000;

/** OWASP minimum for Argon2id (SPEC § 9.5). */
const ARGON2 = {
  // Algorithm.Argon2id: the package exports a const enum, unusable under verbatimModuleSyntax.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassphrase = (passphrase: string) => hash(passphrase, ARGON2);
export const verifyPassphrase = (stored: string, passphrase: string) => verify(stored, passphrase);

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route reachable without a session. */
    public?: boolean;
  }
  interface FastifyRequest {
    userId: number | null;
  }
}

/** Constant-time string comparison that does not leak length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Failed logins slow down exponentially per client IP (250 ms doubling, up to 4 s), on top
 * of the 5-per-15-minutes rate limit. Messages stay generic.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; first: number }>();

  constructor(private readonly windowMs = 15 * 60_000) {}

  delayFor(ip: string, now: number): number {
    const entry = this.failures.get(ip);
    if (!entry || now - entry.first > this.windowMs) return 0;
    return Math.min(4_000, 250 * 2 ** (entry.count - 1));
  }

  fail(ip: string, now: number): void {
    const entry = this.failures.get(ip);
    if (!entry || now - entry.first > this.windowMs)
      this.failures.set(ip, { count: 1, first: now });
    else entry.count++;
    if (this.failures.size > 10_000) this.failures.clear();
  }

  succeed(ip: string): void {
    this.failures.delete(ip);
  }
}

export interface AuthDeps {
  db: PanelDb;
  sessionSecret: string;
  setupToken: string;
  now: () => Date;
  throttle: LoginThrottle;
  /** Waits before answering a failed login; injectable for tests. */
  delay: (ms: number) => Promise<void>;
}

/** The cookie carries a random token; the database only stores its HMAC (useless if leaked). */
export const sessionIdFor = (token: string, secret: string) =>
  createHmac('sha256', secret).update(token).digest('hex');

const userCount = (db: PanelDb) => db.select({ n: count() }).from(users).get()?.n ?? 0;

function startSession(
  reply: FastifyReply,
  request: FastifyRequest,
  deps: AuthDeps,
  userId: number,
): void {
  // Rotation: whatever session the browser presented is dropped before issuing a new one.
  const previous = request.cookies[SESSION_COOKIE];
  if (previous !== undefined) {
    deps.db
      .delete(sessions)
      .where(eq(sessions.id, sessionIdFor(previous, deps.sessionSecret)))
      .run();
  }
  const token = randomBytes(32).toString('base64url');
  const now = deps.now();
  deps.db
    .insert(sessions)
    .values({
      id: sessionIdFor(token, deps.sessionSecret),
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      lastSeenAt: now,
      uaHash: createHash('sha256')
        .update(request.headers['user-agent'] ?? '')
        .digest('hex'),
    })
    .run();
  void reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Returns the user id of a valid session, extending it when due, or null. */
export function resolveSession(deps: AuthDeps, token: string | undefined): number | null {
  if (token === undefined || token.length > 100) return null;
  const id = sessionIdFor(token, deps.sessionSecret);
  const session = deps.db.select().from(sessions).where(eq(sessions.id, id)).get();
  const now = deps.now();
  if (!session) return null;
  if (session.expiresAt.getTime() <= now.getTime()) {
    deps.db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() > RENEW_AFTER_MS) {
    deps.db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(sessions.id, id))
      .run();
  }
  return session.userId;
}

/** Every route requires a session unless it is declared `config: { public: true }`. */
export function registerSessionGuard(app: FastifyInstance, deps: AuthDeps): void {
  app.decorateRequest('userId', null);
  app.addHook('onRequest', (request, _reply, done) => {
    request.userId = resolveSession(deps, request.cookies[SESSION_COOKIE]);
    if (
      request.userId === null &&
      request.routeOptions.config.public !== true &&
      request.url.startsWith('/api/')
    ) {
      done(new HttpProblem(401, 'Unauthorized', 'Sign in required.'));
      return;
    }
    done();
  });
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  app.get('/api/auth/session', { config: { public: true } }, (request, reply) =>
    sendJson(reply, sessionDtoSchema, {
      authenticated: request.userId !== null,
      setupRequired: userCount(deps.db) === 0,
    }),
  );

  app.post(
    '/api/auth/setup',
    { config: { public: true, rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = parseInput(setupBodySchema, request.body);
      if (userCount(deps.db) > 0)
        throw new HttpProblem(409, 'Conflict', 'This instance is already set up.');
      if (!safeEqual(body.token, deps.setupToken))
        throw new HttpProblem(403, 'Forbidden', 'Invalid setup token.');

      const passphraseHash = await hashPassphrase(body.passphrase);
      const userId = deps.db.transaction(
        (tx) => {
          // Re-checked inside the transaction: two concurrent setups cannot both succeed.
          if ((tx.select({ n: count() }).from(users).get()?.n ?? 0) > 0) return null;
          const user = tx
            .insert(users)
            .values({ passphraseHash })
            .returning({ id: users.id })
            .get();
          const current = tx.select().from(prefs).where(eq(prefs.key, 'prefs')).get();
          const base = prefsSchema.safeParse(current?.valueJson);
          const value = {
            ...(base.success ? base.data : DEFAULT_PREFS),
            displayName: body.displayName,
            lang: body.lang,
          };
          tx.insert(prefs)
            .values({ key: 'prefs', valueJson: value })
            .onConflictDoUpdate({ target: prefs.key, set: { valueJson: value } })
            .run();
          return user.id;
        },
        { behavior: 'immediate' },
      );
      if (userId === null)
        throw new HttpProblem(409, 'Conflict', 'This instance is already set up.');
      startSession(reply, request, deps, userId);
      return sendJson(reply.code(201), sessionDtoSchema, {
        authenticated: true,
        setupRequired: false,
      });
    },
  );

  app.post(
    '/api/auth/login',
    { config: { public: true, rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const { passphrase } = parseInput(loginBodySchema, request.body);
      const user = deps.db.select().from(users).limit(1).get();
      const ok = user !== undefined && (await verifyPassphrase(user.passphraseHash, passphrase));
      if (!user || !ok) {
        const now = deps.now().getTime();
        deps.throttle.fail(request.ip, now);
        await deps.delay(deps.throttle.delayFor(request.ip, now));
        throw new HttpProblem(401, 'Unauthorized', 'Invalid passphrase.');
      }
      deps.throttle.succeed(request.ip);
      startSession(reply, request, deps, user.id);
      return sendJson(reply, sessionDtoSchema, { authenticated: true, setupRequired: false });
    },
  );

  app.post('/api/auth/logout', (request, reply) => {
    const presented = request.cookies[SESSION_COOKIE];
    if (presented !== undefined) {
      deps.db
        .delete(sessions)
        .where(eq(sessions.id, sessionIdFor(presented, deps.sessionSecret)))
        .run();
    }
    void reply.clearCookie(SESSION_COOKIE, {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
    });
    return reply.code(204).send();
  });
}

export const defaultAuthDelay = (ms: number) => (ms > 0 ? sleep(ms) : Promise.resolve());
