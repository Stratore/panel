import { emptyState } from '../components/states.js';
import { h } from '../lib/h.js';
import { t, type MessageKey } from '../lib/i18n.js';
import type { Route, RouteName } from '../lib/router.js';

export const PAGE_TITLES: Readonly<Record<RouteName, MessageKey>> = {
  journal: 'page.journal',
  brief: 'page.brief',
  threats: 'page.threats',
  breaches: 'page.breaches',
  releases: 'page.releases',
  settings: 'page.settings',
  login: 'auth.unlockTitle',
  setup: 'setup.title',
  notFound: 'page.notFound',
};

/** Views are filled in Phase 7; until then each route renders its title and a placeholder. */
function placeholder(route: Route): HTMLElement {
  const serif = route.name === 'journal';
  return h(
    'section',
    { attrs: { 'aria-labelledby': 'page-title' } },
    h('h1', {
      class: serif ? 'page-title serif' : 'page-title',
      attrs: { id: 'page-title', tabindex: -1 },
      text: t(PAGE_TITLES[route.name]),
    }),
    h('div', { class: 'box' }, emptyState(t('state.comingSoon'))),
  );
}

function notFound(): HTMLElement {
  return h(
    'section',
    { attrs: { 'aria-labelledby': 'page-title' } },
    h('h1', {
      class: 'page-title',
      attrs: { id: 'page-title', tabindex: -1 },
      text: t('page.notFound'),
    }),
    h(
      'div',
      { class: 'box' },
      emptyState(
        t('page.notFoundBody'),
        undefined,
        h('a', { class: 'btn', attrs: { href: '/' }, text: t('page.backHome') }),
      ),
    ),
  );
}

export function renderPage(route: Route): HTMLElement {
  return route.name === 'notFound' ? notFound() : placeholder(route);
}
