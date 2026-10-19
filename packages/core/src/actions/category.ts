// Why an action failed, as far as the evidence goes. The category supplements the stage and the
// failure kind that already say how far the work got; it never rewrites a decided outcome, and it
// is not a message to show: raw causes, server text and stack details stay with the application.

/** What the SDK itself can establish. An application may use any other non-empty string. */
export type KnownErrorCategory =
  | 'timeout'
  | 'canceled'
  | 'authentication-required'
  | 'permission-denied'
  | 'unavailable'
  | 'validation'
  | 'application'
  | 'unknown';

/**
 * Open on purpose: a consumer must handle a category it does not know, and `'unknown'` is the
 * fallback when nothing established a cause. `(string & {})` keeps the known names in editors.
 */
export type ErrorCategory = KnownErrorCategory | (string & Record<never, never>);

/**
 * A cause that says what happened. An application's handler, prerequisite or hook throws it when
 * it knows, for instance because the response was a 401 or the error was typed, and wraps the
 * original error as `cause`. Nothing is inferred from a message, a status code or a field a
 * foreign error merely happens to have: an error that is not an `ActionError` (or the platform's
 * own timeout and abort errors) is `'unknown'`, so an unfamiliar failure is never taken for an
 * authentication failure.
 */
export class ActionError extends Error {
  readonly category: ErrorCategory;

  constructor(category: ErrorCategory, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    if (typeof category !== 'string' || category === '') {
      throw new TypeError('An ActionError needs a non-empty category.');
    }
    this.name = 'ActionError';
    this.category = category;
  }
}

/**
 * The category the evidence in `error` supports, or `fallback` when it supports none: the kind of
 * failure the runtime itself decided on (for example input that could not be read) is that
 * evidence and is passed in as the fallback.
 */
export function categorize(error: unknown, fallback: ErrorCategory = 'unknown'): ErrorCategory {
  if (error instanceof ActionError) return error.category;
  // The platform's own typed errors (what `AbortSignal.timeout` and `fetch` reject with) are
  // DOMExceptions with these exact names. A plain Error that merely carries the same `name` is
  // not typed evidence.
  const platform: unknown = (globalThis as { DOMException?: unknown }).DOMException;
  if (typeof platform === 'function' && error instanceof platform) {
    const { name } = error as { name?: unknown };
    if (name === 'TimeoutError') return 'timeout';
    if (name === 'AbortError') return 'canceled';
  }
  return fallback;
}
