import { LIMITS } from './constants.js';

/** Bounded pattern (SPEC § 7.2): fixed-width year, 4–7 digit sequence, no backtracking risk. */
const CVE_PATTERN = /\bCVE-\d{4}-\d{4,7}\b/gi;

/** Unique, uppercased CVE identifiers mentioned in a text, capped per item. */
export function extractCveIds(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(CVE_PATTERN)) {
    found.add(match[0].toUpperCase());
    if (found.size >= LIMITS.cveIdsPerItem) break;
  }
  return [...found];
}
