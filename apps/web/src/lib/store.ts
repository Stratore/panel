/** A tiny observable value (SPEC § 10: signal / pub-sub). */
export interface Store<T> {
  get(): T;
  set(value: T): void;
  update(fn: (value: T) => T): void;
  /** Calls `fn` on every change (and immediately unless `immediate: false`); returns an unsubscribe. */
  subscribe(fn: (value: T) => void, options?: { immediate?: boolean }): () => void;
}

export function createStore<T>(initial: T, equals: (a: T, b: T) => boolean = Object.is): Store<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  const set = (next: T) => {
    if (equals(value, next)) return;
    value = next;
    for (const listener of [...listeners]) listener(value);
  };
  return {
    get: () => value,
    set,
    update: (fn) => {
      set(fn(value));
    },
    subscribe(fn, options = {}) {
      listeners.add(fn);
      if (options.immediate !== false) fn(value);
      return () => listeners.delete(fn);
    },
  };
}
