import { and, count, countDistinct, gt, inArray, lt, lte, notLike } from 'drizzle-orm';
import { readPrefs, schema, type PanelDb } from '@panel/db';
import type { Lang } from '@panel/shared';
import type { AlertChannel, Channel } from './channels.js';
import { alertMessageSchema, payloadHash, type AlertMessage } from './message.js';
import { digestMessage, findAlerts, testMessage } from './rules.js';
import { inQuietHours, localTime, toMinutes } from './time.js';

const { alertsSent, alertQueue } = schema;

const HOUR = 3_600_000;
const QUEUE_MAX_AGE = 7 * 24 * HOUR;
const DAY_MINUTES = 24 * 60;
/** How long after the digest time a late start (or a failing channel) may still send it. */
export const DIGEST_WINDOW_MINUTES = 180;

export interface NotifierLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface AlertRunDeps {
  db: PanelDb;
  channels: readonly Channel[];
  now: Date;
  timeZone: string;
  publicUrl: string | undefined;
  logger?: NotifierLogger | undefined;
}

export interface AlertRunReport {
  sent: number;
  queued: number;
  failed: number;
  digest: boolean;
}

/** Channels that already delivered each key (any key of an alert counts as delivered). */
function deliveredByKey(db: PanelDb, keys: string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (let i = 0; i < keys.length; i += 500) {
    const rows = db
      .select({ key: alertsSent.dedupeKey, channel: alertsSent.channel })
      .from(alertsSent)
      .where(inArray(alertsSent.dedupeKey, keys.slice(i, i + 500)))
      .all();
    for (const row of rows) map.set(row.key, (map.get(row.key) ?? new Set()).add(row.channel));
  }
  return map;
}

function record(db: PanelDb, message: AlertMessage, channel: AlertChannel, now: Date): void {
  const hash = payloadHash(message);
  for (const key of [message.key, ...message.covers]) {
    db.insert(alertsSent)
      .values({ dedupeKey: key, channel, payloadHash: hash, sentAt: now })
      .onConflictDoNothing()
      .run();
  }
}

/** Alerts (not messages) sent in the last hour; digests and tests do not count. */
function sentLastHour(db: PanelDb, now: Date): number {
  return (
    db
      .select({ n: countDistinct(alertsSent.dedupeKey) })
      .from(alertsSent)
      .where(
        and(
          gt(alertsSent.sentAt, new Date(now.getTime() - HOUR)),
          notLike(alertsSent.dedupeKey, 'digest:%'),
        ),
      )
      .get()?.n ?? 0
  );
}

/** Sends to each channel; returns the channels that accepted the message. */
async function deliver(
  message: AlertMessage,
  channels: readonly Channel[],
  logger: NotifierLogger | undefined,
): Promise<Channel[]> {
  const ok: Channel[] = [];
  for (const channel of channels) {
    try {
      await channel.send(message);
      ok.push(channel);
    } catch (error) {
      logger?.warn(
        { channel: channel.name, key: message.key, reason: (error as Error).message },
        'alert not delivered',
      );
    }
  }
  return ok;
}

/** Queued alerts held back before `until`. */
function readQueue(db: PanelDb, until: Date): AlertMessage[] {
  return db
    .select()
    .from(alertQueue)
    .where(lte(alertQueue.queuedAt, until))
    .orderBy(alertQueue.queuedAt)
    .all()
    .flatMap((row) => {
      const parsed = alertMessageSchema.safeParse(row.payloadJson);
      return parsed.success ? [parsed.data] : [];
    });
}

/**
 * The daily digest: during the window that opens at the local digest time, every channel that
 * has not yet received that day's digest gets the queued alerts it has not seen. A marker is
 * recorded per channel even when the queue is empty. Outside the window nothing is sent, so a
 * restart in the afternoon cannot turn alerts the hourly cap just held back into an instant
 * digest: they wait for the next morning. Queue rows go once every channel has them.
 */
