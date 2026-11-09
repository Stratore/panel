import { and, desc, eq, gte, isNotNull, or } from 'drizzle-orm';
import { schema, type PanelDb } from '@panel/db';
import {
  cweNames,
  formatEpss,
  type AlertThresholds,
  type Lang,
  type Severity,
  severityFromCvss,
} from '@panel/shared';
import type { AlertMessage } from './message.js';

const { cves, breaches, items } = schema;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * How far back the rules look. Older rows are history, not news: a fresh install or a long
 * outage must not flood the channels with last month's CVEs. Dedupe keys stop repeats inside
 * the window, including across restarts (`alerts_sent` and `alert_queue` are in the database).
 */
export const LOOKBACK = { kevDays: 2, cveMs: 2 * DAY, breachMs: 7 * DAY, itemMs: 2 * DAY } as const;

/** Rows scanned per rule and run: a burst beyond this waits for the next run. */
const PER_RULE = 50;

const STRINGS = {
  en: {
    severity: {
      critical: 'CRITICAL',
      high: 'HIGH',
      medium: 'MEDIUM',
      low: 'LOW',
      none: 'UNRATED',
    },
    fix: (v: string) => `Fix: upgrade to ${v}`,
    noFix: 'No fix yet',
    watchlist: (l: string) => `Watchlist: ${l}`,
    breach: 'BREACH',
    accounts: (n: string) => `${n} accounts`,
    exposed: (d: string) => `Exposed: ${d}`,
    certfr: 'CERT-FR ALERT',
    hn: (n: string) => `HACKER NEWS · ${n} points`,
    digest: (n: number) => `Daily digest · ${String(n)} held-back alert${n === 1 ? '' : 's'}`,
    more: (n: number) => `…and ${String(n)} more in Panel`,
    test: 'Test alert',
    testLine: 'Panel can reach this channel. Alerts will look like this.',
  },
  fr: {
    severity: {
      critical: 'CRITIQUE',
      high: 'ÉLEVÉE',
      medium: 'MOYENNE',
      low: 'FAIBLE',
      none: 'NON ÉVALUÉE',
    },
    fix: (v: string) => `Correctif : mettre à jour vers ${v}`,
    noFix: 'Pas encore de correctif',
    watchlist: (l: string) => `Watchlist : ${l}`,
    breach: 'FUITE DE DONNÉES',
    accounts: (n: string) => `${n} comptes`,
    exposed: (d: string) => `Données exposées : ${d}`,
    certfr: 'ALERTE CERT-FR',
    hn: (n: string) => `HACKER NEWS · ${n} points`,
    digest: (n: number) => `Résumé du jour · ${String(n)} alerte${n === 1 ? '' : 's'} en attente`,
    more: (n: number) => `…et ${String(n)} de plus dans Panel`,
    test: 'Alerte de test',
    testLine: 'Panel peut joindre ce canal. Les alertes ressembleront à ceci.',
  },
} as const satisfies Record<Lang, unknown>;

export interface RuleContext {
  db: PanelDb;
  now: Date;
  thresholds: AlertThresholds;
  lang: Lang;
  /** Origin of the instance (PANEL_PUBLIC_URL); links fall back to the source when unset. */
  publicUrl: string | undefined;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const compact = (n: number, lang: Lang) =>
  new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);

const decimal = (n: number, lang: Lang) =>
  new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);

type CveRow = typeof cves.$inferSelect;

function cveMessage(row: CveRow, key: string, covers: string[], ctx: RuleContext): AlertMessage {
  const s = STRINGS[ctx.lang];
  const cvss = row.cvss;
  const severity: Severity = row.severity ?? (cvss === null ? 'none' : severityFromCvss(cvss));
  const headline = [
    row.kev ? 'KEV' : null,
    cvss === null ? s.severity[severity] : `${s.severity[severity]} ${decimal(cvss, ctx.lang)}`,
    row.epss === null ? null : `EPSS ${formatEpss(row.epss, ctx.lang)}`,
  ].filter((part) => part !== null);
  const firstFix = (row.fixedVersions ?? '').split(/\s*[·,]\s*/)[0]?.trim() ?? '';
  const subject = [row.product, firstFix === '' ? null : `< ${firstFix}`]
    .filter((part) => part !== null && part !== '')
    .join(' ');
  const title = [
    `${row.cveId}${subject === '' ? '' : ` — ${subject}`}`,
    cweNames(row.cwe, ctx.lang).short,
  ].join(' · ');
  const details = [
    firstFix === '' ? s.noFix : s.fix(firstFix),
    row.watchlistJson.length > 0 ? s.watchlist(row.watchlistJson.join(', ')) : null,
  ].filter((part) => part !== null);
  return {
    key,
    covers,
    rule: key.startsWith('kev:') ? 'kev' : 'crit',
    headline: headline.join(' · '),
    lines: [title, details.join(' · ')],
    url:
      ctx.publicUrl === undefined
        ? `https://nvd.nist.gov/vuln/detail/${row.cveId}`
        : `${ctx.publicUrl}/threats/${row.cveId}`,
  };
}

function meetsCritical(row: CveRow, t: AlertThresholds): boolean {
  return (
    row.cvss !== null &&
    row.cvss >= t.cvss &&
    ((row.epss !== null && row.epss >= t.epss) || row.watchlistJson.length > 0)
  );
}

