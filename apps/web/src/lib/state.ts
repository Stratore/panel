import { DEFAULT_PREFS, type Prefs, type SessionDto } from '@panel/shared';
import { readCache, writeCache } from './cache.js';
import { createStore } from './store.js';

/** App-wide state (SPEC § 10): session, preferences, motion. */
export const session = createStore<SessionDto | null>(null);

const cachedPrefs = readCache<Prefs>('prefs')?.value;
/** Preferences come from the instance; a cached copy avoids a theme/language flash on load. */
export const prefs = createStore<Prefs>(cachedPrefs ?? DEFAULT_PREFS);
prefs.subscribe(
  (value) => {
    writeCache('prefs', value);
  },
  { immediate: false },
);

/** Global Pause (WCAG 2.2.2): stops tickers, rotations and loops. */
export const paused = createStore<boolean>(false);

export const online = createStore<boolean>(
  typeof navigator === 'undefined' ? true : navigator.onLine,
);

/** Demo build (GitHub Pages): sample data, no network (SPEC § 9.7). */
export const isDemo = import.meta.env.VITE_DEMO === '1';
