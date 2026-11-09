import { z } from 'zod';
import type { NormalizedItem } from '@panel/shared';
import type { FetchContext, NormalizeContext, SourceAdapter } from './types.js';
import {
  fetchConditional,
  githubHeaders,
  iso,
  parseDate,
  parseJson,
  plainSummary,
  plainTitle,
} from './util.js';

const json = <T>(schema: z.ZodType<T>, body: string): T => schema.parse(parseJson(body));

// ---------------------------------------------------------------------------------------------
// Hacker News: top 30 stories, item bodies cached by id
// ---------------------------------------------------------------------------------------------

export const HN_TOP = 30;
const HN_CACHE_MS = 30 * 60_000;

const hnItem = z.object({
  id: z.number(),
  type: z.string().optional(),
  title: z.string().max(1000).optional(),
  url: z.string().max(2048).optional(),
  score: z.number().optional(),
  by: z.string().max(100).optional(),
  time: z.number().optional(),
  dead: z.boolean().optional(),
  deleted: z.boolean().optional(),
});
type HnItem = z.infer<typeof hnItem>;

/** Factory so each instance (and each test) owns its cache. */
export function createHnAdapter(): SourceAdapter<HnItem[]> {
  const cache = new Map<number, { item: HnItem; fetchedAt: number }>();
  return {
    id: 'hn',
    async fetch(ctx: FetchContext) {
      const top = await ctx.fetch(ctx.source.url);
      const ids = json(z.array(z.number()).max(1000), top.body).slice(0, HN_TOP);
      const base = new URL('item/', ctx.source.url);
      const items: HnItem[] = [];
      let bytes = top.bytes;
      for (const id of ids) {
        const cached = cache.get(id);
        if (cached && ctx.now.getTime() - cached.fetchedAt < HN_CACHE_MS) {
          items.push(cached.item);
          continue;
        }
        const response = await ctx.fetch(new URL(`${String(id)}.json`, base).href);
        bytes += response.bytes;
        const parsed = hnItem.safeParse(parseJson(response.body));
        if (!parsed.success) continue;
        cache.set(id, { item: parsed.data, fetchedAt: ctx.now.getTime() });
        items.push(parsed.data);
      }
      for (const id of cache.keys()) if (!ids.includes(id)) cache.delete(id);
      return { status: 'ok', raw: items, httpStatus: top.status, bytes };
    },
    normalize(items, ctx) {
      return items.flatMap((item): NormalizedItem[] => {
        if (item.type !== 'story' || item.dead === true || item.deleted === true || !item.title)
          return [];
        const discussion = `https://news.ycombinator.com/item?id=${String(item.id)}`;
        return [
          {
            kind: 'article',
            url: item.url ?? discussion,
            title: plainTitle(item.title),
            summary: '',
            lang: 'en',
            publishedAt: iso(
              item.time === undefined
                ? ctx.now
                : parseDate(new Date(item.time * 1000).toISOString(), ctx.now),
            ),
            hnPoints: Math.max(0, Math.trunc(item.score ?? 0)),
            externalId: `hn:${String(item.id)}`,
            ...(item.by ? { author: item.by } : {}),
          },
        ];
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Lobsters
// ---------------------------------------------------------------------------------------------

const lobstersStory = z.object({
  short_id: z.string().max(20),
  title: z.string().max(1000),
  url: z.string().max(2048),
  comments_url: z.string().max(2048),
  created_at: z.string(),
  description_plain: z.string().max(20_000).optional(),
  submitter_user: z
    .union([z.string().max(100), z.object({ username: z.string().max(100) })])
    .optional(),
});

export const lobstersAdapter: SourceAdapter<string> = {
  id: 'lobsters',
  fetch: (ctx) => fetchConditional(ctx, ctx.source.url),
  normalize(raw, ctx) {
    return json(z.array(z.unknown()).max(200), raw).flatMap((value): NormalizedItem[] => {
      const parsed = lobstersStory.safeParse(value);
      if (!parsed.success) return [];
      const s = parsed.data;
      const author =
        typeof s.submitter_user === 'string' ? s.submitter_user : s.submitter_user?.username;
      return [
        {
          kind: 'article',
          url: s.url === '' ? s.comments_url : s.url,
          title: plainTitle(s.title),
          summary: plainSummary(s.description_plain ?? ''),
          lang: 'en',
          publishedAt: iso(parseDate(s.created_at, ctx.now)),
          externalId: `lobsters:${s.short_id}`,
          ...(author ? { author } : {}),
        },
      ];
    });
  },
};

// ---------------------------------------------------------------------------------------------
// DEV
// ---------------------------------------------------------------------------------------------

const devArticle = z.object({
  id: z.number(),
  title: z.string().max(1000),
  description: z.string().max(5000).nullable().optional(),
  url: z.string().max(2048),
  published_at: z.string(),
  user: z.object({ name: z.string().max(200) }).optional(),
});

export const devtoAdapter: SourceAdapter<string> = {
  id: 'devto',
  fetch: (ctx) => fetchConditional(ctx, ctx.source.url),
  normalize(raw, ctx: NormalizeContext) {
    return json(z.array(z.unknown()).max(200), raw).flatMap((value): NormalizedItem[] => {
      const parsed = devArticle.safeParse(value);
      if (!parsed.success) return [];
      const a = parsed.data;
      return [
        {
          kind: 'article',
          url: a.url,
          title: plainTitle(a.title),
          summary: plainSummary(a.description ?? ''),
          lang: 'en',
          publishedAt: iso(parseDate(a.published_at, ctx.now)),
          externalId: `devto:${String(a.id)}`,
          ...(a.user ? { author: plainTitle(a.user.name).slice(0, 120) } : {}),
        },
      ];
    });
  },
};

// ---------------------------------------------------------------------------------------------
// GitHub trending: most-starred repositories created in the last 7 days
// ---------------------------------------------------------------------------------------------

export const TRENDING_DAYS = 7;

const searchResponse = z.object({
  items: z
    .array(
      z.object({
        full_name: z.string().max(201),
        description: z.string().max(5000).nullable(),
        language: z.string().max(50).nullable(),
        html_url: z.string().max(2048),
        stargazers_count: z.number(),
        created_at: z.string(),
      }),
    )
    .max(100),
});

export const ghTrendingAdapter: SourceAdapter<string> = {
  id: 'gh-trending',
  fetch(ctx) {
    const since = new Date(ctx.now.getTime() - TRENDING_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const url = new URL(ctx.source.url);
    url.searchParams.set('q', `created:>${since}`);
    url.searchParams.set('sort', 'stars');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', '30');
    return fetchConditional(ctx, url.href, githubHeaders(ctx));
  },
  normalize(raw, ctx) {
    return json(searchResponse, raw).items.map((r): NormalizedItem => ({
      kind: 'repo',
      fullName: r.full_name,
      description: plainSummary(r.description ?? ''),
      language: r.language,
      url: r.html_url,
      stars: Math.max(0, Math.trunc(r.stargazers_count)),
      createdAt: iso(parseDate(r.created_at, ctx.now)),
    }));
  },
};
