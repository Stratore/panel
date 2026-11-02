import type { WatchlistEntry } from './schemas.js';
import { containsSequence, tokenize } from './text.js';

/** Default watchlist (SPEC § 6.3). */
export const DEFAULT_WATCHLIST: readonly WatchlistEntry[] = [
  {
    id: 'php',
    label: 'PHP',
    keywords: ['php'],
    cpePatterns: ['cpe:2.3:a:php:php'],
    enabled: true,
  },
  {
    id: 'nodejs',
    label: 'Node.js',
    keywords: ['node.js', 'nodejs', 'npm'],
    cpePatterns: ['cpe:2.3:a:nodejs:node.js', 'cpe:2.3:a:npmjs:npm'],
    enabled: true,
  },
  {
    id: 'python',
    label: 'Python',
    keywords: ['python', 'cpython', 'pypi'],
    cpePatterns: ['cpe:2.3:a:python:python'],
    enabled: true,
  },
  {
    id: 'linux',
    label: 'Linux',
    keywords: ['linux kernel', 'linux'],
    cpePatterns: ['cpe:2.3:o:linux:linux_kernel'],
    enabled: true,
  },
  {
    id: 'docker',
    label: 'Docker',
    keywords: ['docker', 'moby', 'containerd', 'runc'],
    cpePatterns: [
      'cpe:2.3:a:docker:docker',
      'cpe:2.3:a:mobyproject:moby',
      'cpe:2.3:a:linuxfoundation:containerd',
      'cpe:2.3:a:linuxfoundation:runc',
    ],
    enabled: true,
  },
  {
    id: 'openssh',
    label: 'OpenSSH',
    keywords: ['openssh', 'sshd'],
    cpePatterns: ['cpe:2.3:a:openbsd:openssh'],
    enabled: true,
  },
  {
    id: 'wordpress',
    label: 'WordPress',
    keywords: ['wordpress'],
    cpePatterns: ['cpe:2.3:a:wordpress:wordpress'],
    enabled: true,
  },
  {
    id: 'browsers',
    label: 'Browsers',
    keywords: ['chrome', 'chromium', 'firefox', 'safari', 'webkit'],
    cpePatterns: [
      'cpe:2.3:a:google:chrome',
      'cpe:2.3:a:mozilla:firefox',
      'cpe:2.3:a:apple:safari',
      'cpe:2.3:a:webkitgtk:webkitgtk',
    ],
    enabled: true,
  },
  {
    id: 'routers',
    label: 'Routers',
    keywords: ['router', 'routeur', 'freebox', 'mikrotik', 'tp-link', 'netgear', 'fortigate'],
    cpePatterns: ['cpe:2.3:h:free:freebox', 'cpe:2.3:o:mikrotik:routeros'],
    enabled: true,
  },
];

/**
 * CPE 2.3 prefix match: each pattern component must equal the CPE component or be "*";
 * components the pattern omits match anything. Comparison is case-insensitive.
 */
export function cpeMatches(pattern: string, cpe: string): boolean {
  const p = pattern.toLowerCase().split(':');
  const c = cpe.toLowerCase().split(':');
  if (p.length > c.length) return false;
  return p.every((component, index) => component === '*' || component === c[index]);
}

export interface WatchlistTarget {
  text: string;
  cpes?: readonly string[];
}

/** Labels of enabled entries that match a text (whole words) or one of its CPEs. */
export function matchWatchlist(
  entries: readonly WatchlistEntry[],
  target: WatchlistTarget,
): string[] {
  const tokens = tokenize(target.text);
  const cpes = target.cpes ?? [];
  return entries
    .filter(
      (entry) =>
        entry.enabled &&
        (entry.keywords.some((keyword) => containsSequence(tokens, tokenize(keyword))) ||
          entry.cpePatterns.some((pattern) => cpes.some((cpe) => cpeMatches(pattern, cpe)))),
    )
    .map((entry) => entry.label);
}
