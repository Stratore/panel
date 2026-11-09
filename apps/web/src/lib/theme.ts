import type { Prefs } from '@panel/shared';

export type ThemePref = Prefs['theme'];

/** `system` follows the OS (CSS media query); `light`/`dark` force it via `html[data-theme]`. */
export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement): void {
  if (pref === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = pref;
}

export function effectiveTheme(
  pref: ThemePref,
  win: Pick<Window, 'matchMedia'> = window,
): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The header toggle flips the theme currently displayed. */
export const toggledTheme = (
  pref: ThemePref,
  win?: Pick<Window, 'matchMedia'>,
): 'light' | 'dark' => (effectiveTheme(pref, win) === 'dark' ? 'light' : 'dark');

export function applyMotion(
  options: { paused: boolean; reduce: boolean },
  root: HTMLElement = document.documentElement,
): void {
  root.classList.toggle('is-paused', options.paused);
  root.classList.toggle('reduce-motion', options.reduce);
}

export const prefersReducedMotion = (win: Pick<Window, 'matchMedia'> = window): boolean =>
  win.matchMedia('(prefers-reduced-motion: reduce)').matches;
