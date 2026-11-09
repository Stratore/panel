import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/pages.css';
import { TRUSTED_TYPES_POLICY } from '@panel/shared';
import { PnAppShell } from './components/app-shell.js';
import { PnHeader, PnTabbar } from './components/header.js';
import { installShortcuts } from './components/palette.js';
import { PnOfflineBanner } from './components/states.js';
import { PnBriefPage } from './pages/brief.js';
import { PnJournalPage } from './pages/journal.js';
import { PnBreachesPage, PnReleasesPage, PnThreatsPage } from './pages/lists.js';
import { PnSettingsPage } from './pages/settings.js';

const elements: Readonly<Record<string, CustomElementConstructor>> = {
  'pn-app-shell': PnAppShell,
  'pn-header': PnHeader,
  'pn-tabbar': PnTabbar,
  'pn-offline-banner': PnOfflineBanner,
  'pn-journal-page': PnJournalPage,
  'pn-brief-page': PnBriefPage,
  'pn-threats-page': PnThreatsPage,
  'pn-breaches-page': PnBreachesPage,
  'pn-releases-page': PnReleasesPage,
  'pn-settings-page': PnSettingsPage,
};

for (const [name, element] of Object.entries(elements)) {
  if (!customElements.get(name)) customElements.define(name, element);
}
installShortcuts();

/**
 * PWA (SPEC § 10). Under `require-trusted-types-for 'script'` the Service Worker URL must be a
 * TrustedScriptURL: the single allowed policy only ever returns the fixed `/sw.js` (ADR-030).
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const policy = window.trustedTypes?.createPolicy(TRUSTED_TYPES_POLICY, {
    createScriptURL: (url: string) => {
      if (url !== '/sw.js') throw new TypeError('Blocked script URL');
      return url;
    },
  });
  const scriptUrl = policy ? policy.createScriptURL('/sw.js') : '/sw.js';
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(scriptUrl as unknown as string, { scope: '/' })
      .catch(() => undefined);
  });
}
