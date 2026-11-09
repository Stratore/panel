import { readCache, writeCache } from './cache.js';
import { formatAge } from './i18n.js';

/** Where the offline banner reads the age of the data on screen. */
let setStaleAge: (age: string | null) => void = () => undefined;

export function registerStaleIndicator(fn: (age: string | null) => void): void {
  setStaleAge = fn;
}

export interface ViewData<T> {
  value: T;
  /** True when shown from cache because the network failed. */
  stale: boolean;
}

/**
 * Stale-while-revalidate (SPEC § 10): the cached copy renders immediately, then the network
 * answer replaces it. If the network fails, the cache stays on screen and the offline banner
 * shows its age ("Showing data from 2h ago — source unreachable").
 */
export async function loadView<T>(
  key: string,
  fetcher: () => Promise<T>,
  render: (data: ViewData<T>) => void,
): Promise<void> {
  const cached = readCache<T>(key);
  if (cached) render({ value: cached.value, stale: false });
  try {
    const fresh = await fetcher();
    writeCache(key, fresh);
    setStaleAge(null);
    render({ value: fresh, stale: false });
  } catch (error) {
    if (!cached) throw error;
    setStaleAge(formatAge(cached.savedAt));
    render({ value: cached.value, stale: true });
  }
}
