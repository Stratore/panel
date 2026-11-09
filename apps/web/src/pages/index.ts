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

/** Each view is a Custom Element: it loads its data on connect and cleans up on disconnect. */
const ELEMENTS: Partial<Record<RouteName, string>> = {
  journal: 'pn-journal-page',
  brief: 'pn-brief-page',
  threats: 'pn-threats-page',
  breaches: 'pn-breaches-page',
  releases: 'pn-releases-page',
  settings: 'pn-settings-page',
};

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
  const element = ELEMENTS[route.name];
  return element === undefined ? notFound() : h(element);
}
