import { h } from '../lib/h.js';
import { t } from '../lib/i18n.js';
import { online } from '../lib/state.js';
import { icons } from './icons.js';

/** Loading placeholder (SPEC § 4.3 F: skeletons, never a lone spinner). */
export function skeleton(
  options: { height?: string; width?: string; lines?: number } = {},
): HTMLElement {
  const lines = options.lines ?? 1;
  return h(
    'div',
    { attrs: { 'aria-hidden': 'true' }, class: 'skeleton-group' },
    Array.from({ length: lines }, (_, i) =>
      h('div', {
        class: 'skeleton',
        style: {
          height: options.height ?? '14px',
          width: i === lines - 1 && lines > 1 ? '60%' : (options.width ?? '100%'),
          'margin-top': i === 0 ? '0' : '10px',
        },
      }),
    ),
  );
}

/** Polite, positive empty state. */
export function emptyState(title: string, body?: string, action?: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'empty' },
    h('p', { class: 'empty__title', text: title }),
    body === undefined ? null : h('p', { text: body }),
    action ?? null,
  );
}

/** Offline banner (SPEC § 4.3 F). `staleSince` shows the age of the cached data. */
export class PnOfflineBanner extends HTMLElement {
  private unsubscribe: (() => void) | null = null;

  connectedCallback(): void {
    this.unsubscribe = online.subscribe(() => {
      this.render();
    });
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
  }

  static get observedAttributes(): string[] {
    return ['stale-age'];
  }

  attributeChangedCallback(): void {
    this.render();
  }

  private render(): void {
    const age = this.getAttribute('stale-age');
    const show = !online.get() || age !== null;
    this.replaceChildren();
    if (!show) return;
    this.append(
      h(
        'div',
        { class: 'offline-banner', attrs: { role: 'status' } },
        icons.offline(),
        h('span', { text: age === null ? t('state.offlineNow') : t('state.offline', { age }) }),
      ),
    );
  }
}