async function runDigest(
  deps: AlertRunDeps,
  lang: Lang,
  digestAt: string,
  local: { minutes: number },
): Promise<boolean> {
  const { db, channels, now, logger } = deps;
  const late = (local.minutes - toMinutes(digestAt) + DAY_MINUTES) % DAY_MINUTES;
  if (late >= DIGEST_WINDOW_MINUTES) return false;
  // The digest belongs to the day its window opened (a 23:30 digest still runs at 00:10).
  const opened = new Date(now.getTime() - late * 60_000);
  const day = localTime(opened, deps.timeZone).date;
  const key = `digest:${day}`;
  const done = deliveredByKey(db, [key]).get(key) ?? new Set<string>();
  const pending = channels.filter((c) => !done.has(c.name));
  if (pending.length === 0) return false;

  // Only what was held back before the window opened: later alerts wait for tomorrow.
  const queue = readQueue(db, opened);
  const delivered = deliveredByKey(
    db,
    queue.map((m) => m.key),
  );
  let sentAny = false;
  for (const channel of pending) {
    const unseen = queue.filter((m) => !delivered.get(m.key)?.has(channel.name));
    const digest = digestMessage(key, unseen, lang, deps.publicUrl);
    if (unseen.length > 0) {
      const ok = await deliver(digest, [channel], logger);
      if (ok.length === 0) continue;
      sentAny = true;
      for (const message of unseen) record(db, message, channel.name, now);
    }
    record(db, digest, channel.name, now);
  }
  const after = deliveredByKey(
    db,
    queue.map((m) => m.key),
  );
  const finished = queue
    .filter((m) => channels.every((c) => after.get(m.key)?.has(c.name)))
    .map((m) => m.key);
  if (finished.length > 0)
    db.delete(alertQueue).where(inArray(alertQueue.dedupeKey, finished)).run();
  // A channel that keeps failing must not make the queue grow forever.
  db.delete(alertQueue)
    .where(lt(alertQueue.queuedAt, new Date(now.getTime() - QUEUE_MAX_AGE)))
    .run();
  if (sentAny) logger?.info({ alerts: queue.length }, 'daily digest sent');
  return sentAny;
}

/**
 * One notifier pass (SPEC § 7.10), run every minute by the collector: evaluate the rules, send
 * what is new to the channels that have not had it, hold back what exceeds the hourly cap or
 * falls in quiet hours, and send the daily digest. Restart-safe: all state is in the database.
 */
export async function runAlerts(deps: AlertRunDeps): Promise<AlertRunReport> {
  const report: AlertRunReport = { sent: 0, queued: 0, failed: 0, digest: false };
  const { db, channels, now, logger } = deps;
  if (channels.length === 0) return report;

  const prefs = readPrefs(db);
  const thresholds = prefs.alerts;
  const local = localTime(now, deps.timeZone);
  const quiet = inQuietHours(local.minutes, thresholds.quietHours);

  const alerts = findAlerts({
    db,
    now,
    thresholds,
    lang: prefs.lang,
    publicUrl: deps.publicUrl,
  });
  const keys = alerts.flatMap((a) => [a.key, ...a.covers]);
  const delivered = deliveredByKey(db, keys);
  const queued = new Set(
    keys.length === 0
      ? []
      : db
          .select({ key: alertQueue.dedupeKey })
          .from(alertQueue)
          .where(inArray(alertQueue.dedupeKey, keys))
          .all()
          .map((r) => r.key),
  );
  let budget = thresholds.maxPerHour - sentLastHour(db, now);
  const seen = new Set<string>();

  for (const alert of alerts) {
    if (seen.has(alert.key)) continue;
    // Covered keys are settled even when this alert is skipped (already queued or sent).
    seen.add(alert.key);
    for (const key of alert.covers) seen.add(key);
    if (queued.has(alert.key)) continue;
    const done = delivered.get(alert.key) ?? new Set<string>();
    const pending = channels.filter((c) => !done.has(c.name));
    if (pending.length === 0) continue;
    const retry = done.size > 0; // another channel already has it: finish the job

    if (!retry && (quiet || budget <= 0)) {
      db.insert(alertQueue)
        .values({ dedupeKey: alert.key, payloadJson: alert, queuedAt: now })
        .onConflictDoNothing()
        .run();
      report.queued++;
      continue;
    }
    if (retry && quiet) continue;

    const ok = await deliver(alert, pending, logger);
    for (const channel of ok) record(db, alert, channel.name, now);
    report.failed += pending.length - ok.length;
    if (ok.length > 0 && !retry) {
      report.sent++;
      budget--;
    }
  }

  report.digest = await runDigest(deps, prefs.lang, thresholds.digestAt, local);
  if (report.sent + report.queued + report.failed > 0) logger?.info({ ...report }, 'alerts run');
  return report;
}

/** Sends the "Send a test alert" message (SPEC § 7.10) on every configured channel. */
export async function sendTestAlert(
  channels: readonly Channel[],
  lang: Lang,
  publicUrl: string | undefined,
): Promise<{ sent: AlertChannel[]; failed: AlertChannel[] }> {
  const message = testMessage(lang, publicUrl);
  const ok = await deliver(message, channels, undefined);
  return {
    sent: ok.map((c) => c.name),
    failed: channels.filter((c) => !ok.includes(c)).map((c) => c.name),
  };
}

/** Number of alerts waiting for the next digest (health page). */
export function queuedAlerts(db: PanelDb): number {
  return db.select({ n: count() }).from(alertQueue).get()?.n ?? 0;
}
