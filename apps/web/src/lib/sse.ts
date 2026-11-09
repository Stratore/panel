import { createStore } from './store.js';

export type StreamStatus = 'connecting' | 'live' | 'polling';
export type StreamEventType = 'item.new' | 'cve.updated' | 'source.health';

export interface StreamEvent {
  id: number;
  type: StreamEventType;
  payload: Record<string, unknown>;
}

export const streamStatus = createStore<StreamStatus>('connecting');

const EVENT_TYPES: readonly StreamEventType[] = ['item.new', 'cve.updated', 'source.health'];
/** After this many failed connections in a row, fall back to polling (SPEC § 10). */
export const MAX_FAILURES = 3;
export const POLL_MS = 2 * 60_000;
const RETRY_LIVE_MS = 10 * 60_000;

interface Options {
  onEvent: (event: StreamEvent) => void;
  /** Called every 2 minutes while the stream is unavailable. */
  onPoll: () => void;
  factory?: (url: string) => EventSource;
}

/**
 * Live updates through `EventSource` (which reconnects by itself, resuming with
 * `Last-Event-ID`). Repeated failures switch to polling, with a periodic attempt to go live
 * again. Returns a function that closes everything.
 */
export function connectStream(options: Options): () => void {
  const factory = options.factory ?? ((url: string) => new EventSource(url));
  let source: EventSource | null = null;
  let failures = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const stopPolling = () => {
    if (pollTimer !== null) clearInterval(pollTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    pollTimer = null;
    retryTimer = null;
  };

  const startPolling = () => {
    streamStatus.set('polling');
    pollTimer ??= setInterval(options.onPoll, POLL_MS);
    retryTimer ??= setTimeout(() => {
      stopPolling();
      open();
    }, RETRY_LIVE_MS);
  };

  const open = () => {
    streamStatus.set('connecting');
    source = factory('/api/stream');
    source.onopen = () => {
      failures = 0;
      stopPolling();
      streamStatus.set('live');
    };
    source.onerror = () => {
      failures++;
      if (failures >= MAX_FAILURES) {
        source?.close();
        source = null;
        failures = 0;
        startPolling();
      }
    };
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (raw) => {
        const message = raw as MessageEvent<string>;
        try {
          const payload = JSON.parse(message.data) as Record<string, unknown>;
          options.onEvent({ id: Number(message.lastEventId), type, payload });
        } catch {
          // Malformed frame: ignore.
        }
      });
    }
  };

  open();
  return () => {
    stopPolling();
    source?.close();
    source = null;
  };
}
