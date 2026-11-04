import { startBoundedTimer } from '../policy/index.js';
import { BudgetConfigurationError } from './lifetime.js';

// Bounds the work an application's token verifier starts. The request lifetime already stops WAITING
// for a verifier when its stage expires, but a verifier that ignores the stage and keeps running is
// still running: every request that presents a credential starts another call, so a slow identity
// provider (or a credential that makes the verifier slow) lets callers pile up abandoned work without
// bound. This module is the verifier's own bound, independent of the request that started the call:
//
//   - a concurrency cap on calls still running, refused at once when it is full (never queued);
//   - an `AbortSignal` handed to the verifier, aborted when the stage ends or the call is abandoned,
//     so a verifier that honors it stops and frees its slot early;
//   - an abandonment deadline, so a call that never settles cannot hold its slot forever.
//
// Portable like the lifetime: timers and abort signals only.

/**
 * The shape of the MCP SDK's token verifier with one optional addition: a signal that aborts when the
 * caller no longer needs the answer. A verifier written against the SDK's own one-parameter interface
 * is assignable to this one; it simply never reads the signal.
 */
export interface CancellableVerifier<T> {
  verifyAccessToken(token: string, signal?: AbortSignal): PromiseLike<T>;
}

/** What `boundVerifier` returns: the same call, always answering with a real `Promise`. */
export interface BoundedVerifier<T> extends CancellableVerifier<T> {
  verifyAccessToken(token: string, signal?: AbortSignal): Promise<T>;
}

/** Limits on one verifier's outstanding work. Every supplied value is validated. */
export interface VerifierLimits {
  /** The most calls that may be running at once. Defaults to `DEFAULT_MAX_CONCURRENT_VERIFICATIONS`. */
  readonly maxConcurrent?: number;
  /**
   * How long one call may run before it is abandoned: its signal aborts and its slot is freed whether
   * or not it ever settles. Defaults to `DEFAULT_VERIFIER_ABANDON_MS`.
   */
  readonly abandonMs?: number;
}

/** An overridable product default, not a throughput guarantee. */
export const DEFAULT_MAX_CONCURRENT_VERIFICATIONS = 64;
/** Ten times the default operation limit: long enough for a slow but live provider. */
export const DEFAULT_VERIFIER_ABANDON_MS = 30_000;

/**
 * Thrown (as a rejection) instead of calling the verifier when its cap is full. It is a verifier
 * failure, not a rejected credential: callers answer it as an unavailable dependency.
 */
export class VerifierSaturatedError extends Error {
  constructor() {
    super('The verifier is already running its maximum number of calls.');
    this.name = 'VerifierSaturatedError';
  }
}

const ABANDONED = 'The verifier did not settle within its abandonment limit.';

function resolveLimits(limits: VerifierLimits | undefined): {
  maxConcurrent: number;
  abandonMs: number;
} {
  if (limits !== undefined && (typeof limits !== 'object' || limits === null))
    throw new BudgetConfigurationError('Verifier limits', [
      'limits must be an object',
    ]);
  const maxConcurrent: unknown =
    limits?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_VERIFICATIONS;
  const abandonMs: unknown = limits?.abandonMs ?? DEFAULT_VERIFIER_ABANDON_MS;
  const problems: string[] = [];
  if (
    typeof maxConcurrent !== 'number' ||
    !Number.isSafeInteger(maxConcurrent) ||
    maxConcurrent < 1
  )
    problems.push('maxConcurrent must be a positive integer');
  if (
    typeof abandonMs !== 'number' ||
    !Number.isFinite(abandonMs) ||
    abandonMs <= 0
  )
    problems.push('abandonMs must be a finite positive number');
  if (problems.length > 0)
    throw new BudgetConfigurationError('Verifier limits', problems);
  return {
    maxConcurrent: maxConcurrent as number,
    abandonMs: abandonMs as number,
  };
}

const bounded = new WeakMap<object, BoundedVerifier<unknown>>();

/**
 * Returns a verifier that calls `verifier` under a concurrency cap, a cancellation signal and an
 * abandonment deadline. Pass the returned verifier wherever the original was used. State belongs to the
 * returned object: wrap once where the verifier is configured, not per request.
 *
 * Wrapping the same verifier object again with default limits returns the wrapper it already made, so a
 * caller that cannot tell whether it was given a bounded verifier still shares one cap.
 *
 * A rejection, including a synchronous throw, passes through unchanged. A late result from an abandoned
 * call is ignored by this wrapper; the caller's own deadline decides whether it was still wanted.
 */
export function boundVerifier<T>(
  verifier: CancellableVerifier<T>,
  limits?: VerifierLimits,
): BoundedVerifier<T> {
  const { maxConcurrent, abandonMs } = resolveLimits(limits);
  if (limits === undefined) {
    const existing = bounded.get(verifier);
    if (existing) return existing as BoundedVerifier<T>;
  }
  let running = 0;

  const result: BoundedVerifier<T> = {
    verifyAccessToken(token, signal) {
      if (running >= maxConcurrent)
        return Promise.reject(new VerifierSaturatedError());
      running += 1;

      const own = new AbortController();
      let freed = false;
      let cancelTimer: (() => void) | undefined;
      const forward = () => own.abort(signal?.reason);
      const free = () => {
        if (freed) return;
        freed = true;
        running -= 1;
        cancelTimer?.();
        signal?.removeEventListener('abort', forward);
      };

      if (signal?.aborted) forward();
      else signal?.addEventListener('abort', forward, { once: true });
      cancelTimer = startBoundedTimer(abandonMs, () => {
        own.abort(new Error(ABANDONED));
        free();
      });

      let work: Promise<T>;
      try {
        work = Promise.resolve(verifier.verifyAccessToken(token, own.signal));
      } catch (error) {
        work = Promise.reject(error);
      }
      // The slot belongs to the call, not to whoever is waiting for it: it is freed when the call ends.
      work.then(free, free);
      return work;
    },
  };
  if (limits === undefined) bounded.set(verifier, result);
  return result;
}
