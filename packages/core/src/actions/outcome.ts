import type { ErrorCategory } from './category.js';

// The vocabulary of how one invocation ends. An outcome is decided once and never edited; every
// failed and canceled variant names the stage it was decided in, so a hook (and `onFinally`) can
// tell "the handler never started" from "the handler may already have done its work".

/** 'subject-changed': the binding's subject reader returned a different value than at activation. */
export type CancelCause = 'replaced' | 'disposed' | 'subject-changed';

/**
 * Every failure carries a `category` beside its `kind`. The kind says what the runtime saw; the
 * category says why, as far as the evidence goes, and is `'unknown'` when nothing established it.
 * Where a failure has an original `error`, that value is kept untouched for inspection (an
 * `ActionError` keeps the error it wrapped as its own `cause`). Neither is a message to show.
 */
interface Categorized {
  readonly category: ErrorCategory;
}

/**
 * Failures during the synchronous activation prefix. Nothing was awaited and no prerequisite or
 * handler has run. `atActivation` may already have performed its own effects: a token it took
 * into the scope before it failed is still released.
 */
export type InputFailure = (
  | { readonly kind: 'invalid-input'; readonly error: unknown }
  | { readonly kind: 'activation-error'; readonly error: unknown }
) &
  Categorized;

/** Failures while prerequisites run. The handler has not started and `provided` is incomplete. */
export type PrerequisiteFailure = (
  | { readonly kind: 'refused'; readonly prerequisite: string; readonly reason: string }
  | { readonly kind: 'prerequisite-error'; readonly prerequisite: string; readonly error: unknown }
  | { readonly kind: 'timeout' }
) &
  Categorized;

/**
 * Failures once the handler has started. `handler-error` and `timeout` say only that the handler
 * threw or had not settled: what it already did is unknown to the runtime, and neither a timeout
 * nor a cancellation shows that anything was rolled back or that a retry is safe. The two
 * success-hook kinds are different: the handler returned `result` before the required hook
 * failed, and that result is kept.
 */
export type RunningFailure<Result> = (
  | { readonly kind: 'handler-error'; readonly error: unknown }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'success-hook-error'; readonly error: unknown; readonly result: Result }
  | { readonly kind: 'success-hook-timeout'; readonly result: Result }
) &
  Categorized;

/** Steps after the outcome is decided. 'adopt' is a transfer callback that returned a thenable. */
export type CleanupStep = 'onFailure' | 'onCanceled' | 'onFinally' | 'release' | 'adopt';

/** A diagnostic about cleanup. It never changes the primary outcome. */
export type CleanupError =
  | { readonly step: CleanupStep; readonly reason: 'threw'; readonly error: unknown }
  | { readonly step: CleanupStep; readonly reason: 'budget-exceeded' | 'obsolete' };

/**
 * Canceled stages: 'prerequisites' and 'running' are before the handler's result was observed, so
 * no result exists. 'completing' is after it was observed, while the required success hook had not
 * finished, so the result is part of the outcome.
 */
export type Outcome<Result> =
  | { readonly status: 'succeeded'; readonly result: Result }
  | { readonly status: 'failed'; readonly stage: 'input'; readonly failure: InputFailure }
  | { readonly status: 'failed'; readonly stage: 'prerequisites'; readonly failure: PrerequisiteFailure }
  | { readonly status: 'failed'; readonly stage: 'running'; readonly failure: RunningFailure<Result> }
  | { readonly status: 'canceled'; readonly cause: CancelCause; readonly stage: 'prerequisites' }
  | { readonly status: 'canceled'; readonly cause: CancelCause; readonly stage: 'running' }
  | { readonly status: 'canceled'; readonly cause: CancelCause; readonly stage: 'completing'; readonly result: Result };

/**
 * The freshness check supplied to one callback. Each prerequisite, the handler and each hook gets
 * its own, distinct from the signal. It is true only while the runtime is still waiting for
 * this very callback, the binding is not disposed or replaced, the adapter reports the instance
 * live, and the subject (when one was given) still equals the one captured at activation. Each
 * call reads liveness and the subject afresh. It is a cooperative check for the moment before a
 * synchronous presentation write; it cannot recall a write that has already started.
 */
export interface Freshness {
  current(): boolean;
}

/** What a prerequisite that adds no values provides. */
export type NoValues = Record<never, never>;

/**
 * Telemetry: no parameters, provided values, results, error objects, categories or causes, by
 * construction. The failure kind is a fixed word, never text from an error.
 */
export type ObservedPhase =
  | 'ignored'
  | 'started'
  | 'prerequisites-settled'
  | 'handler-settled'
  | 'outcome-decided'
  | 'cleanup-error'
  | 'late-settlement'
  | 'finished';

export interface ObservedEvent {
  readonly label: string;
  /** Opaque, runtime-generated, unique within the page session; derived from no input. */
  readonly bindingId: string;
  /** Absent for 'ignored', where no invocation exists. */
  readonly invocationId?: string;
  /** Only for 'ignored': the invocation that was already busy. */
  readonly busyInvocationId?: string;
  readonly ignoredReason?: 'busy';
  readonly phase: ObservedPhase;
  readonly elapsedMs: number;
  readonly status?: 'succeeded' | 'failed' | 'canceled';
  readonly failureKind?: string;
  readonly cleanupStep?: CleanupStep;
}

/**
 * The runtime catches a synchronous throw and attaches a rejection handler to a returned promise,
 * so neither changes the action or becomes an unhandled rejection. It never awaits the result.
 */
export type ActionObserver = (event: ObservedEvent) => void | PromiseLike<void>;
