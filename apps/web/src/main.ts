import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { TRUSTED_TYPES_POLICY } from '@panel/shared';
import { PnAppShell } from './components/app-shell.js';
import { PnHeader, PnTabbar } from './components/header.js';
import { PnOfflineBanner } from './components/states.js';

const elements: Readonly<Record<string, CustomElementConstructor>> = {
  'pn-app-shell': PnAppShell,
  'pn-header': PnHeader,
  'pn-tabbar': PnTabbar,
  'pn-offline-banner': PnOfflineBanner,
};

for (const [name, element] of Object.entries(elements)) {
  if (!customElements.get(name)) customElements.define(name, element);
}

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
