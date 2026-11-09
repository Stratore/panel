import { z } from 'zod';
import type { NormalizedItem } from '@panel/shared';
import type { SourceAdapter } from './types.js';
import { fetchConditional, githubHeaders, parseJson, plainTitle } from './util.js';

// ---------------------------------------------------------------------------------------------
// CISA Known Exploited Vulnerabilities
// ---------------------------------------------------------------------------------------------

const kevEntry = z.object({
  cveID: z.string(),
  vendorProject: z.string().max(200),
  product: z.string().max(200),
  vulnerabilityName: z.string().max(1000),
  dateAdded: z.string(),
  dueDate: z.string().optional(),
  knownRansomwareCampaignUse: z.string().optional(),
  cwes: z.array(z.string()).optional(),
});
const kevCatalog = z.object({ vulnerabilities: z.array(z.unknown()).max(10_000) });

export const kevAdapter: SourceAdapter<string> = {
  id: 'cisa-kev',
  fetch: (ctx) => fetchConditional(ctx, ctx.source.url),
  normalize(raw) {
    const catalog = kevCatalog.parse(parseJson(raw));
    return catalog.vulnerabilities.flatMap((value): NormalizedItem[] => {
      const entry = kevEntry.safeParse(value);
      if (!entry.success) return [];
      const e = entry.data;
      return [
        {
          kind: 'cve-kev',
          cveId: e.cveID.trim(),
          product: plainTitle(e.product).slice(0, 80),
          name: plainTitle(e.vulnerabilityName),
          dateAdded: e.dateAdded,
          dueDate: e.dueDate ?? null,
          ransomware: e.knownRansomwareCampaignUse?.toLowerCase() === 'known',
          cwe: e.cwes?.find((cwe) => /^CWE-\d{1,5}$/.test(cwe)) ?? null,
        },
      ];
    });
  },
};

// ---------------------------------------------------------------------------------------------
// FIRST EPSS: scores fetched for CVEs we already know, in batches
// ---------------------------------------------------------------------------------------------

export const EPSS_BATCH = 100;
export const EPSS_MAX_PER_RUN = 1000;
/** The API answers 400 to back-to-back requests: space the batches out. */
export const EPSS_PAUSE_MS = 2_000;

const epssResponse = z.object({
  data: z
    .array(
      z.object({ cve: z.string(), epss: z.string(), percentile: z.string(), date: z.string() }),
    )
    .max(EPSS_BATCH * 2),
});
type EpssRow = z.infer<typeof epssResponse>['data'][number];

export const epssAdapter: SourceAdapter<EpssRow[]> = {
  id: 'epss',
  async fetch(ctx) {
    const ids = ctx.cveIdsForEpss(EPSS_MAX_PER_RUN);
    const rows: EpssRow[] = [];
    let bytes = 0;
    for (let i = 0; i < ids.length; i += EPSS_BATCH) {
      if (i > 0) await ctx.sleep(EPSS_PAUSE_MS);
      const url = new URL(ctx.source.url);
      url.searchParams.set('cve', ids.slice(i, i + EPSS_BATCH).join(','));
      const response = await ctx.fetch(url.href);
      bytes += response.bytes;
      rows.push(...epssResponse.parse(parseJson(response.body)).data);
    }
    return { status: 'ok', raw: rows, httpStatus: 200, bytes };
  },
  normalize(rows) {
    return rows.map((row): NormalizedItem => ({
      kind: 'cve-epss',
      cveId: row.cve,
      epss: Number(row.epss),
      percentile: Number(row.percentile),
      date: row.date,
    }));
  },
};

// ---------------------------------------------------------------------------------------------
// GitHub Advisory Database
// ---------------------------------------------------------------------------------------------

const ghsaAdvisory = z.object({
  ghsa_id: z.string(),
  cve_id: z.string().nullable(),
  html_url: z.string(),
  severity: z.string().nullable(),
  vulnerabilities: z
    .array(
      z.object({
        package: z.object({ name: z.string().max(200) }).nullable(),
        first_patched_version: z.string().max(100).nullable(),
      }),
    )
    .max(200)
    .nullable(),
});
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

export const ghsaAdapter: SourceAdapter<string> = {
  id: 'ghsa',
  fetch: (ctx) => fetchConditional(ctx, ctx.source.url, githubHeaders(ctx)),
  normalize(raw) {
    const list = z.array(z.unknown()).max(500).parse(parseJson(raw));
    return list.flatMap((value): NormalizedItem[] => {
      const parsed = ghsaAdvisory.safeParse(value);
      if (!parsed.success) return [];
      const a = parsed.data;
      if (a.cve_id === null) return [];
      const cveId = a.cve_id;
      const vulns = a.vulnerabilities ?? [];
      const fixes = [
        ...new Set(vulns.map((v) => v.first_patched_version).filter((v): v is string => !!v)),
      ];
      const severity = a.severity !== null && SEVERITIES.has(a.severity) ? a.severity : null;
      return [
        {
          kind: 'cve-ghsa',
          cveId,
          ghsaId: a.ghsa_id,
          severity: severity as 'critical' | 'high' | 'medium' | 'low' | null,
          product: vulns[0]?.package?.name.slice(0, 80) ?? null,
          fixedVersions: fixes.length > 0 ? fixes.slice(0, 3).join(' · ') : null,
          url: a.html_url,
        },
      ];
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Have I Been Pwned (breach metadata, CC BY 4.0 — attribution shown in the UI)
// ---------------------------------------------------------------------------------------------

const hibpBreach = z.object({
  Name: z.string().max(200),
  Title: z.string().max(300),
  Domain: z.string().max(253),
  BreachDate: z.string(),
  AddedDate: z.string(),
  PwnCount: z.number(),
  DataClasses: z.array(z.string().max(100)).max(100),
  IsVerified: z.boolean(),
  IsSensitive: z.boolean(),
  IsFabricated: z.boolean().optional(),
  IsSpamList: z.boolean().optional(),
});

export const hibpAdapter: SourceAdapter<string> = {
  id: 'hibp',
  fetch: (ctx) => fetchConditional(ctx, ctx.source.url),
  normalize(raw) {
    const list = z.array(z.unknown()).max(5000).parse(parseJson(raw));
    return list.flatMap((value): NormalizedItem[] => {
      const parsed = hibpBreach.safeParse(value);
      if (!parsed.success || parsed.data.IsFabricated === true || parsed.data.IsSpamList === true) {
        return [];
      }
      const b = parsed.data;
      const added = Date.parse(b.AddedDate);
      if (Number.isNaN(added)) return [];
      return [
        {
          kind: 'breach',
          name: b.Name,
          title: plainTitle(b.Title),
          domain: b.Domain,
          accounts: Math.max(0, Math.trunc(b.PwnCount)),
          dataClasses: b.DataClasses.map((c) => plainTitle(c)),
          breachDate: b.BreachDate,
          addedDate: new Date(added).toISOString(),
          isVerified: b.IsVerified,
          isSensitive: b.IsSensitive,
        },
      ];
    });
  },
};
