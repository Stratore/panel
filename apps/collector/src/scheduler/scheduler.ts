import { Cron } from 'croner';
import { eq } from 'drizzle-orm';
import {
  backupDatabase,
  compactDatabase,
  purgeExpired,
  schema,
  type DatabaseHandle,
} from '@panel/db';
import { refreshAllPriorities } from '../pipeline/cves.js';
import { describeError, runSource, type RunnerDeps } from './runner.js';

const { sources } = schema;

/** Jitter added after each trigger: up to 10 % of the interval (SPEC § 7.1). */
export const JITTER_RATIO = 0.1;

export function intervalOf(pattern: string): number {
  const [a, b] = new Cron(pattern, { paused: true }).nextRuns(2);
  return a && b ? b.getTime() - a.getTime() : 3_600_000;
}

export interface SchedulerOptions {
  sqlite: DatabaseHandle['sqlite'];
  backupDir?: string | undefined;
}

interface Job {
  schedule: string;
  cron: Cron;
}

/**
 * One cron job per enabled source, re-synced with the `sources` table every 5 minutes so
 * toggles and custom sources added through the API are picked up without a restart.
 * Maintenance: daily purge and backup, weekly compaction.
 */
export function startScheduler(deps: RunnerDeps, options: SchedulerOptions): { stop(): void } {
  const jobs = new Map<string, Job>();
  const timers = new Set<NodeJS.Timeout>();

  const trigger = (sourceId: string, schedule: string) => {
    const intervalMs = intervalOf(schedule);
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        void runSource(sourceId, deps, { intervalMs }).then((outcome) => {
          // New CVEs get their EPSS score right away (SPEC § 6.1).
          if (sourceId === 'nvd' && outcome.status === 'ok' && outcome.result.newCves > 0) {
            void runSource('epss', deps, { force: true });
          }
        });
      },
      Math.floor(deps.random() * JITTER_RATIO * intervalMs),
    );
    timers.add(timer);
  };

  const sync = () => {
    const rows = deps.db
      .select({ id: sources.id, schedule: sources.schedule })
      .from(sources)
      .where(eq(sources.enabled, true))
      .all();
    const wanted = new Map(rows.map((r) => [r.id, r.schedule]));
    for (const [id, job] of jobs) {
      if (wanted.get(id) !== job.schedule) {
        job.cron.stop();
        jobs.delete(id);
      }
    }
    for (const [id, schedule] of wanted) {
      if (jobs.has(id)) continue;
      jobs.set(id, {
        schedule,
        cron: new Cron(schedule, { protect: true }, () => {
          trigger(id, schedule);
        }),
      });
    }
  };

  const guard = (name: string, task: () => unknown) => async () => {
    try {
      await task();
      deps.logger.info({ task: name }, 'maintenance done');
    } catch (error) {
      deps.logger.error({ task: name, error: describeError(error) }, 'maintenance failed');
    }
  };

  sync();
  const maintenance = [
    new Cron('*/5 * * * *', { protect: true }, sync),
    new Cron(
      '30 3 * * *',
      { protect: true },
      guard('purge', () => purgeExpired(deps.db, deps.now())),
    ),
    new Cron(
      '45 3 * * *',
      { protect: true },
      guard('priorities', () => refreshAllPriorities(deps.db, deps.pipeline.watchlist)),
    ),
    new Cron(
      '0 4 * * 0',
      { protect: true },
      guard('compact', () => {
        compactDatabase(deps.db);
      }),
    ),
  ];
  if (options.backupDir) {
    const dir = options.backupDir;
    maintenance.push(
      new Cron(
        '0 3 * * *',
        { protect: true },
        guard('backup', () => backupDatabase(options.sqlite, dir)),
      ),
    );
  }

  return {
    stop() {
      for (const job of jobs.values()) job.cron.stop();
      for (const cron of maintenance) cron.stop();
      for (const timer of timers) clearTimeout(timer);
      jobs.clear();
    },
  };
}
