import { readCache, writeCache } from './cache.js';
import { createStore } from './store.js';

/** CVEs bookmarked with `s` (SPEC § 4.3 C). Kept in this browser only. */
export const savedCves = createStore<ReadonlySet<string>>(
  new Set(readCache<string[]>('saved')?.value ?? []),
);

export function toggleSaved(cveId: string): boolean {
  const next = new Set(savedCves.get());
  const saved = !next.has(cveId);
  if (saved) next.add(cveId);
  else next.delete(cveId);
  savedCves.set(next);
  writeCache('saved', [...next]);
  return saved;
}
