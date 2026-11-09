import type { SessionDto } from '@panel/shared';
import { boot, router } from '../app-context.js';
import { h, mount } from '../lib/h.js';
import { lang, t } from '../lib/i18n.js';
import type { Route } from '../lib/router.js';
import { isDemo, online, paused, prefs, session } from '../lib/state.js';
import { applyMotion, applyTheme, prefersReducedMotion } from '../lib/theme.js';
import { loginPage, setupPage } from '../pages/auth.js';
import { PAGE_TITLES, renderPage } from '../pages/index.js';
import { skeleton } from './states.js';

const PUBLIC_ROUTES = new Set(['login', 'setup']);

/**
 * Route guard (SPEC § 9.5): setup only before the first user, everything else needs a
 * session. Returns where to go instead, or null to render the route.
 */
export function guard(current: SessionDto, route: Route): string | null {
  if (current.setupRequired) return route.name === 'setup' ? null : '/setup';
  if (route.name === 'setup') return current.authenticated ? '/' : '/login';
  if (!current.authenticated && !PUBLIC_ROUTES.has(route.name)) return '/login';
  if (current.authenticated && route.name === 'login') return '/';
  return null;
}

/**
 * Root element: applies preferences (theme, language, motion), guards routes on the session,
 * keeps the header/footer layout mounted and swaps the page inside `<main>`.
 */
export class PnAppShell extends HTMLElement {
  private main: HTMLElement | null = null;
  private stopRouter: (() => void) | null = null;
  private unsubscribers: (() => void)[] = [];

  connectedCallback(): void {
    this.stopRouter = router.start();
    const reduce = prefersReducedMotion();
    if (reduce) paused.set(true);

    this.unsubscribers = [
      prefs.subscribe((p) => {
        applyTheme(p.theme);
        lang.set(p.lang);
        applyMotion({ paused: paused.get(), reduce: p.reduceMotion || reduce });
      }),
      paused.subscribe((value) => {
        applyMotion({ paused: value, reduce: prefs.get().reduceMotion || reduce });
      }),
      // Immediate: the cached language may already be set before the shell connects.
      lang.subscribe((code) => {
        document.documentElement.lang = code;
        this.render(router.route.get());
      }),
      router.route.subscribe(
        (route) => {
          this.render(route);
        },
        { immediate: false },
      ),
      session.subscribe(
        () => {
          this.render(router.route.get());
        },
        { immediate: false },
      ),
    ];
    const setOnline = () => {
      online.set(navigator.onLine);
    };
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOnline);

    mount(
      this,
      h(
        'div',
        { class: 'container' },
        skeleton({ height: '40px' }),
        h('div', { style: { height: '24px' } }),
        skeleton({ lines: 4 }),
      ),
    );
    void boot();
  }

  disconnectedCallback(): void {
    this.stopRouter?.();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
  }

  private render(route: Route): void {
    const current = session.get();
    if (current === null) return;

    const redirect = guard(current, route);
    if (redirect !== null) {
      router.navigate(redirect, { replace: true });
      return;
    }

    document.title = route.name === 'journal' ? 'Panel' : `${t(PAGE_TITLES[route.name])} · Panel`;

    if (route.name === 'login' || route.name === 'setup') {
      this.main = null;
      mount(this, route.name === 'login' ? loginPage() : setupPage());
      return;
    }

    if (!this.main?.isConnected) {
      this.main = h('main', { attrs: { id: 'main', tabindex: -1 } });
      mount(
        this,
        h('a', { class: 'skip-link', attrs: { href: '#main' }, text: t('app.skip') }),
        isDemo
          ? h('div', { class: 'demo-banner', attrs: { role: 'note' }, text: t('app.demo') })
          : null,
        h(
          'div',
          { class: 'container' },
          h('pn-header'),
          h('div', { style: { height: '8px' } }),
          h('pn-offline-banner'),
          this.main,
        ),
        h('pn-tabbar'),
      );
    }
    mount(this.main, renderPage(route));
    // Move focus to the new page title for keyboard and screen-reader users.
    this.main.querySelector<HTMLElement>('#page-title')?.focus({ preventScroll: true });
  }
}
