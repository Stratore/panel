interface Pending {
  key: string;
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Runs tasks with a global concurrency cap and at most one task per key at a time
 * (SPEC § 7.3: one request per domain, 4 overall). FIFO within those constraints.
 */
export class TaskQueue {
  private running = 0;
  private readonly activeKeys = new Set<string>();
  private readonly pending: Pending[] = [];

  constructor(private readonly maxConcurrent = 4) {}

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ key, task, resolve: resolve as (value: unknown) => void, reject });
      this.drain();
    });
  }

  get size(): { running: number; pending: number } {
    return { running: this.running, pending: this.pending.length };
  }

  private drain(): void {
    while (this.running < this.maxConcurrent) {
      const index = this.pending.findIndex((p) => !this.activeKeys.has(p.key));
      if (index === -1) return;
      const [next] = this.pending.splice(index, 1);
      if (!next) return;
      this.running++;
      this.activeKeys.add(next.key);
      next
        .task()
        .then(next.resolve, next.reject)
        .finally(() => {
          this.running--;
          this.activeKeys.delete(next.key);
          this.drain();
        });
    }
  }
}

/** Queue key for a URL: its hostname, so requests to one site never overlap. */
export function domainKey(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}
