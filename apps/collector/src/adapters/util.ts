import { textOf, toPlainText } from '@panel/safe-fetch';
import { LIMITS } from '@panel/shared';
import { AdapterError, type FetchContext, type FetchResult } from './types.js';

export const plainTitle = (raw: string): string => toPlainText(raw, LIMITS.titleLength);
export const plainSummary = (raw: string): string => toPlainText(raw, LIMITS.summaryLength);

/** Parses a feed date; missing, invalid or future dates (beyond 1 h of skew) fall back to `now`. */
export function parseDate(raw: unknown, now: Date): Date {
  const text = textOf(raw).trim();
  const time = text === '' ? Number.NaN : Date.parse(text);
  if (Number.isNaN(time) || time > now.getTime() + 3_600_000) return now;
  return new Date(time);
}

export const iso = (date: Date): string => date.toISOString();

export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (cause) {
    throw new AdapterError('Response is not valid JSON', { cause });
  }
}

/** GET with the source's ETag/Last-Modified; a 304 short-circuits all processing. */
export async function fetchConditional(
  ctx: FetchContext,
  url: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<FetchResult<string>> {
  const response = await ctx.fetch(url, { headers, conditional: true });
  if (response.status === 304) return { status: 'not_modified', httpStatus: 304, bytes: 0 };
  return {
    status: 'ok',
    raw: response.body,
    httpStatus: response.status,
    bytes: response.bytes,
    etag: response.headers['etag'],
    lastModified: response.headers['last-modified'],
  };
}

export function githubHeaders(ctx: FetchContext): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json, application/json',
    'x-github-api-version': '2022-11-28',
  };
  if (ctx.secrets.githubToken) headers['authorization'] = `Bearer ${ctx.secrets.githubToken}`;
  return headers;
}
