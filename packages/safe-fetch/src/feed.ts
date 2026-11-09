import { toPlainText } from './text.js';
import { parseXmlSafe } from './xml.js';

/** At most this many entries are processed per feed (SPEC § 9.3). */
export const MAX_FEED_ITEMS = 200;

type XmlNode = Record<string, unknown>;

export interface FeedEntry {
  /** Raw title: may still contain entities or markup; pass it through `toPlainText`. */
  title: string;
  /** Absolute when the feed gave a resolvable link; validate before use. */
  link: string;
  /** Raw summary or content. */
  summary: string;
  author: string | undefined;
  /** Raw date node (RFC 822 or ISO 8601). */
  date: unknown;
  id: string;
}

export interface ParsedFeed {
  format: 'rss' | 'atom' | 'rdf' | null;
  entries: FeedEntry[];
}

export const asArray = <T>(value: T | T[] | null | undefined): T[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

/** Text of a parsed XML node: plain string, number, or `{ '#text': … }`. */
export function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node !== null && typeof node === 'object' && '#text' in node) return textOf(node['#text']);
  return '';
}

const isNode = (value: unknown): value is XmlNode =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Atom links are `<link href rel>` elements; RSS links are text. Relative links (php.net)
 * are resolved against the feed URL.
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
  const clean = toPlainText(name, 120);
  return clean === '' ? undefined : clean;
}

/** Extracts entries from an already parsed RSS 2.0, Atom 1.0 or RSS 1.0 (RDF) document. */
export function extractEntries(doc: unknown, base: string): ParsedFeed {
  if (!isNode(doc)) return { format: null, entries: [] };
  // An empty <channel/> parses as '': still an RSS feed, just without items.
  const rss = isNode(doc['rss'])
    ? isNode(doc['rss']['channel'])
      ? doc['rss']['channel']
      : {}
    : null;
  const atom = isNode(doc['feed']) ? doc['feed'] : null;
  const rdf = isNode(doc['rdf:RDF']) ? doc['rdf:RDF'] : null;
  const format = rss ? 'rss' : atom ? 'atom' : rdf ? 'rdf' : null;
  const rawItems = rss ? rss['item'] : atom ? atom['entry'] : rdf ? rdf['item'] : undefined;

  const entries = asArray(rawItems)
    .slice(0, MAX_FEED_ITEMS)
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
  return { format, entries };
}

/** Safe XML parsing (no DTD, no entities, bounded) followed by entry extraction. */
export function parseFeed(xml: string, base: string): ParsedFeed {
  return extractEntries(parseXmlSafe(xml), base);
}
