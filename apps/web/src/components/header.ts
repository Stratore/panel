import type { Lang } from '@panel/shared';
import { router, savePrefs } from '../app-context.js';
import { h, mount } from '../lib/h.js';
import { lang, t, type MessageKey } from '../lib/i18n.js';
import type { RouteName } from '../lib/router.js';
import { paused, prefs } from '../lib/state.js';
import { effectiveTheme, toggledTheme } from '../lib/theme.js';
import { icons, logoMark } from './icons.js';

const SECTIONS: readonly { name: RouteName; href: string; label: MessageKey }[] = [
  { name: 'journal', href: '/', label: 'nav.journal' },
  { name: 'brief', href: '/brief', label: 'nav.brief' },
  { name: 'threats', href: '/threats', label: 'nav.threats' },
  { name: 'breaches', href: '/breaches', label: 'nav.breaches' },
  { name: 'releases', href: '/releases', label: 'nav.releases' },
];

const TABS: readonly {
  name: RouteName;
  href: string;
  label: MessageKey;
  icon: () => SVGElement;
}[] = [
  { name: 'journal', href: '/', label: 'nav.journal', icon: () => icons.journal() },
  { name: 'brief', href: '/brief', label: 'nav.brief', icon: () => icons.brief() },
  { name: 'threats', href: '/threats', label: 'nav.threats', icon: () => icons.threats() },
  { name: 'settings', href: '/settings', label: 'nav.settings', icon: () => icons.settings(20) },
];

/** Base class: re-render whenever one of the shared stores changes. */
abstract class ReactiveElement extends HTMLElement {
  private unsubscribers: (() => void)[] = [];

  connectedCallback(): void {
    const render = () => {
      mount(this, this.view());
    };
    this.unsubscribers = [
      router.route.subscribe(render, { immediate: false }),
      lang.subscribe(render, { immediate: false }),
      prefs.subscribe(render, { immediate: false }),
      paused.subscribe(render, { immediate: false }),
    ];
    render();
  }

  disconnectedCallback(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  protected abstract view(): Node;
}

const current = (name: RouteName) => (router.route.get().name === name ? 'page' : undefined);

/** Logo, section navigation, Pause, theme, language, settings (SPEC § 4.3 A). */
export class PnHeader extends ReactiveElement {
  protected view(): Node {
    const isPaused = paused.get();
    const dark = effectiveTheme(prefs.get().theme) === 'dark';
    const langButton = (code: Lang) =>
      h('button', {
        attrs: {
          type: 'button',
          'aria-pressed': String(lang.get() === code),
          lang: code,
          title: t(`lang.${code}`),
        },
        text: code.toUpperCase(),
        on: { click: () => void savePrefs({ lang: code }) },
      });

    return h(
      'header',
      { class: 'pn-header' },
      h(
        'div',
        { class: 'pn-header__left' },
        h(
          'a',
          { class: 'pn-logo', attrs: { href: '/', 'aria-label': t('app.name') } },
          logoMark(),
          h('span', { class: 'pn-logo__word', text: 'Panel' }),
        ),
        h(
          'nav',
          { class: 'pn-nav', attrs: { 'aria-label': t('nav.label') } },
          SECTIONS.map((s) =>
            h('a', { attrs: { href: s.href, 'aria-current': current(s.name) }, text: t(s.label) }),
          ),
        ),
      ),
      h(
        'div',
        { class: 'pn-header__right' },
        h(
          'button',
          {
            class: 'pn-iconbtn hide-sm',
            attrs: {
              type: 'button',
              'aria-pressed': String(isPaused),
              title: t('header.pauseHint'),
            },
            on: {
              click: () => {
                paused.set(!isPaused);
              },
            },
          },
          isPaused ? icons.play() : icons.pause(),
          t(isPaused ? 'header.resume' : 'header.pause'),
        ),
        h(
          'button',
          {
            class: 'pn-iconbtn',
            attrs: { type: 'button', 'aria-label': t(dark ? 'header.themeLight' : 'header.theme') },
            on: { click: () => void savePrefs({ theme: toggledTheme(prefs.get().theme) }) },
          },
          dark ? icons.sun() : icons.moon(),
        ),
        h(
          'div',
          { class: 'pn-seg', attrs: { role: 'group', 'aria-label': t('header.language') } },
          langButton('en'),
          langButton('fr'),
        ),
        h(
          'a',
          {
            class: 'pn-iconbtn hide-sm',
            attrs: {
              href: '/settings',
              'aria-label': t('nav.settings'),
              'aria-current': current('settings'),
            },
          },
          icons.settings(),
        ),
      ),
    );
  }
}

/** Floating tab bar on phones (SPEC § 4.3 E). */
export class PnTabbar extends ReactiveElement {
  protected view(): Node {
    return h(
      'nav',
      { class: 'pn-tabbar', attrs: { 'aria-label': t('nav.label') } },
      TABS.map((tab) =>
        h(
          'a',
          { attrs: { href: tab.href, 'aria-current': current(tab.name) } },
          tab.icon(),
          h('span', { text: t(tab.label) }),
        ),
      ),
    );
  }
}
