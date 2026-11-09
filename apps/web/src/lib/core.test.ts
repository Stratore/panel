// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guard } from '../components/app-shell.js';
import { api, ApiError, setUnauthorizedHandler } from './api.js';
import { clearCache, readCache, writeCache, MAX_ENTRY_CHARS } from './cache.js';
import { createRouter, matchRoute } from './router.js';
import { connectStream, MAX_FAILURES, POLL_MS, streamStatus } from './sse.js';
import { createStore } from './store.js';
import { passphraseStrength } from './strength.js';
import { applyMotion, applyTheme, effectiveTheme, toggledTheme } from './theme.js';

describe('store', () => {
  it('notifies subscribers on change only', () => {
    const store = createStore(1);
    const seen: number[] = [];
    const off = store.subscribe((v) => seen.push(v));
    store.set(1);
    store.set(2);
    store.update((v) => v + 1);
    off();
    store.set(9);
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('router', () => {
  it.each([
    ['/', 'journal', {}],
    ['/brief', 'brief', {}],
    ['/threats', 'threats', {}],
    ['/threats/CVE-2026-41234', 'threats', { id: 'CVE-2026-41234' }],
    ['/settings/alerts', 'settings', { tab: 'alerts' }],
    ['/settings/', 'settings', {}],
    ['/login', 'login', {}],
    ['/nope', 'notFound', {}],
    ['/threats/a/b', 'notFound', {}],
  ])('matches %s', (path, name, params) => {
    expect(matchRoute(path)).toMatchObject({ name, params });
  });

  it('keeps the query string', () => {
    expect(matchRoute('/threats?filter=kev').query.get('filter')).toBe('kev');
  });

  it('navigates with the History API and intercepts same-origin links only', () => {
    window.history.replaceState(null, '', '/');
    const router = createRouter(window);
    const stop = router.start();
    router.navigate('/brief');
    expect(window.location.pathname).toBe('/brief');
    expect(router.route.get().name).toBe('brief');

    const internal = document.createElement('a');
    internal.href = '/threats/CVE-2026-41234';
    const external = document.createElement('a');
    external.href = 'https://example.com/';
    const blank = document.createElement('a');
    blank.href = '/releases';
    blank.target = '_blank';
    document.body.append(internal, external, blank);

    internal.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(router.route.get().params).toEqual({ id: 'CVE-2026-41234' });

    const externalClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    external.dispatchEvent(externalClick);
    expect(externalClick.defaultPrevented).toBe(false);

    const blankClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    blank.dispatchEvent(blankClick);
    expect(blankClick.defaultPrevented).toBe(false);

    const modified = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    internal.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    stop();
  });
});

describe('route guard', () => {
  const route = (path: string) => matchRoute(path);
  it('sends everyone to setup before the first user', () => {
    expect(guard({ authenticated: false, setupRequired: true }, route('/brief'))).toBe('/setup');
    expect(guard({ authenticated: false, setupRequired: true }, route('/setup'))).toBeNull();
  });
  it('requires a session and keeps signed-in users away from login and setup', () => {
    expect(guard({ authenticated: false, setupRequired: false }, route('/brief'))).toBe('/login');
    expect(guard({ authenticated: false, setupRequired: false }, route('/login'))).toBeNull();
    expect(guard({ authenticated: false, setupRequired: false }, route('/setup'))).toBe('/login');
    expect(guard({ authenticated: true, setupRequired: false }, route('/login'))).toBe('/');
    expect(
      guard({ authenticated: true, setupRequired: false }, route('/threats/CVE-2026-1')),
    ).toBeNull();
  });
});

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respond = (status: number, body?: unknown) =>
    vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers:
            body === undefined
              ? {}
              : { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
        }),
      ),
    );

  it('sends the CSRF header on state changes only, same-origin credentials', async () => {
    const fetchMock = respond(200, { authenticated: true, setupRequired: false });
    vi.stubGlobal('fetch', fetchMock);
    await api.session();
    await api.login('correct horse battery staple');
    const [, getInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [postUrl, postInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect((getInit.headers as Record<string, string>)['x-panel-csrf']).toBeUndefined();
    expect(getInit.credentials).toBe('same-origin');
    expect(postUrl).toBe('/api/auth/login');
    expect((postInit.headers as Record<string, string>)['x-panel-csrf']).toBe('1');
    expect(postInit.body).toBe(JSON.stringify({ passphrase: 'correct horse battery staple' }));
  });

  it('turns problems into ApiError and reports 401s', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal(
      'fetch',
      respond(401, {
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Sign in required.',
      }),
    );
    const error = await api.journal().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe('Sign in required.');
    expect(onUnauthorized).toHaveBeenCalledOnce();

    // The login form handles its own 401.
    await api.login('nope').catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('builds query strings and handles 204', async () => {
    const fetchMock = respond(204);
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.visit()).resolves.toBeUndefined();
    const listMock = respond(200, { items: [], nextCursor: null });
    vi.stubGlobal('fetch', listMock);
    await api.cves({ filter: 'kev,watchlist', sort: 'epss', cursor: undefined });
    expect(listMock.mock.calls[0]?.[0]).toBe('/api/cves?filter=kev%2Cwatchlist&sort=epss');
  });
});

describe('cache', () => {
  const memory = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => {
        map.clear();
      },
      getItem: (k) => map.get(k) ?? null,
      key: (i) => [...map.keys()][i] ?? null,
      removeItem: (k) => {
        map.delete(k);
      },
      setItem: (k, v) => {
        map.set(k, v);
      },
    };
  };

  it('round-trips versioned entries, skips oversized ones, clears only Panel keys', () => {
    const storage = memory();
    writeCache('journal', { a: 1 }, new Date('2026-11-02T21:00:00Z'), storage);
    expect(readCache('journal', storage)).toEqual({
      savedAt: '2026-11-02T21:00:00.000Z',
      value: { a: 1 },
    });
    writeCache('big', 'x'.repeat(MAX_ENTRY_CHARS), new Date(), storage);
    expect(readCache('big', storage)).toBeNull();
    storage.setItem('other', '1');
    storage.setItem('panel:v1:bad', '{not json');
    expect(readCache('bad', storage)).toBeNull();
    clearCache(storage);
    expect(storage.length).toBe(1);
    expect(readCache('journal', null)).toBeNull();
  });
});

