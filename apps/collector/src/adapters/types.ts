import type { SafeFetchResponse } from '@panel/safe-fetch';
import type { Category, ItemKind, Lang, NormalizedItem, SourceDefinition } from '@panel/shared';

export type AdapterId = SourceDefinition['adapter'];

/** The subset of a `sources` row adapters may read. */
export interface SourceConfig {
  id: string;
  name: string;
  kind: ItemKind;
  adapter: AdapterId;
  url: string;
  lang: Lang;
  categoryDefault: Category | null;
  product: string | null;
  isCustom: boolean;
  etag: string | null;
  /** HTTP Last-Modified for conditional sources; incremental cursor for NVD. */
  lastModified: string | null;
}

export interface AdapterFetchOptions {
  headers?: Readonly<Record<string, string>>;
  /** Sends If-None-Match / If-Modified-Since from the source's stored validators. */
  conditional?: boolean;
}

export interface FetchContext {
  source: SourceConfig;
  now: Date;
  /**
   * safeFetch with the source's trust level, retries and backoff already applied.
   * Resolves with 2xx or 304 responses; any other status rejects with `HttpStatusError`.
   */
  fetch(url: string, options?: AdapterFetchOptions): Promise<SafeFetchResponse>;
  secrets: { nvdApiKey?: string | undefined; githubToken?: string | undefined };
  /** CVE ids whose EPSS score is missing or stale. */
  cveIdsForEpss(limit: number): string[];
  sleep(ms: number): Promise<void>;
}

export type FetchResult<Raw> =
  | { status: 'not_modified'; httpStatus: 304; bytes: 0 }
  | {
      status: 'ok';
      raw: Raw;
      httpStatus: number;
      bytes: number;
      etag?: string | undefined;
      lastModified?: string | undefined;
    };

export interface NormalizeContext {
  source: SourceConfig;
  now: Date;
}

/**
 * SPEC § 7.1. `normalize` returns candidates; the runner validates every one with
 * `normalizedItemSchema` and drops the invalid ones, so an adapter bug cannot store bad data.
 */
export interface SourceAdapter<Raw = unknown> {
  id: AdapterId;
  fetch(ctx: FetchContext): Promise<FetchResult<Raw>>;
  normalize(raw: Raw, ctx: NormalizeContext): NormalizedItem[];
}

export class AdapterError extends Error {
  override readonly name = 'AdapterError';
}
