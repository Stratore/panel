import { isSafeFetchError, type SafeFetchResponse } from '@panel/safe-fetch';

/** SPEC § 7.3: 3 attempts, doubling delay from 2 s, capped at 60 s, with jitter. */
export const RETRY = {
  maxAttempts: 3,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  /** A Retry-After longer than this is not waited for: the run fails and the breaker decides. */
  maxRetryAfterMs: 5 * 60_000,
} as const;

/** A response that is neither 2xx nor 304. */
export class HttpStatusError extends Error {
  override readonly name = 'HttpStatusError';

  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(`HTTP ${String(status)}`);
  }
}

/** Parses Retry-After as seconds or as an HTTP date. */
export function parseRetryAfter(value: string | undefined, now: number): number | null {
  if (value === undefined || value.trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export function assertOk(response: SafeFetchResponse, now: number): SafeFetchResponse {
  if ((response.status >= 200 && response.status < 300) || response.status === 304) return response;
  throw new HttpStatusError(response.status, parseRetryAfter(response.headers['retry-after'], now));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof HttpStatusError) return error.status === 429 || error.status >= 500;
  return isSafeFetchError(error) && (error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR');
}

export interface RetryDeps {
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export async function withRetry<T>(task: () => Promise<T>, deps: RetryDeps): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= RETRY.maxAttempts || !isRetryable(error)) throw error;
      const backoff = Math.min(RETRY.maxDelayMs, RETRY.baseDelayMs * 2 ** (attempt - 1));
      const jittered = backoff * (0.8 + 0.4 * deps.random());
      const retryAfter = error instanceof HttpStatusError ? error.retryAfterMs : null;
      if (retryAfter !== null && retryAfter > RETRY.maxRetryAfterMs) throw error;
      await deps.sleep(Math.max(jittered, retryAfter ?? 0));
    }
  }
}
