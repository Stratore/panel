import { z } from 'zod';
import { severityFromCvss, type NormalizedItem } from '@panel/shared';
import type { SourceAdapter } from './types.js';
import { parseJson, plainSummary } from './util.js';

/** NVD API 2.0 constraints (SPEC § 6.1). */
export const NVD = {
  maxWindowDays: 120,
  firstRunDays: 7,
  /** 2000 is the API maximum, but such pages exceed safeFetch's 5 MB cap (ADR-020). */
  resultsPerPage: 200,
  maxPagesPerRun: 50,
  pauseWithKeyMs: 2_000,
  pauseWithoutKeyMs: 6_000,
} as const;

const cvssData = z.object({
  baseScore: z.number().min(0).max(10),
  vectorString: z.string().max(200),
  version: z.string().max(5),
  baseSeverity: z.string().optional(),
});
const metric = z.object({
  type: z.string().optional(),
  cvssData,
  baseSeverity: z.string().optional(),
});

const cpeMatch = z.object({
  vulnerable: z.boolean(),
  criteria: z.string().max(300),
  versionStartIncluding: z.string().max(50).optional(),
  versionStartExcluding: z.string().max(50).optional(),
  versionEndIncluding: z.string().max(50).optional(),
  versionEndExcluding: z.string().max(50).optional(),
});

const nvdCve = z.object({
  id: z.string(),
  published: z.string(),
  lastModified: z.string(),
  vulnStatus: z.string().optional(),
  descriptions: z.array(z.object({ lang: z.string(), value: z.string().max(10_000) })).max(20),
  metrics: z
    .object({
      cvssMetricV40: z.array(metric).max(10).optional(),
      cvssMetricV31: z.array(metric).max(10).optional(),
      cvssMetricV30: z.array(metric).max(10).optional(),
      cvssMetricV2: z.array(metric).max(10).optional(),
    })
    .optional(),
  weaknesses: z
    .array(
      z.object({
        type: z.string().optional(),
        description: z.array(z.object({ value: z.string() })).max(20),
      }),
    )
    .max(20)
    .optional(),
  configurations: z
    .array(
      z.object({
        nodes: z.array(z.object({ cpeMatch: z.array(cpeMatch).max(1000).optional() })).max(100),
      }),
    )
    .max(50)
    .optional(),
  references: z
    .array(z.object({ url: z.string(), tags: z.array(z.string()).max(20).optional() }))
    .max(500)
    .optional(),
});
type NvdCve = z.infer<typeof nvdCve>;

const nvdPage = z.object({
  resultsPerPage: z.number(),
  startIndex: z.number(),
  totalResults: z.number(),
  vulnerabilities: z.array(z.object({ cve: z.unknown() })).max(NVD.resultsPerPage),
});

/** NVD expects ISO 8601 with an explicit offset. */
const nvdDate = (date: Date) => date.toISOString().replace('Z', '+00:00');

export interface NvdRaw {
  vulnerabilities: unknown[];
  /** End of the window fetched: the next run's lastModStartDate. */
  cursor: string;
}

const KNOWN_PRODUCTS: Readonly<Record<string, string>> = {
  php: 'PHP',
  'node.js': 'Node.js',
  openssh: 'OpenSSH',
  linux_kernel: 'Linux kernel',
  wordpress: 'WordPress',
  chrome: 'Chrome',
  firefox: 'Firefox',
  safari: 'Safari',
  docker: 'Docker',
  python: 'Python',
  windows: 'Windows',
};

function prettyProduct(cpe: string): string | null {
  const product = cpe.split(':')[4];
  if (product === undefined || product === '' || product === '*') return null;
  const known = Object.hasOwn(KNOWN_PRODUCTS, product) ? KNOWN_PRODUCTS[product] : undefined;
  if (known !== undefined) return known;
  const spaced = product.replace(/_/g, ' ');
  return (spaced.charAt(0).toUpperCase() + spaced.slice(1)).slice(0, 80);
}

function rangeOf(m: z.infer<typeof cpeMatch>): string | null {
  const start = m.versionStartIncluding ?? m.versionStartExcluding;
  if (m.versionEndExcluding !== undefined) {
    return start === undefined
      ? `< ${m.versionEndExcluding}`
      : `${start} – < ${m.versionEndExcluding}`;
  }
  if (m.versionEndIncluding !== undefined) {
    return start === undefined
      ? `≤ ${m.versionEndIncluding}`
      : `${start} – ${m.versionEndIncluding}`;
  }
  const version = m.criteria.split(':')[5];
  return version !== undefined && version !== '*' && version !== '-' ? version : null;
}

function bestMetric(cve: NvdCve) {
  const m = cve.metrics;
  const ordered = [m?.cvssMetricV31, m?.cvssMetricV30, m?.cvssMetricV40, m?.cvssMetricV2];
  for (const list of ordered) {
    const pick = list?.find((x) => x.type === 'Primary') ?? list?.[0];
    if (pick) return pick;
  }
  return undefined;
}

const unique = (values: (string | null)[]) => [
  ...new Set(values.filter((v): v is string => v !== null)),
];

