export type SafeFetchErrorCode =
  | 'INVALID_URL'
  | 'URL_TOO_LONG'
  | 'PROTOCOL_NOT_ALLOWED'
  | 'CREDENTIALS_IN_URL'
  | 'PORT_NOT_ALLOWED'
  | 'DNS_FAILURE'
  | 'BLOCKED_ADDRESS'
  | 'TOO_MANY_REDIRECTS'
  | 'BAD_REDIRECT'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'CONTENT_TYPE_NOT_ALLOWED'
  | 'UNSUPPORTED_ENCODING'
  | 'NETWORK_ERROR'
  | 'XML_FORBIDDEN_DECLARATION'
  | 'XML_INVALID';

/**
 * Every refusal is typed so callers (collector health, the "Test feed" UI) can report which
 * check failed without leaking internals. Messages never include response bodies.
 */
export class SafeFetchError extends Error {
  override readonly name = 'SafeFetchError';

  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export const isSafeFetchError = (error: unknown): error is SafeFetchError =>
  error instanceof SafeFetchError;
