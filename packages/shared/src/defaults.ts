import type { Prefs } from './schemas.js';

/** Kept apart from the Zod schemas so the browser bundle can import it without Zod. */
export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  lang: 'en',
  density: 'comfortable',
  reduceMotion: false,
  displayName: '',
  lastVisitAt: null,
  alerts: {
    cvss: 9,
    epss: 0.5,
    breachAccounts: 1_000_000,
    hnPoints: 500,
    maxPerHour: 5,
    quietHours: { start: '23:00', end: '07:00' },
    digestAt: '08:00',
  },
};
