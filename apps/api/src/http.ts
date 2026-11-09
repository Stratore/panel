import { createHash } from 'node:crypto';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Problem } from '@panel/shared';

/** An error that maps to an RFC 9457 problem response. */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: { path: string; message: string }[],
  ) {
    super(title);
  }
}

const TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

const titleFor = (status: number) =>
  (Object.hasOwn(TITLES, status) ? TITLES[status] : undefined) ?? 'Error';

export function sendProblem(
  reply: FastifyReply,
  request: FastifyRequest,
  problem: Omit<Problem, 'type' | 'instance'>,
): FastifyReply {
  const body: Problem = {
    type: 'about:blank',
    instance: request.url.split('?')[0] ?? '/',
    ...problem,
  };
  return reply.status(problem.status).type('application/problem+json').send(body);
}

/** Parses input with Zod; failures become a 400 problem listing the invalid fields. */
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new HttpProblem(
    400,
    'Bad Request',
    'The request is invalid.',
    result.error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.map(String).join('.') || '(root)',
      message: issue.message,
    })),
  );
}

/**
 * Output validation (SPEC § 8: Zod in and out). A failure is a server bug: it is logged and
 * answered with a generic 500, never with the offending data.
 */
export function sendJson<T extends z.ZodType>(
  reply: FastifyReply,
  schema: T,
  data: z.input<T>,
): FastifyReply {
  const result = schema.safeParse(data);
  if (!result.success) {
    reply.log.error({ issues: result.error.issues.slice(0, 5) }, 'response validation failed');
    throw new HttpProblem(500, 'Internal Server Error');
  }
  return reply.send(result.data);
}

/** Problem responses for every error, without stack traces (SPEC § 8). */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | HttpProblem, request, reply) => {
    if (error instanceof HttpProblem) {
      if (error.status >= 500) request.log.error({ err: error }, error.title);
      return sendProblem(reply, request, {
        status: error.status,
        title: error.title,
        ...(error.detail === undefined ? {} : { detail: error.detail }),
        ...(error.errors === undefined ? {} : { errors: error.errors }),
      });
    }
    const status =
      typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) request.log.error({ err: error }, 'unhandled error');
    // Client errors from Fastify itself (body too large, bad JSON, rate limit) keep a safe message.
    const detail = status < 500 ? error.message : undefined;
    return sendProblem(reply, request, {
      status,
      title: titleFor(status),
      ...(detail === undefined ? {} : { detail }),
    });
  });
  app.setNotFoundHandler((request, reply) =>
    sendProblem(reply, request, { status: 404, title: 'Not Found' }),
  );
}

/**
 * Weak ETags on JSON GET responses; a matching If-None-Match yields 304 (SPEC § 8).
 * API data is private and must always be revalidated.
 */
export function registerEtags(app: FastifyInstance): void {
  app.addHook('onSend', (request, reply, payload, done) => {
    if (request.method !== 'GET' || reply.statusCode !== 200 || typeof payload !== 'string') {
      done(null, payload);
      return;
    }
    const etag = `W/"${createHash('sha256').update(payload).digest('base64url').slice(0, 27)}"`;
    void reply.header('etag', etag).header('cache-control', 'private, no-cache');
    const ifNoneMatch = request.headers['if-none-match'];
    if (ifNoneMatch?.split(',').some((tag) => tag.trim() === etag) === true) {
      void reply.code(304);
      done(null, '');
      return;
    }
    done(null, payload);
  });
}

export const CSRF_HEADER = 'x-panel-csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth (SPEC § 9.1), on top of SameSite=Strict cookies: state-changing
 * requests need the custom `X-Panel-CSRF` header (impossible cross-site without CORS, which
 * is disabled) and, when the browser sends one, an Origin matching this instance.
 */
export function registerCsrf(app: FastifyInstance, publicOrigin: string | undefined): void {
  app.addHook('onRequest', (request, reply, done) => {
    if (SAFE_METHODS.has(request.method)) {
      done();
      return;
    }
    if (request.headers[CSRF_HEADER] !== '1') {
      void sendProblem(reply, request, {
        status: 403,
        title: 'Forbidden',
        detail: 'Missing CSRF header.',
      });
      return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined) {
      const expected = publicOrigin ?? `${request.protocol}://${request.host}`;
      if (origin !== expected) {
        void sendProblem(reply, request, {
          status: 403,
          title: 'Forbidden',
          detail: 'Cross-origin request refused.',
        });
        return;
      }
    }
    done();
  });
}

/** Opaque, URL-safe pagination cursor. */
export const encodeCursor = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

export function decodeCursor<T extends z.ZodType>(
  schema: T,
  cursor: string | undefined,
): z.infer<T> | undefined {
  if (cursor === undefined) return undefined;
  try {
    return parseInput(schema, JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new HttpProblem(400, 'Bad Request', 'Invalid cursor.');
  }
}
