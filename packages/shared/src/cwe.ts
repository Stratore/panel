import type { Lang } from './constants.js';

interface CweNames {
  short: Readonly<Record<Lang, string>>;
  long: Readonly<Record<Lang, string>>;
}

/** Human names for the weaknesses most often seen in NVD and KEV (CWE Top 25 and a few more). */
const CWE_NAMES: Readonly<Record<string, CweNames>> = {
  'CWE-20': n(
    'Input validation',
    'Validation des entrées',
    'improper input validation',
    'validation incorrecte des entrées',
  ),
  'CWE-22': n(
    'Path traversal',
    'Traversée de répertoires',
    'path traversal',
    'traversée de répertoires',
  ),
  'CWE-77': n(
    'Command injection',
    'Injection de commande',
    'command injection',
    'injection de commande',
  ),
  'CWE-78': n(
    'OS command injection',
    'Injection de commande OS',
    'OS command injection',
    'injection de commande système',
  ),
  'CWE-79': n('XSS', 'XSS', 'cross-site scripting (XSS)', 'faille XSS (cross-site scripting)'),
  'CWE-89': n('SQL injection', 'Injection SQL', 'SQL injection', 'injection SQL'),
  'CWE-94': n('Code injection', 'Injection de code', 'code injection', 'injection de code'),
  'CWE-119': n(
    'Memory corruption',
    'Corruption mémoire',
    'memory corruption',
    'corruption de la mémoire',
  ),
  'CWE-120': n(
    'Buffer overflow',
    'Débordement de tampon',
    'buffer overflow',
    'débordement de tampon',
  ),
  'CWE-125': n(
    'Out-of-bounds read',
    'Lecture hors limites',
    'out-of-bounds read',
    'lecture hors limites',
  ),
  'CWE-190': n(
    'Integer overflow',
    'Dépassement d’entier',
    'integer overflow',
    'dépassement d’entier',
  ),
  'CWE-269': n(
    'Privilege management',
    'Gestion des privilèges',
    'improper privilege management',
    'mauvaise gestion des privilèges',
  ),
  'CWE-287': n(
    'Authentication bypass',
    'Contournement d’authentification',
    'improper authentication',
    'contournement d’authentification',
  ),
  'CWE-306': n(
    'Missing authentication',
    'Authentification absente',
    'missing authentication for a critical function',
    'absence d’authentification sur une fonction critique',
  ),
  'CWE-352': n(
    'CSRF',
    'CSRF',
    'cross-site request forgery (CSRF)',
    'falsification de requête intersite (CSRF)',
  ),
  'CWE-400': n(
    'Resource exhaustion',
    'Épuisement des ressources',
    'uncontrolled resource consumption',
    'consommation de ressources non maîtrisée',
  ),
  'CWE-416': n(
    'Use after free',
    'Use after free',
    'use-after-free',
    'utilisation après libération (use-after-free)',
  ),
  'CWE-434': n(
    'Unrestricted upload',
    'Téléversement non restreint',
    'unrestricted file upload',
    'téléversement de fichier non restreint',
  ),
  'CWE-476': n(
    'NULL dereference',
    'Déréférencement NULL',
    'NULL pointer dereference',
    'déréférencement de pointeur NULL',
  ),
  'CWE-502': n(
    'Unsafe deserialization',
    'Désérialisation non sûre',
    'deserialization of untrusted data',
    'désérialisation de données non fiables',
  ),
  'CWE-611': n(
    'XXE',
    'XXE',
    'XML external entity (XXE) injection',
    'injection d’entité XML externe (XXE)',
  ),
  'CWE-787': n(
    'Out-of-bounds write',
    'Écriture hors limites',
    'out-of-bounds write',
    'écriture hors limites',
  ),
  'CWE-798': n(
    'Hard-coded credentials',
    'Identifiants codés en dur',
    'use of hard-coded credentials',
    'identifiants codés en dur',
  ),
  'CWE-862': n(
    'Missing authorization',
    'Autorisation absente',
    'missing authorization',
    'absence de contrôle d’autorisation',
  ),
  'CWE-863': n(
    'Incorrect authorization',
    'Autorisation incorrecte',
    'incorrect authorization',
    'contrôle d’autorisation incorrect',
  ),
  'CWE-918': n(
    'SSRF',
    'SSRF',
    'server-side request forgery (SSRF)',
    'falsification de requête côté serveur (SSRF)',
  ),
};

function n(shortEn: string, shortFr: string, longEn: string, longFr: string): CweNames {
  return { short: { en: shortEn, fr: shortFr }, long: { en: longEn, fr: longFr } };
}

const FALLBACK: CweNames = n('Vulnerability', 'Vulnérabilité', 'vulnerability', 'vulnérabilité');

export function cweNames(
  cwe: string | null | undefined,
  lang: Lang,
): { short: string; long: string } {
  const names = cwe && Object.hasOwn(CWE_NAMES, cwe) ? CWE_NAMES[cwe] : undefined;
  const resolved = names ?? FALLBACK;
  return { short: resolved.short[lang], long: resolved.long[lang] };
}