function kevAlerts(ctx: RuleContext): AlertMessage[] {
  const since = isoDay(new Date(ctx.now.getTime() - LOOKBACK.kevDays * DAY));
  return ctx.db
    .select()
    .from(cves)
    .where(and(eq(cves.kev, true), gte(cves.kevAdded, since)))
    .orderBy(desc(cves.kevAdded))
    .limit(PER_RULE)
    .all()
    .map((row) =>
      cveMessage(
        row,
        `kev:${row.cveId}`,
        // A KEV alert already says everything the "critical" alert would.
        meetsCritical(row, ctx.thresholds) ? [`crit:${row.cveId}`] : [],
        ctx,
      ),
    );
}

function criticalAlerts(ctx: RuleContext): AlertMessage[] {
  const since = new Date(ctx.now.getTime() - LOOKBACK.cveMs);
  return ctx.db
    .select()
    .from(cves)
    .where(
      and(
        isNotNull(cves.cvss),
        gte(cves.cvss, ctx.thresholds.cvss),
        or(gte(cves.published, since), gte(cves.modified, since)),
      ),
    )
    .orderBy(desc(cves.priority))
    .limit(PER_RULE)
    .all()
    .filter((row) => meetsCritical(row, ctx.thresholds))
    .map((row) => cveMessage(row, `crit:${row.cveId}`, [], ctx));
}

function breachAlerts(ctx: RuleContext): AlertMessage[] {
  const s = STRINGS[ctx.lang];
  return ctx.db
    .select()
    .from(breaches)
    .where(
      and(
        gte(breaches.accounts, ctx.thresholds.breachAccounts),
        // HIBP "sensitive" breaches stay in Panel; they are not pushed to chat channels.
        eq(breaches.isSensitive, false),
        gte(breaches.addedDate, new Date(ctx.now.getTime() - LOOKBACK.breachMs)),
      ),
    )
    .orderBy(desc(breaches.addedDate))
    .limit(PER_RULE)
    .all()
    .map((row) => ({
      key: `breach:${row.name}`,
      covers: [],
      rule: 'breach' as const,
      headline: `${s.breach} · ${s.accounts(compact(row.accounts, ctx.lang))}`,
      lines: [
        row.domain === '' ? row.title : `${row.title} (${row.domain})`,
        row.dataClassesJson.length > 0 ? s.exposed(row.dataClassesJson.slice(0, 6).join(', ')) : '',
      ],
      url:
        ctx.publicUrl === undefined
          ? 'https://haveibeenpwned.com/PwnedWebsites'
          : `${ctx.publicUrl}/breaches`,
    }));
}

/** `https://cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-012/` → `CERTFR-2026-ALE-012`. */
export function certFrId(url: string, fallback: number): string {
  try {
    const last = new URL(url).pathname
      .split('/')
      .filter((p) => p !== '')
      .pop();
    if (last !== undefined && /^[\w.-]{1,80}$/.test(last)) return last;
  } catch {
    // fall through
  }
  return `item-${String(fallback)}`;
}

function certFrAlerts(ctx: RuleContext): AlertMessage[] {
  const s = STRINGS[ctx.lang];
  return ctx.db
    .select()
    .from(items)
    .where(
      and(
        eq(items.sourceId, 'cert-fr-alertes'),
        gte(items.fetchedAt, new Date(ctx.now.getTime() - LOOKBACK.itemMs)),
      ),
    )
    .orderBy(desc(items.publishedAt))
    .limit(PER_RULE)
    .all()
    .map((row) => ({
      key: `certfr:${certFrId(row.url, row.id)}`,
      covers: [],
      rule: 'certfr' as const,
      headline: s.certfr,
      lines: [row.title],
      url: row.url,
    }));
}

function hnAlerts(ctx: RuleContext): AlertMessage[] {
  const s = STRINGS[ctx.lang];
  return ctx.db
    .select()
    .from(items)
    .where(
      and(
        gte(items.hnPoints, ctx.thresholds.hnPoints),
        gte(items.fetchedAt, new Date(ctx.now.getTime() - LOOKBACK.itemMs)),
      ),
    )
    .orderBy(desc(items.hnPoints))
    .limit(PER_RULE)
    .all()
    .map((row) => {
      const external = row.extraJson?.['externalId'];
      return {
        key:
          typeof external === 'string' && external.startsWith('hn:')
            ? external
            : `hn:item-${String(row.id)}`,
        covers: [],
        rule: 'hn' as const,
        headline: s.hn(String(row.hnPoints ?? 0)),
        lines: [row.title],
        url: row.url,
      };
    });
}

/** Every alert the rules of SPEC § 7.10 currently produce, most urgent first. */
export function findAlerts(ctx: RuleContext): AlertMessage[] {
  return [
    ...kevAlerts(ctx),
    ...criticalAlerts(ctx),
    ...breachAlerts(ctx),
    ...certFrAlerts(ctx),
    ...hnAlerts(ctx),
  ];
}

export function digestMessage(
  key: string,
  queued: AlertMessage[],
  lang: Lang,
  publicUrl: string | undefined,
): AlertMessage {
  const s = STRINGS[lang];
  const shown = queued.slice(0, 15);
  return {
    key,
    covers: [],
    rule: 'digest',
    headline: s.digest(queued.length),
    lines: [
      ...shown.map((m) => `• ${m.headline} — ${m.lines[0] ?? ''}`),
      ...(queued.length > shown.length ? [s.more(queued.length - shown.length)] : []),
    ],
    url: publicUrl === undefined ? null : `${publicUrl}/brief`,
  };
}

export function testMessage(lang: Lang, publicUrl: string | undefined): AlertMessage {
  const s = STRINGS[lang];
  return {
    key: 'test',
    covers: [],
    rule: 'test',
    headline: s.test,
    lines: [s.testLine],
    url: publicUrl ?? null,
  };
}
