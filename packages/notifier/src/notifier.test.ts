import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSourcesCatalog,
  migrateDatabase,
  openDatabase,
  schema,
  seedDatabase,
  type DatabaseHandle,
} from '@panel/db';
import { DEFAULT_PREFS, formatEpss, type Prefs } from '@panel/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotifierError, type AlertChannel, type Channel } from './channels.js';
import type { AlertMessage } from './message.js';
import { queuedAlerts, runAlerts, sendTestAlert, type AlertRunDeps } from './notifier.js';
import { certFrId } from './rules.js';

const catalog = fileURLToPath(new URL('../../../config/sources.default.json', import.meta.url));

let dir: string;
let handle: DatabaseHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'panel-notifier-'));
  handle = openDatabase(join(dir, 'panel.db'));
  migrateDatabase(handle.db);
  seedDatabase(handle.db, loadSourcesCatalog(catalog));
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A channel that records what it was asked to send and can be told to fail. */
function fakeChannel(name: AlertChannel): Channel & { sent: AlertMessage[]; failing: boolean } {
  const channel = {
    name,
    sent: [] as AlertMessage[],
    failing: false,
    send(message: AlertMessage) {
      if (channel.failing) return Promise.reject(new NotifierError(name, 'HTTP 500'));
      channel.sent.push(message);
      return Promise.resolve();
    },
  };
  return channel;
}

// Midday UTC: outside quiet hours and outside the digest window (08:00 + 3 h).
const NOON = new Date('2026-11-09T12:00:00Z');
const at = (iso: string) => new Date(iso);

function setPrefs(alerts: Partial<Prefs['alerts']> = {}, lang: Prefs['lang'] = 'en') {
  handle.db
    .insert(schema.prefs)
    .values({
      key: 'prefs',
      valueJson: { ...DEFAULT_PREFS, lang, alerts: { ...DEFAULT_PREFS.alerts, ...alerts } },
    })
    .onConflictDoUpdate({
      target: schema.prefs.key,
      set: {
        valueJson: { ...DEFAULT_PREFS, lang, alerts: { ...DEFAULT_PREFS.alerts, ...alerts } },
      },
    })
    .run();
}

function addKev(n: number, day = '2026-11-09', published = at('2026-11-08T12:00:00Z')) {
  handle.db
    .insert(schema.cves)
    .values(
      Array.from({ length: n }, (_, i) => ({
        cveId: `CVE-2026-${String(41000 + i)}`,
        product: 'PHP',
        cvss: 9.8,
        severity: 'critical' as const,
        epss: 0.94,
        kev: true,
        kevAdded: day,
        cwe: 'CWE-787',
        fixedVersions: '8.3.14 · 8.2.27',
        watchlistJson: ['PHP'],
        published,
        priority: 90 - i,
      })),
    )
    .run();
}

function deps(channels: Channel[], now = NOON): AlertRunDeps {
  return {
    db: handle.db,
    channels,
    now,
    timeZone: 'UTC',
    publicUrl: 'https://panel.example.org',
  };
}

