import type { Lang } from './constants.js';

type Labels = Readonly<Record<Lang, string>>;

interface MetricDef {
  name: Labels;
  values: Readonly<Record<string, Labels>>;
}

const IMPACT: MetricDef['values'] = {
  H: { en: 'High', fr: 'Élevé' },
  L: { en: 'Low', fr: 'Faible' },
  N: { en: 'None', fr: 'Aucun' },
};

const ATTACK_VECTOR: MetricDef = {
  name: { en: 'Attack vector', fr: "Vecteur d'attaque" },
  values: {
    N: { en: 'Network', fr: 'Réseau' },
    A: { en: 'Adjacent', fr: 'Adjacent' },
    L: { en: 'Local', fr: 'Local' },
    P: { en: 'Physical', fr: 'Physique' },
  },
};
const ATTACK_COMPLEXITY: MetricDef = {
  name: { en: 'Complexity', fr: 'Complexité' },
  values: { L: { en: 'Low', fr: 'Faible' }, H: { en: 'High', fr: 'Élevée' } },
};
const PRIVILEGES: MetricDef = {
  name: { en: 'Privileges', fr: 'Privilèges' },
  values: IMPACT,
};
const USER_INTERACTION_V3: MetricDef = {
  name: { en: 'User interaction', fr: 'Interaction utilisateur' },
  values: { N: { en: 'None', fr: 'Aucune' }, R: { en: 'Required', fr: 'Requise' } },
};

const V3_METRICS: Readonly<Record<string, MetricDef>> = {
  AV: ATTACK_VECTOR,
  AC: ATTACK_COMPLEXITY,
  PR: PRIVILEGES,
  UI: USER_INTERACTION_V3,
  S: {
    name: { en: 'Scope', fr: 'Portée' },
    values: { U: { en: 'Unchanged', fr: 'Inchangée' }, C: { en: 'Changed', fr: 'Modifiée' } },
  },
  C: { name: { en: 'Confidentiality', fr: 'Confidentialité' }, values: IMPACT },
  I: { name: { en: 'Integrity', fr: 'Intégrité' }, values: IMPACT },
  A: { name: { en: 'Availability', fr: 'Disponibilité' }, values: IMPACT },
};

const V4_METRICS: Readonly<Record<string, MetricDef>> = {
  AV: ATTACK_VECTOR,
  AC: ATTACK_COMPLEXITY,
  AT: {
    name: { en: 'Attack requirements', fr: "Prérequis d'attaque" },
    values: { N: { en: 'None', fr: 'Aucun' }, P: { en: 'Present', fr: 'Présents' } },
  },
  PR: PRIVILEGES,
  UI: {
    name: USER_INTERACTION_V3.name,
    values: {
      N: { en: 'None', fr: 'Aucune' },
      P: { en: 'Passive', fr: 'Passive' },
      A: { en: 'Active', fr: 'Active' },
    },
  },
  VC: { name: { en: 'Confidentiality', fr: 'Confidentialité' }, values: IMPACT },
  VI: { name: { en: 'Integrity', fr: 'Intégrité' }, values: IMPACT },
  VA: { name: { en: 'Availability', fr: 'Disponibilité' }, values: IMPACT },
};

export interface CvssMetric {
  /** Metric abbreviation, e.g. "AV". */
  key: string;
  /** Raw value, e.g. "N". */
  value: string;
  /** "AV:N" */
  code: string;
  name: string;
  label: string;
}

export interface DecodedCvss {
  version: '3.0' | '3.1' | '4.0';
  metrics: CvssMetric[];
}

const VECTOR_PREFIX = /^CVSS:(3\.0|3\.1|4\.0)\//;
const METRIC_PART = /^[A-Z]{1,3}:[A-Z]$/;
const MAX_PARTS = 32;

/**
 * Decodes the base metrics of a CVSS v3.x or v4.0 vector into readable EN/FR labels (SPEC § 7.8).
 * Unknown metrics (temporal, environmental, supplemental) are ignored; malformed vectors yield null.
 */
export function decodeCvssVector(vector: string, lang: Lang): DecodedCvss | null {
  if (vector.length > 200) return null;
  const trimmed = vector.trim();
  const prefix = VECTOR_PREFIX.exec(trimmed);
  if (!prefix) return null;
  const version = prefix[1] as DecodedCvss['version'];
  const defs = version === '4.0' ? V4_METRICS : V3_METRICS;
  const parts = trimmed.slice(prefix[0].length).split('/');
  if (parts.length > MAX_PARTS || !parts.every((part) => METRIC_PART.test(part))) return null;

  const metrics: CvssMetric[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const [key = '', value = ''] = part.split(':');
    if (seen.has(key)) return null;
    seen.add(key);
    const def = Object.hasOwn(defs, key) ? defs[key] : undefined;
    if (!def) continue;
    const valueLabels = Object.hasOwn(def.values, value) ? def.values[value] : undefined;
    if (!valueLabels) return null;
    metrics.push({ key, value, code: part, name: def.name[lang], label: valueLabels[lang] });
  }
  return metrics.length > 0 ? { version, metrics } : null;
}
