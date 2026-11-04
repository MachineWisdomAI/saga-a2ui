import { startBoundedTimer } from '../policy/index.js';
import { BudgetConfigurationError } from './lifetime.js';

// Bounds the work an application's token verifier starts. The request lifetime already stops WAITING
// for a verifier when its stage expires, but a verifier that ignores the stage and keeps running is
// still running: every request that presents a credential starts another call, so a slow identity
// provider (or a credential that makes the verifier slow) lets callers pile up abandoned work without
// bound. This module is the verifier's own bound, independent of the request that started the call:
//
//   - a concurrency cap on calls that have not SETTLED, refused at once when it is full (never queued);
//   - an `AbortSignal` handed to the verifier, aborted when the stage ends or the call is abandoned,
//     so a verifier that honors it stops and frees its slot;
//   - an abandonment deadline after which the CALLER stops waiting: the signal aborts and the wait
//     rejects, but the slot stays taken until the verifier actually settles.
//
// A slot counts running work, not waiting callers. JavaScript cannot stop a function that ignores its
// signal, so a call that never settles keeps its slot for the life of the wrapper; freeing the slot at
// the deadline would let repeated windows start unlimited work behind the cap. The cap is therefore the
// bound on actual verifier calls, and a verifier that ignores cancellation can use it up.
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
  /**
   * The most calls that may be unsettled at once. A call holds its slot until the verifier settles it,
   * even after the caller stopped waiting. Defaults to `DEFAULT_MAX_CONCURRENT_VERIFICATIONS`.
   */
  readonly maxConcurrent?: number;
  /**
   * How long a caller waits for one call before it is abandoned: the call's signal aborts and the wait
   * rejects with `VerifierAbandonedError`. The slot is NOT freed until the verifier settles, so a call
   * that ignores its signal and never settles keeps its slot. Defaults to `DEFAULT_VERIFIER_ABANDON_MS`.
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

/**
 * The rejection a caller gets when a call has not settled within its abandonment limit. The verifier
 * was told to stop through its signal; whether it did is not known, and its slot stays taken until it
 * settles. Like `VerifierSaturatedError` it is a verifier failure, not a rejected credential.
 */
export class VerifierAbandonedError extends Error {
  constructor() {
    super('The verifier did not settle within its abandonment limit.');
    this.name = 'VerifierAbandonedError';
  }
}

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
 * A rejection, including a synchronous throw, passes through unchanged. Each call holds one slot from
 * the moment it starts until the verifier settles it, whoever is still waiting. At the abandonment
 * deadline the signal aborts and the wait rejects with `VerifierAbandonedError`, so a caller is never
 * held past the limit; the slot is not recycled, so the cap bounds the verifier's real work. A late
 * outcome of an abandoned call is observed and ignored: it frees the slot and nothing else.
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
      const forward = () => own.abort(signal?.reason);
      const stopForwarding = () =>
        signal?.removeEventListener('abort', forward);

      const wait = new Promise<T>((resolve, reject) => {
        // The slot belongs to the verifier's work, not to whoever is waiting for it: it is freed only
        // when that work settles, however late.
        const cancelTimer = startBoundedTimer(abandonMs, () => {
          const error = new VerifierAbandonedError();
          own.abort(error);
          stopForwarding();
          reject(error);
        });
        const settled = () => {
          running -= 1;
          cancelTimer();
          stopForwarding();
        };

        if (signal?.aborted) forward();
        else signal?.addEventListener('abort', forward, { once: true });

        let work: Promise<T>;
        try {
          work = Promise.resolve(verifier.verifyAccessToken(token, own.signal));
        } catch (error) {
          work = Promise.reject(error);
        }
        // Both handlers are always supplied, so a late rejection of an abandoned call is observed.
        work.then(
          (value) => {
            settled();
            resolve(value);
          },
          (error: unknown) => {
            settled();
            reject(error);
          },
        );
      });
      // An abandoned wait may reject after its caller stopped listening; that is not an unhandled error.
      wait.then(undefined, () => undefined);
      return wait;
    },
  };
  if (limits === undefined) bounded.set(verifier, result);
  return result;
}