describe('runAlerts', () => {
  it('does nothing without a configured channel', async () => {
    addKev(1);
    expect(await runAlerts(deps([]))).toEqual({ sent: 0, queued: 0, failed: 0, digest: false });
  });

  it('sends a KEV alert once to every channel, in the reference format', async () => {
    addKev(1);
    const discord = fakeChannel('discord');
    const telegram = fakeChannel('telegram');
    expect(await runAlerts(deps([discord, telegram]))).toMatchObject({ sent: 1, queued: 0 });
    expect(discord.sent).toHaveLength(1);
    expect(telegram.sent).toHaveLength(1);
    expect(discord.sent[0]).toMatchObject({
      key: 'kev:CVE-2026-41000',
      // The KEV alert settles the "critical" alert of the same CVE.
      covers: ['crit:CVE-2026-41000'],
      headline: 'KEV · CRITICAL 9.8 · EPSS 94%',
      lines: [
        'CVE-2026-41000 — PHP < 8.3.14 · Out-of-bounds write',
        'Fix: upgrade to 8.3.14 · Watchlist: PHP',
      ],
      url: 'https://panel.example.org/threats/CVE-2026-41000',
    });

    expect(await runAlerts(deps([discord, telegram]))).toMatchObject({ sent: 0, queued: 0 });
    expect(discord.sent).toHaveLength(1);
  });

  it('sends no duplicate after a restart (state lives in the database)', async () => {
    addKev(2);
    await runAlerts(deps([fakeChannel('discord')]));
    handle.close();
    handle = openDatabase(join(dir, 'panel.db'));
    const fresh = fakeChannel('discord');
    await runAlerts(deps([fresh], at('2026-11-09T12:05:00Z')));
    expect(fresh.sent).toEqual([]);
  });

  it('writes French alerts when the instance language is French', async () => {
    setPrefs({}, 'fr');
    addKev(1);
    const discord = fakeChannel('discord');
    await runAlerts(deps([discord]));
    expect(discord.sent[0]?.headline).toBe(`KEV · CRITIQUE 9,8 · EPSS ${formatEpss(0.94, 'fr')}`);
    expect(discord.sent[0]?.lines[1]).toBe(
      'Correctif : mettre à jour vers 8.3.14 · Watchlist : PHP',
    );
  });

  it('caps alerts per hour and queues the rest for the digest', async () => {
    addKev(7);
    const discord = fakeChannel('discord');
    expect(await runAlerts(deps([discord]))).toMatchObject({ sent: 5, queued: 2 });
    expect(queuedAlerts(handle.db)).toBe(2);
    // Later in the same hour: still capped, nothing new queued twice.
    expect(await runAlerts(deps([discord], at('2026-11-09T12:30:00Z')))).toMatchObject({
      sent: 0,
      queued: 0,
    });
    expect(discord.sent).toHaveLength(5);
  });

  it('honours a custom hourly limit', async () => {
    setPrefs({ maxPerHour: 2 });
    addKev(3);
    const discord = fakeChannel('discord');
    expect(await runAlerts(deps([discord]))).toMatchObject({ sent: 2, queued: 1 });
  });

  it('holds everything back during quiet hours, then sends it in the 08:00 digest', async () => {
    addKev(3);
    const discord = fakeChannel('discord');
    const telegram = fakeChannel('telegram');
    const channels = [discord, telegram];

    expect(await runAlerts(deps(channels, at('2026-11-09T23:30:00Z')))).toMatchObject({
      sent: 0,
      queued: 3,
    });
    expect(await runAlerts(deps(channels, at('2026-11-10T06:59:00Z')))).toMatchObject({
      sent: 0,
      queued: 0,
      digest: false,
    });

    // 07:00: quiet hours are over, but queued alerts wait for the digest.
    expect(await runAlerts(deps(channels, at('2026-11-10T07:00:00Z')))).toMatchObject({ sent: 0 });

    expect(await runAlerts(deps(channels, at('2026-11-10T08:00:00Z')))).toMatchObject({
      digest: true,
    });
    for (const channel of channels) {
      expect(channel.sent).toHaveLength(1);
      expect(channel.sent[0]).toMatchObject({
        rule: 'digest',
        headline: 'Daily digest · 3 held-back alerts',
        url: 'https://panel.example.org/brief',
      });
      expect(channel.sent[0]?.lines).toHaveLength(3);
    }
    expect(queuedAlerts(handle.db)).toBe(0);

    // Nothing is sent twice: not the digest, not the alerts it contained.
    expect(await runAlerts(deps(channels, at('2026-11-10T08:01:00Z')))).toMatchObject({
      sent: 0,
      digest: false,
    });
    expect(discord.sent).toHaveLength(1);
  });

  it('never sends a digest outside its window (late restart)', async () => {
    addKev(7);
    const discord = fakeChannel('discord');
    await runAlerts(deps([discord])); // 12:00: 5 sent, 2 queued
    expect(discord.sent.filter((m) => m.rule === 'digest')).toEqual([]);
    await runAlerts(deps([discord], at('2026-11-10T08:00:00Z')));
    expect(discord.sent.filter((m) => m.rule === 'digest')).toHaveLength(1);
  });

  it('retries only the channel that failed, without counting it twice', async () => {
    addKev(1);
    const discord = fakeChannel('discord');
    const telegram = fakeChannel('telegram');
    telegram.failing = true;
    expect(await runAlerts(deps([discord, telegram]))).toMatchObject({ sent: 1, failed: 1 });

    telegram.failing = false;
    expect(await runAlerts(deps([discord, telegram], at('2026-11-09T12:01:00Z')))).toMatchObject({
      sent: 0,
      failed: 0,
    });
    expect(discord.sent).toHaveLength(1);
    expect(telegram.sent).toHaveLength(1);
  });

  it('ignores rows older than the lookback window', async () => {
    addKev(1, '2026-10-01', at('2026-09-30T12:00:00Z'));
    const discord = fakeChannel('discord');
    await runAlerts(deps([discord]));
    expect(discord.sent).toEqual([]);
  });

  it('alerts on critical watchlist CVEs, big breaches, CERT-FR alerts and HN stories', async () => {
    const recent = at('2026-11-09T09:00:00Z');
    handle.db
      .insert(schema.cves)
      .values([
        // CVSS 9.1, low EPSS but on the watchlist: alert.
        {
          cveId: 'CVE-2026-50001',
          product: 'Docker',
          cvss: 9.1,
          epss: 0.02,
          watchlistJson: ['Docker'],
          published: recent,
        },
        // CVSS 9.1, low EPSS, not on the watchlist: no alert.
        { cveId: 'CVE-2026-50002', product: 'Other', cvss: 9.1, epss: 0.02, published: recent },
        // High EPSS but CVSS below the threshold: no alert.
        { cveId: 'CVE-2026-50003', product: 'Other', cvss: 7.5, epss: 0.9, published: recent },
      ])
      .run();
    handle.db
      .insert(schema.breaches)
      .values([
        {
          name: 'Northwind',
          title: 'Northwind Retail',
          domain: 'northwind.example',
          accounts: 12_400_000,
          isVerified: true,
          isSensitive: false,
          dataClassesJson: ['Email addresses', 'Passwords'],
          breachDate: '2026-10-01',
          addedDate: recent,
        },
        {
          name: 'Tiny',
          title: 'Tiny Shop',
          accounts: 5_000,
          isVerified: true,
          isSensitive: false,
          breachDate: '2026-10-01',
          addedDate: recent,
        },
      ])
      .run();
    const item = (id: number, sourceId: string, url: string, hnPoints: number | null) => ({
      id,
      sourceId,
      kind: 'article' as const,
      url,
      urlHash: `h${String(id)}`,
      title: `Title ${String(id)} @everyone <b>`,
      lang: 'en' as const,
      publishedAt: recent,
      fetchedAt: recent,
      category: 'cyber' as const,
      hnPoints,
      extraJson: hnPoints === null ? null : { externalId: `hn:${String(9000 + id)}` },
    });
    handle.db
      .insert(schema.items)
      .values([
        item(1, 'cert-fr-alertes', 'https://cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-012/', null),
        item(2, 'cert-fr-avis', 'https://cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-0999/', null),
        item(3, 'hn', 'https://news.example.org/big', 612),
        item(4, 'hn', 'https://news.example.org/small', 120),
      ])
      .run();

    const discord = fakeChannel('discord');
    await runAlerts(deps([discord]));
    expect(discord.sent.map((m) => m.key)).toEqual([
      'crit:CVE-2026-50001',
      'breach:Northwind',
      'certfr:CERTFR-2026-ALE-012',
      'hn:9003',
    ]);
    expect(discord.sent[1]).toMatchObject({
      headline: 'BREACH · 12.4M accounts',
      lines: ['Northwind Retail (northwind.example)', 'Exposed: Email addresses, Passwords'],
    });
    expect(discord.sent[3]?.headline).toBe('HACKER NEWS · 612 points');
  });
});

describe('helpers', () => {
  it('extracts the CERT-FR identifier from its URL', () => {
    expect(certFrId('https://cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-012/', 4)).toBe(
      'CERTFR-2026-ALE-012',
    );
    expect(certFrId('not a url', 4)).toBe('item-4');
  });

  it('reports which channels accepted the test alert', async () => {
    const discord = fakeChannel('discord');
    const telegram = fakeChannel('telegram');
    telegram.failing = true;
    expect(await sendTestAlert([discord, telegram], 'en', undefined)).toEqual({
      sent: ['discord'],
      failed: ['telegram'],
    });
    expect(discord.sent[0]).toMatchObject({ rule: 'test', headline: 'Test alert', url: null });
  });
});
