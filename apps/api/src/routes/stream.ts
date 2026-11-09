import { asc, gt, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type PanelDb } from '@panel/db';
import { resolveSession, SESSION_COOKIE, type AuthDeps } from '../auth.js';
import { sendProblem } from '../http.js';

const { events } = schema;

export const STREAM = {
  pollMs: 2_000,
  heartbeatMs: 25_000,
  batch: 100,
  maxClients: 10,
} as const;

/** One SSE frame. JSON.stringify escapes newlines, so payloads cannot inject frames. */
export function formatSse(id: number, type: string, payload: unknown): string {
  return `id: ${String(id)}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function eventsAfter(db: PanelDb, lastId: number) {
  return db
    .select()
    .from(events)
    .where(gt(events.id, lastId))
    .orderBy(asc(events.id))
    .limit(STREAM.batch)
    .all();
}

export const latestEventId = (db: PanelDb): number =>
  db
    .select({ id: max(events.id) })
    .from(events)
    .get()?.id ?? 0;

/**
 * GET /api/stream (SPEC § 8): tails the collector's `events` table and pushes `item.new`,
 * `cve.updated` and `source.health`, with a heartbeat every 25 s. Reconnecting clients resume
 * from `Last-Event-ID`. The session is re-checked on every heartbeat.
 */
export function registerStream(app: FastifyInstance, auth: AuthDeps): void {
  let clients = 0;

  app.get('/api/stream', (request, reply) => {
    if (clients >= STREAM.maxClients) {
      return sendProblem(reply, request, {
        status: 503,
        title: 'Service Unavailable',
        detail: 'Too many streams.',
      });
    }
    const resumeFrom = Number(request.headers['last-event-id']);
    let lastId =
      Number.isSafeInteger(resumeFrom) && resumeFrom >= 0 ? resumeFrom : latestEventId(auth.db);
    const token = request.cookies[SESSION_COOKIE];

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write('retry: 5000\n\n');
    clients++;

    const poll = setInterval(() => {
      for (const event of eventsAfter(auth.db, lastId)) {
        raw.write(formatSse(event.id, event.type, event.payloadJson));
        lastId = event.id;
      }
    }, STREAM.pollMs);
    const heartbeat = setInterval(() => {
      if (resolveSession(auth, token) === null) {
        raw.end();
        return;
      }
      raw.write(': ping\n\n');
    }, STREAM.heartbeatMs);

    request.raw.on('close', () => {
      clearInterval(poll);
      clearInterval(heartbeat);
      clients--;
    });
    return reply;
  });
}
