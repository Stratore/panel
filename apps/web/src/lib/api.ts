import type {
  BreachDto,
  BriefDto,
  CveDetailDto,
  CveSummaryDto,
  ExportDto,
  ItemDto,
  JournalDto,
  Lang,
  Prefs,
  PrefsDto,
  Problem,
  ReleaseDto,
  RepoDto,
  SearchDto,
  SessionDto,
  SourceDto,
  SourceValidation,
  WatchlistEntry,
} from '@panel/shared';

/**
 * Typed client for the Panel API (SPEC § 10). Types come from the shared Zod contract
 * (type-only import: no validation code ships to the browser; the server validates its
 * output). This module is the only place allowed to call `fetch` in the front-end.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Partial<Problem> = {},
  ) {
    super(problem.detail ?? problem.title ?? `HTTP ${String(status)}`);
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Query = Readonly<Record<string, string | number | undefined>>;

let onUnauthorized: () => void = () => undefined;

/** Called on any 401 (except the login call itself), e.g. to route to /login. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

function withQuery(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs === '' ? path : `${path}?${qs}`;
}

const isProblem = (value: unknown): value is Partial<Problem> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export async function request<T>(
  method: Method,
  path: string,
  options: { body?: unknown; signal?: AbortSignal; silent401?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  // CSRF defence (SPEC § 9.1): the API refuses state changes without this header.
  if (method !== 'GET') headers['x-panel-csrf'] = '1';

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-cache',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 401 && options.silent401 !== true) onUnauthorized();
  if (response.status === 204) return undefined as T;
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  const payload: unknown = isJson ? await response.json() : null;
  if (!response.ok) throw new ApiError(response.status, isProblem(payload) ? payload : {});
  return payload as T;
}

export const api = {
  session: () => request<SessionDto>('GET', '/api/auth/session', { silent401: true }),
  setup: (body: { token: string; passphrase: string; displayName: string; lang: Lang }) =>
    request<SessionDto>('POST', '/api/auth/setup', { body, silent401: true }),
  login: (passphrase: string) =>
    request<SessionDto>('POST', '/api/auth/login', { body: { passphrase }, silent401: true }),
  logout: () => request<undefined>('POST', '/api/auth/logout'),

  journal: (signal?: AbortSignal) =>
    request<JournalDto>('GET', '/api/journal', signal ? { signal } : {}),
  brief: (signal?: AbortSignal) => request<BriefDto>('GET', '/api/brief', signal ? { signal } : {}),
  items: (query: Query = {}) => request<Page<ItemDto>>('GET', withQuery('/api/items', query)),
  cves: (query: Query = {}) => request<Page<CveSummaryDto>>('GET', withQuery('/api/cves', query)),
  cve: (id: string) => request<CveDetailDto>('GET', `/api/cves/${encodeURIComponent(id)}`),
  breaches: (cursor?: string) =>
    request<Page<BreachDto>>('GET', withQuery('/api/breaches', { cursor })),
  releases: (cursor?: string) =>
    request<Page<ReleaseDto>>('GET', withQuery('/api/releases', { cursor })),
  repos: (cursor?: string) => request<Page<RepoDto>>('GET', withQuery('/api/repos', { cursor })),
  search: (q: string, signal?: AbortSignal) =>
    request<SearchDto>('GET', withQuery('/api/search', { q }), signal ? { signal } : {}),

  sources: () => request<SourceDto[]>('GET', '/api/sources'),
  validateSource: (url: string) =>
    request<SourceValidation>('POST', '/api/sources/validate', { body: { url } }),
  createSource: (body: { name: string; url: string; lang: Lang; category: string }) =>
    request<SourceDto>('POST', '/api/sources', { body }),
  updateSource: (
    id: string,
    body: { enabled?: boolean; weight?: number; name?: string; category?: string },
  ) => request<SourceDto>('PATCH', `/api/sources/${encodeURIComponent(id)}`, { body }),
  deleteSource: (id: string) =>
    request<undefined>('DELETE', `/api/sources/${encodeURIComponent(id)}`),

  prefs: () => request<PrefsDto>('GET', '/api/prefs'),
  savePrefs: (body: { prefs?: Prefs; watchlist?: WatchlistEntry[] }) =>
    request<PrefsDto>('PUT', '/api/prefs', { body }),
  visit: () => request<undefined>('POST', '/api/visit'),
  exportConfig: () => request<ExportDto>('GET', '/api/export'),
  importConfig: (body: ExportDto) => request<PrefsDto>('POST', '/api/import', { body }),
  testAlert: () => request<{ sent: string[]; failed: string[] }>('POST', '/api/alerts/test'),
};
