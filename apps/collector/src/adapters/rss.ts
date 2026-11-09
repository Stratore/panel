import { parseXmlSafe } from '@panel/safe-fetch';
import { LIMITS, type NormalizedItem } from '@panel/shared';
import type { NormalizeContext, SourceAdapter } from './types.js';
import {
  asArray,
  fetchConditional,
  iso,
  parseDate,
  plainSummary,
  plainTitle,
  textOf,
} from './util.js';

type XmlNode = Record<string, unknown>;

interface FeedEntry {
  title: string;
  link: string;
  summary: string;
  author: string | undefined;
  date: unknown;
  id: string;
}

const isNode = (value: unknown): value is XmlNode =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Atom links are `<link href rel>` elements; RSS links are text. Relative links (php.net)
 * are resolved against the feed URL; the result is still validated as an http(s) URL later.
 */
function linkOf(value: unknown, base: string): string {
  const links = asArray(value);
  const alternate =
    links.find((l) => isNode(l) && (l['@_rel'] === undefined || l['@_rel'] === 'alternate')) ??
    links[0];
  const raw =
    isNode(alternate) && typeof alternate['@_href'] === 'string'
      ? alternate['@_href']
      : textOf(alternate).trim();
  return URL.canParse(raw, base) ? new URL(raw, base).href : raw;
}

function authorOf(item: XmlNode): string | undefined {
  const raw = item['author'] ?? item['dc:creator'];
  const name = isNode(raw) && 'name' in raw ? textOf(raw['name']) : textOf(raw);
  const clean = plainTitle(name).slice(0, 120);
  return clean === '' ? undefined : clean;
}

/** Extracts entries from RSS 2.0, Atom 1.0 or RSS 1.0 (RDF), capped at 200 (SPEC § 9.3). */
export function extractEntries(doc: unknown, base: string): FeedEntry[] {
  if (!isNode(doc)) return [];
  const rss = isNode(doc['rss']) && isNode(doc['rss']['channel']) ? doc['rss']['channel'] : null;
  const feed = isNode(doc['feed']) ? doc['feed'] : null;
  const rdf = isNode(doc['rdf:RDF']) ? doc['rdf:RDF'] : null;
  const rawItems = rss ? rss['item'] : feed ? feed['entry'] : rdf ? rdf['item'] : undefined;

  return asArray(rawItems)
    .slice(0, LIMITS.feedItems)
    .filter(isNode)
    .map((item) => ({
      title: textOf(item['title']),
      link: linkOf(item['link'], base),
      summary: textOf(
        item['description'] ?? item['summary'] ?? item['content:encoded'] ?? item['content'],
      ),
      author: authorOf(item),
      date: item['pubDate'] ?? item['published'] ?? item['updated'] ?? item['dc:date'],
      id: textOf(item['guid'] ?? item['id']),
    }));
}

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
    return extractEntries(parseXmlSafe(raw), ctx.source.url)
      .map((entry) => toItem(entry, ctx))
      .filter((item): item is NormalizedItem => item !== null);
  },
};
