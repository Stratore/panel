import { parseFeed, type FeedEntry } from '@panel/safe-fetch';
import type { NormalizedItem } from '@panel/shared';
import type { NormalizeContext, SourceAdapter } from './types.js';
import { fetchConditional, iso, parseDate, plainSummary, plainTitle } from './util.js';

const VERSION = /\bv?(\d{1,4}\.\d{1,4}\.\d{1,4}|\d{1,4}\.\d{1,4})/i;
const SECURITY_HINT = /\b(?:security|sécurité|cve-\d{4})/i;

function toItem(entry: FeedEntry, ctx: NormalizeContext): NormalizedItem | null {
  const title = plainTitle(entry.title);
  if (title === '') return null;
  const publishedAt = iso(parseDate(entry.date, ctx.now));

  if (ctx.source.kind === 'release') {
    const version = VERSION.exec(title)?.[1];
    if (version === undefined) return null;
    return {
      kind: 'release',
      product: ctx.source.product ?? ctx.source.name,
      version,
      isSecurity: SECURITY_HINT.test(`${title} ${entry.summary}`),
      url: entry.link,
      publishedAt,
    };
  }

  return {
    kind: 'article',
    url: entry.link,
    title,
    summary: plainSummary(entry.summary),
    lang: ctx.source.lang,
    publishedAt,
    ...(entry.author === undefined ? {} : { author: entry.author }),
    ...(entry.id === '' ? {} : { externalId: entry.id.slice(0, 200) }),
  };
}

/** Generic RSS/Atom adapter, used by every feed including custom sources (SPEC § 7.1). */
export const rssAdapter: SourceAdapter<string> = {
  id: 'rss',
  fetch: (ctx) => fetchConditional(ctx, ctx.source.url),
  normalize(raw, ctx) {
    return parseFeed(raw, ctx.source.url)
      .entries.map((entry) => toItem(entry, ctx))
      .filter((item): item is NormalizedItem => item !== null);
  },
};