describe('stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  class FakeSource extends EventTarget {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    close() {
      this.closed = true;
    }
  }

  it('goes live, parses events, falls back to polling after repeated failures', () => {
    const sources: FakeSource[] = [];
    const onEvent = vi.fn();
    const onPoll = vi.fn();
    const stop = connectStream({
      onEvent,
      onPoll,
      factory: () => {
        const source = new FakeSource();
        sources.push(source);
        return source as unknown as EventSource;
      },
    });
    const first = sources[0];
    if (!first) throw new Error('no source');
    expect(streamStatus.get()).toBe('connecting');
    first.onopen?.();
    expect(streamStatus.get()).toBe('live');

    first.dispatchEvent(
      new MessageEvent('item.new', { data: '{"id":1,"title":"x"}', lastEventId: '42' }),
    );
    first.dispatchEvent(new MessageEvent('item.new', { data: '{broken', lastEventId: '43' }));
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({
      id: 42,
      type: 'item.new',
      payload: { id: 1, title: 'x' },
    });

    for (let i = 0; i < MAX_FAILURES; i++) first.onerror?.();
    expect(first.closed).toBe(true);
    expect(streamStatus.get()).toBe('polling');
    vi.advanceTimersByTime(POLL_MS * 2);
    expect(onPoll).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('theme and motion', () => {
  const media = (dark: boolean) => ({
    matchMedia: () => ({ matches: dark }) as unknown as MediaQueryList,
  });

  it('applies and toggles themes', () => {
    const root = document.createElement('html');
    applyTheme('dark', root);
    expect(root.dataset['theme']).toBe('dark');
    applyTheme('system', root);
    expect(root.dataset['theme']).toBeUndefined();
    expect(effectiveTheme('system', media(true))).toBe('dark');
    expect(toggledTheme('system', media(true))).toBe('light');
    expect(toggledTheme('light', media(true))).toBe('dark');
  });

  it('pauses motion and honours reduced motion', () => {
    const root = document.createElement('html');
    applyMotion({ paused: true, reduce: false }, root);
    expect(root.classList.contains('is-paused')).toBe(true);
    applyMotion({ paused: false, reduce: true }, root);
    expect([...root.classList]).toEqual(['reduce-motion']);
  });
});

describe('passphrase strength', () => {
  it('rates passphrases from 0 to 4', () => {
    expect(passphraseStrength('short')).toBe(0);
    expect(passphraseStrength('aaaaaaaaaaaaaaa')).toBe(1);
    expect(passphraseStrength('correcthorsebat')).toBe(1);
    expect(passphraseStrength('correct horse battery')).toBe(2);
    expect(passphraseStrength('Correct horse battery staple 9')).toBe(4);
  });
});
