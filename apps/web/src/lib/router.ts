import { createStore, type Store } from './store.js';

export type RouteName =
  | 'journal'
  | 'brief'
  | 'threats'
  | 'breaches'
  | 'releases'
  | 'settings'
  | 'login'
  | 'setup'
  | 'notFound';

export interface Route {
  name: RouteName;
  params: Readonly<Record<string, string>>;
  path: string;
  query: URLSearchParams;
}

interface Definition {
  name: RouteName;
  pattern: RegExp;
  keys: string[];
}

/** SPEC § 10 routes. `:name?` segments are optional. */
const DEFINITIONS: readonly [RouteName, string][] = [
  ['journal', '/'],
  ['brief', '/brief'],
  ['threats', '/threats/:id?'],
  ['breaches', '/breaches'],
  ['releases', '/releases'],
  ['settings', '/settings/:tab?'],
  ['login', '/login'],
  ['setup', '/setup'],
];

function compile(name: RouteName, path: string): Definition {
  const keys: string[] = [];
  const source = path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => {
      const param = /^:(\w+)(\?)?$/.exec(segment);
      if (!param) return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
      keys.push(param[1] ?? '');
      return param[2] === '?' ? '(?:/([^/]+))?' : '/([^/]+)';
    })
    .join('');
  // Built from the constant route table above, never from user input.
  // eslint-disable-next-line security/detect-non-literal-regexp
  return { name, keys, pattern: new RegExp(`^${source || '/'}/?$`) };
}

const COMPILED = DEFINITIONS.map(([name, path]) => compile(name, path));

export function matchRoute(url: string): Route {
  const parsed = new URL(url, 'http://panel.local');
  for (const def of COMPILED) {
    const match = def.pattern.exec(parsed.pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    def.keys.forEach((key, index) => {
      const value = match[index + 1];
      if (value !== undefined) params[key] = decodeURIComponent(value);
    });
    return { name: def.name, params, path: parsed.pathname, query: parsed.searchParams };
  }
  return { name: 'notFound', params: {}, path: parsed.pathname, query: parsed.searchParams };
}

export interface Router {
  route: Store<Route>;
  navigate(to: string, options?: { replace?: boolean }): void;
  start(): () => void;
}

/** History API router with link interception (same-origin, unmodified clicks only). */
export function createRouter(win: Window = window): Router {
  const current = () => `${win.location.pathname}${win.location.search}`;
  const route = createStore<Route>(
    matchRoute(current()),
    (a, b) => a.path === b.path && a.query.toString() === b.query.toString(),
  );

  const navigate = (to: string, options: { replace?: boolean } = {}) => {
    if (to === current()) return;
    if (options.replace) win.history.replaceState(null, '', to);
    else win.history.pushState(null, '', to);
    route.set(matchRoute(to));
    win.scrollTo({ top: 0 });
  };

  const onClick = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (anchor?.target !== '' || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, win.location.href);
    if (url.origin !== win.location.origin || url.pathname.startsWith('/api/')) return;
    event.preventDefault();
    navigate(`${url.pathname}${url.search}`);
  };
  const onPop = () => {
    route.set(matchRoute(current()));
  };

  return {
    route,
    navigate,
    start() {
      win.document.addEventListener('click', onClick);
      win.addEventListener('popstate', onPop);
      return () => {
        win.document.removeEventListener('click', onClick);
        win.removeEventListener('popstate', onPop);
      };
    },
  };
}
