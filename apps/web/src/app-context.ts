import { api, setUnauthorizedHandler } from './lib/api.js';
import { clearCache } from './lib/cache.js';
import { lang } from './lib/i18n.js';
import { createRouter } from './lib/router.js';
import { connectStream, type StreamEvent } from './lib/sse.js';
import {
  isDemo,
  prefs,
  rememberSignedIn,
  session,
  signedInBefore,
  unreachable,
} from './lib/state.js';
import type { Prefs } from '@panel/shared';

/** Singletons shared by components and pages. */
export const router = createRouter();

/** Live updates are re-dispatched as DOM events so any view can listen. */
export const STREAM_EVENT = 'pn:stream';
export const POLL_EVENT = 'pn:poll';

let closeStream: (() => void) | null = null;

function startStream(): void {
  if (isDemo || closeStream !== null || typeof EventSource === 'undefined') return;
  closeStream = connectStream({
    onEvent: (event: StreamEvent) =>
      document.dispatchEvent(new CustomEvent(STREAM_EVENT, { detail: event })),
    onPoll: () => document.dispatchEvent(new CustomEvent(POLL_EVENT)),
  });
}

function stopStream(): void {
  closeStream?.();
  closeStream = null;
}

setUnauthorizedHandler(() => {
  stopStream();
  rememberSignedIn(false);
  session.set({ authenticated: false, setupRequired: false });
  router.navigate('/login', { replace: true });
});

/** Loads what an authenticated session needs: preferences, then the live stream. */
export async function afterLogin(): Promise<void> {
  session.set({ authenticated: true, setupRequired: false });
  rememberSignedIn(true);
  const loaded = await api.prefs();
  prefs.set(loaded.prefs);
  startStream();
}

export async function boot(): Promise<void> {
  if (isDemo) {
    session.set({ authenticated: true, setupRequired: false });
    return;
  }
  try {
    const current = await api.session();
    session.set(current);
    if (current.authenticated) await afterLogin();
  } catch {
    if (signedInBefore()) {
      // Offline or API down after a previous sign-in: show the cached data with the banner.
      session.set({ authenticated: true, setupRequired: false });
    } else {
      // Nothing cached to show (first visit, wiped instance, refused certificate): say so.
      unreachable.set(true);
      session.set({ authenticated: false, setupRequired: false });
    }
  }
}

/** Saves preferences optimistically; the server is the source of truth. */
export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  const next = { ...prefs.get(), ...patch };
  prefs.set(next);
  if (patch.lang) lang.set(patch.lang);
  if (isDemo) return;
  try {
    const saved = await api.savePrefs({ prefs: next });
    prefs.set(saved.prefs);
  } catch {
    // Kept locally; the next successful save syncs it.
  }
}

export async function logout(): Promise<void> {
  stopStream();
  try {
    await api.logout();
  } finally {
    clearCache();
    if ('caches' in globalThis) {
      for (const key of await caches.keys()) await caches.delete(key);
    }
    session.set({ authenticated: false, setupRequired: false });
    router.navigate('/login', { replace: true });
  }
}