/** NVD timestamps have no offset and are UTC. */
function nvdTimestamp(raw: string): string | null {
  const time = Date.parse(/(?:[zZ]|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw}Z`);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function normalizeNvdCve(cve: NvdCve): NormalizedItem | null {
  const published = nvdTimestamp(cve.published);
  const modified = nvdTimestamp(cve.lastModified);
  if (cve.vulnStatus === 'Rejected' || published === null || modified === null) return null;
  const chosen = bestMetric(cve);
  const version = chosen?.cvssData.version;
  const cvss = chosen?.cvssData.baseScore ?? null;

  const weaknesses = [...(cve.weaknesses ?? [])].sort((a) => (a.type === 'Primary' ? -1 : 1));
  const cwe =
    weaknesses
      .flatMap((w) => w.description.map((d) => d.value))
      .find((v) => /^CWE-\d{1,5}$/.test(v)) ?? null;

  const matches = (cve.configurations ?? [])
    .flatMap((c) => c.nodes)
    .flatMap((n) => n.cpeMatch ?? [])
    .filter((m) => m.vulnerable);
  const cpes = unique(matches.map((m) => m.criteria)).slice(0, 500);
  const fixes = unique(matches.map((m) => m.versionEndExcluding ?? null)).slice(0, 3);
  const references = (cve.references ?? []).filter((r) => /^https?:\/\//i.test(r.url));

  return {
    kind: 'cve',
    cveId: cve.id,
    url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
    description: plainSummary(cve.descriptions.find((d) => d.lang === 'en')?.value ?? ''),
    cvss,
    cvssVersion:
      version === '2.0' || version === '3.0' || version === '3.1' || version === '4.0'
        ? version
        : null,
    vector: chosen?.cvssData.vectorString ?? null,
    severity: cvss === null ? null : severityFromCvss(cvss),
    cwe,
    cpes,
    references: references.slice(0, 100).map((r) => r.url),
    published,
    modified,
    product: cpes[0] === undefined ? null : prettyProduct(cpes[0]),
    affected: unique(matches.map(rangeOf)).slice(0, 20),
    fixedVersions: fixes.length > 0 ? fixes.join(' · ') : null,
    hasPublicExploit: references.some((r) => r.tags?.includes('Exploit') === true),
  };
}

/**
 * Incremental sync by last-modified window (≤ 120 days), paginated with the mandated pause
 * between pages. The API key travels in the `apiKey` header, never in the URL.
 */
interface NvdWindow {
  start: Date;
  end: Date;
  startIndex: number;
}

const RESUME_PREFIX = 'resume:';

/**
 * The cursor (stored in `sources.last_modified`) is either the end of the last complete
 * window (ISO date) or `resume:<start>|<end>|<startIndex>` when a window was too large for
 * one run, so the next run continues on the exact page instead of skipping results.
 */
export function nextNvdWindow(cursor: string | null, now: Date): NvdWindow {
  if (cursor?.startsWith(RESUME_PREFIX)) {
    const [start = '', end = '', index = ''] = cursor.slice(RESUME_PREFIX.length).split('|');
    const window = { start: new Date(start), end: new Date(end), startIndex: Number(index) };
    const valid =
      !Number.isNaN(window.start.getTime()) &&
      !Number.isNaN(window.end.getTime()) &&
      Number.isInteger(window.startIndex) &&
      window.startIndex >= 0;
    if (valid) return window;
  }
  // Strict ISO only: Date.parse is lenient enough to read a year out of garbage.
  const last =
    cursor !== null && /^\d{4}-\d\d-\d\dT/.test(cursor) ? Date.parse(cursor) : Number.NaN;
  const start = Number.isNaN(last)
    ? new Date(now.getTime() - NVD.firstRunDays * 86_400_000)
    : new Date(last);
  const end = new Date(Math.min(now.getTime(), start.getTime() + NVD.maxWindowDays * 86_400_000));
  return { start, end, startIndex: 0 };
}

export const nvdAdapter: SourceAdapter<NvdRaw> = {
  id: 'nvd',
  async fetch(ctx) {
    const { start, end, startIndex: firstIndex } = nextNvdWindow(ctx.source.lastModified, ctx.now);
    const headers = ctx.secrets.nvdApiKey ? { apiKey: ctx.secrets.nvdApiKey } : undefined;
    const pause = ctx.secrets.nvdApiKey ? NVD.pauseWithKeyMs : NVD.pauseWithoutKeyMs;

    const vulnerabilities: unknown[] = [];
    let bytes = 0;
    let startIndex = firstIndex;
    let complete = false;
    for (let page = 0; page < NVD.maxPagesPerRun; page++) {
      if (page > 0) await ctx.sleep(pause);
      const url = new URL(ctx.source.url);
      url.searchParams.set('lastModStartDate', nvdDate(start));
      url.searchParams.set('lastModEndDate', nvdDate(end));
      url.searchParams.set('resultsPerPage', String(NVD.resultsPerPage));
      url.searchParams.set('startIndex', String(startIndex));
      const response = await ctx.fetch(url.href, headers ? { headers } : {});
      bytes += response.bytes;
      const data = nvdPage.parse(parseJson(response.body));
      vulnerabilities.push(...data.vulnerabilities.map((v) => v.cve));
      startIndex += data.vulnerabilities.length;
      if (data.vulnerabilities.length === 0 || startIndex >= data.totalResults) {
        complete = true;
        break;
      }
    }
    const cursor = complete
      ? end.toISOString()
      : `${RESUME_PREFIX}${start.toISOString()}|${end.toISOString()}|${String(startIndex)}`;
    return {
      status: 'ok',
      raw: { vulnerabilities, cursor },
      httpStatus: 200,
      bytes,
      lastModified: cursor,
    };
  },
  normalize(raw) {
    return raw.vulnerabilities.flatMap((value) => {
      const parsed = nvdCve.safeParse(value);
      if (!parsed.success) return [];
      const item = normalizeNvdCve(parsed.data);
      return item ? [item] : [];
    });
  },
};
