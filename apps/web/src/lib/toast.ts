import { h } from './h.js';

export const TOAST_MS = 2_600;

let region: HTMLElement | null = null;

/** Confirms an action (SPEC § 4.3 D): a polite live region, gone after 2.6 s. */
export function toast(message: string): void {
  if (!region?.isConnected) {
    region = h('div', { class: 'toast-region', attrs: { role: 'status', 'aria-live': 'polite' } });
    document.body.append(region);
  }
  const node = h('div', { class: 'toast', text: message });
  region.append(node);
  setTimeout(() => {
    node.remove();
  }, TOAST_MS);
}
