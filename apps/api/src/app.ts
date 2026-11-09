import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PanelDb } from '@panel/db';
import type { SafeFetch } from '@panel/safe-fetch';
import {
  defaultAuthDelay,
  LoginThrottle,
  registerAuthRoutes,
  registerSessionGuard,
  type AuthDeps,
} from './auth.js';
import { registerCsrf, registerErrorHandling, registerEtags } from './http.js';
import { registerAdminRoutes, type AlertSender } from './routes/admin.js';
import { registerContentRoutes } from './routes/content.js';
import { registerStream } from './routes/stream.js';

export interface AppDeps {
  db: PanelDb;
  safeFetch: SafeFetch;
  alerts: AlertSender;
  sessionSecret: string;
  setupToken: string;
  publicOrigin?: string | undefined;
  trustProxy?: boolean;
  version?: string;
  logLevel?: string;
  now?: () => Date;
  /** Delay applied to failed logins (tests pass a no-op). */
  authDelay?: (ms: number) => Promise<void>;
}

/** Content-Security-Policy of SPEC § 9.2 (also served by Caddy for the front-end). */
const CSP = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  manifestSrc: ["'self'"],
  workerSrc: ["'self'"],
  frameAncestors: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  objectSrc: ["'none'"],
  upgradeInsecureRequests: [],
  requireTrustedTypesFor: ["'script'"],
  trustedTypes: ["'none'"],
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const now = deps.now ?? (() => new Date());
  const app = Fastify({
    trustProxy: deps.trustProxy ?? false,
    bodyLimit: 64 * 1024,
    logger: {
      level: deps.logLevel ?? 'info',
      // Cookies and credentials never reach the logs.
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
  });

  registerErrorHandling(app);
  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: CSP },
    strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
  });
  app.addHook('onSend', (_request, reply, payload, done) => {
    void reply.header(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    );
    done(null, payload);
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  registerEtags(app);
  registerCsrf(app, deps.publicOrigin);

  const auth: AuthDeps = {
    db: deps.db,
    sessionSecret: deps.sessionSecret,
    setupToken: deps.setupToken,
    now,
    throttle: new LoginThrottle(),
    delay: deps.authDelay ?? defaultAuthDelay,
  };
  registerSessionGuard(app, auth);
  registerAuthRoutes(app, auth);
  registerContentRoutes(app, { db: deps.db, now });
  registerAdminRoutes(app, {
    db: deps.db,
    now,
    safeFetch: deps.safeFetch,
    alerts: deps.alerts,
    version: deps.version ?? '0.0.0',
    startedAt: now(),
  });
  registerStream(app, auth);
  return app;
}
