import type { Lang, Severity } from './constants.js';
import { cweNames } from './cwe.js';

/** Template-only strings. UI strings live in apps/web/src/i18n (SPEC § 5). */
const STRINGS = {
  en: {
    exploited: 'Exploited (KEV)',
    fix: (fix: string) => `Fix: ${fix}`,
    noFix: 'No fix yet',
    in: 'in',
    activelyExploited: 'Actively exploited',
    upgrade: (fix: string) => `Upgrade to ${fix}.`,
    noPatch: 'No patch yet — apply vendor mitigation.',
    unknownProduct: 'affected software',
    severity: {
      critical: 'Critical',
      high: 'High-severity',
      medium: 'Medium-severity',
      low: 'Low-severity',
      none: 'Unrated',
    },
  },
  fr: {
    exploited: 'Exploitée (KEV)',
    fix: (fix: string) => `Correctif : ${fix}`,
    noFix: 'Pas encore de correctif',
    in: 'dans',
    activelyExploited: 'Activement exploitée',
    upgrade: (fix: string) => `Mettre à jour vers ${fix}.`,
    noPatch: 'Pas encore de correctif — appliquer les mesures de l’éditeur.',
    unknownProduct: 'le logiciel concerné',
    severity: {
      critical: 'gravité critique',
      high: 'gravité élevée',
      medium: 'gravité moyenne',
      low: 'gravité faible',
      none: 'gravité non évaluée',
    },
  },
} as const satisfies Record<Lang, unknown>;

export interface CveSummaryInput {
  product: string | null;
  /** Short affected range, e.g. "< 8.3.14". */
  affectedShort: string | null;
  cwe: string | null;
  cvss: number;
  severity: Severity;
  kev: boolean;
  /** EPSS probability in [0, 1]; null when unknown. */
  epss: number | null;
  fix: string | null;
}

const LOCALES: Record<Lang, string> = { en: 'en-US', fr: 'fr-FR' };

function formatCvss(cvss: number, lang: Lang): string {
  return new Intl.NumberFormat(LOCALES[lang], {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(cvss);
}

/** EPSS as a whole percentage; anything above 0 but under 1 % reads "<1%". */
export function formatEpss(epss: number, lang: Lang): string {
  const percent = Math.round(epss * 100);
  const sep = lang === 'fr' ? ' ' : '';
  if (epss > 0 && percent === 0) return `<1${sep}%`;
  return `${String(percent)}${sep}%`;
}

function subject(input: CveSummaryInput, lang: Lang): string {
  const product = input.product?.trim();
  const name = product !== undefined && product !== '' ? product : STRINGS[lang].unknownProduct;
  const affected = input.affectedShort?.trim();
  return affected ? `${name} ${affected}` : name;
}

/** One-line synthesis shown in lists and alerts (SPEC § 7.8). Empty parts are dropped. */
export function cveOneLiner(input: CveSummaryInput, lang: Lang): string {
  const s = STRINGS[lang];
  const parts = [
    subject(input, lang),
    cweNames(input.cwe, lang).short,
    `CVSS ${formatCvss(input.cvss, lang)}`,
    input.kev ? s.exploited : '',
    input.epss !== null ? `EPSS ${formatEpss(input.epss, lang)}` : '',
    input.fix ? s.fix(input.fix) : s.noFix,
  ];
  return parts.filter((part) => part !== '').join(' · ');
}

/** TL;DR paragraph shown at the top of the CVE drawer (SPEC § 7.8). */
export function cveTldr(input: CveSummaryInput, lang: Lang): string {
  const s = STRINGS[lang];
  const weakness = cweNames(input.cwe, lang).long;
  const exploited = input.kev ? `. ${s.activelyExploited}` : '';
  const action = input.fix ? s.upgrade(input.fix) : s.noPatch;

  if (lang === 'fr') {
    const head = `${capitalize(weakness)} (${s.severity[input.severity]}) ${s.in} ${subject(input, lang)}`;
    return `${head}${exploited}. ${action}`;
  }
  const head = `${s.severity[input.severity]} ${weakness} ${s.in} ${subject(input, lang)}`;
  return `${head}${exploited}. ${action}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
