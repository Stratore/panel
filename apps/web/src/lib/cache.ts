/**
 * Small, versioned LocalStorage cache for stale-while-revalidate (SPEC § 10). Entries larger
 * than the cap are skipped; storage errors (private mode, quota, blocked storage) are ignored.
 */
const PREFIX = 'panel:v1:';
export const MAX_ENTRY_CHARS = 400_000;

export interface Cached<T> {
  savedAt: string;
  value: T;
}

/** Even reading `localStorage` can throw when storage is blocked. */
function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readCache<T>(
  key: string,
  storage: Storage | null = defaultStorage(),
): Cached<T> | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(PREFIX + key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<Cached<T>>;
    return typeof parsed.savedAt === 'string' && 'value' in parsed ? (parsed as Cached<T>) : null;
  } catch {
    return null;
  }
}

export function writeCache(
  key: string,
  value: unknown,
  now = new Date(),
  storage: Storage | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    const raw = JSON.stringify({ savedAt: now.toISOString(), value });
    if (raw.length > MAX_ENTRY_CHARS) return;
    storage.setItem(PREFIX + key, raw);
  } catch {
    // Quota or privacy mode: caching is best effort.
  }
}

/** Removes every Panel entry (Settings › Data › purge cache, logout). */
export function clearCache(storage: Storage | null = defaultStorage()): void {
  if (storage === null) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith('panel:') === true) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Ignore.
  }
}
