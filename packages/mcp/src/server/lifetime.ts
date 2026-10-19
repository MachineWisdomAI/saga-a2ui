import { DEFAULT_OPERATION_MS, DEFAULT_REQUEST_MS, startBoundedTimer } from '../policy/index.js';

// The server request lifetime: one monotonic, absolute request deadline that starts when the
// adapter admits the request, plus the bounded operations that run inside it. This module is
// portable: it knows timers and abort signals, not HTTP. An adapter (for example a Node listener)
// starts a lifetime per request, reports disconnects and response completion to it, and lets each
// stage it owns run through `run`.
//
// Racing is the guarantee. A stage's work is raced against its limit, its enclosing operations and
// the request; losing work keeps running if it ignores its signal, but its result is dropped and no
// later stage starts. Nothing a stage does (progress, retries, callbacks, revisiting a stage) renews
// an enclosing budget, because every deadline is absolute and fixed when its scope begins.

/** Where in the request a wait happened. The adapter and the operation layer name their own stages. */
export type Stage =
  | 'admission'
  | 'authentication'
  | 'body'
  | 'handler'
  | 'authorization'
  | 'storage'
  | 'acquisition'
  | 'dependency'
  /** Writing a response (or keeping a stream flowing) to the peer. */
  | 'delivery';

/** Whether the stage could already have changed something. Expiry proves no rollback either way. */
export type Effect = 'none' | 'unknown';

/**
 * Why a stage or the request ended without a result. Internal and inspectable: it may hold the
 * original error, so it is never copied into caller-visible text.
 */
export type LifetimeCause =
  | { readonly kind: 'operation-timeout'; readonly stage: Stage; readonly limitMs: number; readonly effect: Effect }
  | { readonly kind: 'request-timeout'; readonly stage: Stage | undefined; readonly limitMs: number; readonly effect: Effect }
  | { readonly kind: 'cancelled'; readonly stage: Stage; readonly effect: Effect }
  | { readonly kind: 'disconnected'; readonly stage: Stage | undefined; readonly effect: Effect }
  | { readonly kind: 'auth-refused'; readonly status: 401 | 403 }
  | { readonly kind: 'dependency-failure'; readonly stage: Stage; readonly effect: Effect; readonly error: unknown }
  /** The response finished. Later stages are refused; this is not a cancellation. */
  | { readonly kind: 'completed' };

export type StageResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly cause: LifetimeCause };

/** Carries a cause through code that signals failure by throwing; `run` recognizes it and keeps the cause. */
export class StageFailure extends Error {
  constructor(readonly failure: LifetimeCause) {
    super('The bounded stage did not complete.');
    this.name = 'StageFailure';
  }
}

/** Returns the value of a finished stage, or throws its cause for code that handles failure by throwing. */
export function valueOrThrow<T>(result: StageResult<T>): T {
  if (!result.ok) throw new StageFailure(result.cause);
  return result.value;
}

/**
 * Throws the scope's cause if it has ended. Work that a late result could resume (an uncooperative
 * lookup answering after its stage was abandoned) calls this before its next owned effect: the gate
 * is checked by the code that would start the effect, not left to the callback stopping.
 */
export function throwIfEnded(scope: BoundedScope): void {
  const cause = scope.check();
  if (cause) throw new StageFailure(cause);
}

/** One or both budgets, as an application or route states them. Every supplied value is validated. */
export interface BudgetSettings {
  /** Finite wait for one operation. Defaults to `DEFAULT_OPERATION_MS`. */
  readonly operationMs?: number;
  /** Finite wait for the whole request, from admission. Defaults to `DEFAULT_REQUEST_MS`. */
  readonly requestMs?: number;
}

/** A budget is unusable. Names the setting, never a value that could be sensitive. */
export class BudgetConfigurationError extends Error {
  constructor(where: string, problems: readonly string[]) {
    super(`${where} is not configured: ${problems.join('; ')}.`);
    this.name = 'BudgetConfigurationError';
  }
}

const isBudget = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Throws before anything runs unless every supplied field is a finite positive number. */
export function assertBudgetSettings(where: string, settings: BudgetSettings | undefined): void {
  if (settings === undefined) return;
  if (typeof settings !== 'object' || settings === null) throw new BudgetConfigurationError(where, ['settings must be an object']);
  const problems: string[] = [];
  for (const field of ['operationMs', 'requestMs'] as const) {
    const value: unknown = settings[field];
    if (value !== undefined && !isBudget(value)) problems.push(`${field} must be a finite positive number`);
  }
  if (problems.length > 0) throw new BudgetConfigurationError(where, problems);
}

const now = (): number => performance.now();

const effectOf = (stage: Stage | undefined): Effect => (stage === undefined || stage === 'admission' || stage === 'authentication' || stage === 'body' ? 'none' : 'unknown');

/** Limits for stages that begin inside a scope. */
export interface RunOptions {
  /** This stage's own limit. A nested stage without one is bounded only by what its parent has left. */
  readonly limitMs?: number;
  /** Cancellation from the caller (for example the MCP request's signal), combined with this owner. */
  readonly upstream?: AbortSignal;
}

/** Something stages can run inside: a request lifetime, or the scope of one running operation. */
export interface BoundedScope {
  /** Aborts when this scope ends: it finished, timed out, was cancelled or an enclosing scope ended. */
  readonly signal: AbortSignal;
  /** What this scope has left: the least of its own deadline and every enclosing deadline. */
  remainingMs(): number;
  /**
   * Why this scope is over, or `undefined` while it is live. A deadline that has already passed counts
   * even when its timer has not been delivered yet (synchronous work, a starved event loop): the scope
   * ends now. Code that is about to start an owned effect asks this instead of waiting for the timer.
   */
  check(): LifetimeCause | undefined;
  /**
   * Runs one bounded stage. It does not start when the scope is already over or `upstream` is already
   * aborted. A result that loses the race to a limit, an enclosing deadline or cancellation is dropped.
   * Throws `BudgetConfigurationError` for an invalid `limitMs`, before `work` is called.
   */
  run<T>(stage: Stage, work: (scope: BoundedScope) => T | PromiseLike<T>, options?: RunOptions): Promise<StageResult<T>>;
}

/** The lifetime of one admitted request, owned by the adapter that admitted it. */
export interface RequestLifetime extends BoundedScope {
  /** Operation limit that applies to a stage that states none (route override, SDK instance, default). */
  readonly operationMs: number;
  readonly requestMs: number;
  /** The cause that ended the request, or `undefined` while it is live. */
  readonly cause: LifetimeCause | undefined;
  /** What went wrong inside stages, oldest first, for the adapter's own diagnostics. */
  readonly causes: readonly LifetimeCause[];
  /** Notes a cause the owner observed (an auth refusal, a dependency failure) without ending the request. */
  record(cause: LifetimeCause): void;
  /** The caller went away. Waiting stages stop and nothing more is written. */
  disconnect(): void;
  /** The transport finished the response. Clears the deadline; later stages are refused. */
  finish(): void;
  /** A streaming response was established: the request deadline stops, each later operation keeps its own bound. */
  releaseRequestBudget(): void;
}

class Scope implements BoundedScope {
  readonly #controller = new AbortController();
  protected deadline: number;

  constructor(
    private readonly parent: Scope | undefined,
    deadline: number,
    /** The operation limit for a nested stage that states none. Every scope in a request carries the same one. */
    private readonly childLimitMs: number,
    private readonly stage: Stage | undefined,
    private readonly limitMs: number,
  ) {
    this.deadline = deadline;
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  remainingMs(): number {
    const own = this.deadline - now();
    const remaining = this.parent === undefined ? own : Math.min(own, this.parent.remainingMs());
    return Math.max(0, remaining);
  }

  protected expiry(): LifetimeCause {
    return { kind: 'operation-timeout', stage: this.stage ?? 'handler', limitMs: this.limitMs, effect: effectOf(this.stage) };
  }

  /** Marks `stage` as running in the request, so a request timeout can say where it was waiting. */
  protected enter(stage: Stage): () => void {
    return this.parent ? this.parent.enter(stage) : () => undefined;
  }

  end(cause: LifetimeCause): void {
    if (this.#controller.signal.aborted) return;
    this.#controller.abort(cause);
  }

  protected reasonOf(): LifetimeCause {
    return this.#controller.signal.reason as LifetimeCause; // only `end` aborts this controller, and always with a cause
  }

  /** Ends an ancestor whose deadline has passed but whose timer has not run yet (a starved event loop). */
  check(): LifetimeCause | undefined {
    const chain: Scope[] = [];
    for (let scope: Scope | undefined = this; scope; scope = scope.parent) chain.unshift(scope);
    for (const scope of chain) {
      if (scope.signal.aborted) return scope.reasonOf();
      if (scope.deadline - now() <= 0) {
        const cause = scope.expiry();
        scope.end(cause);
        return cause;
      }
    }
    return undefined;
  }

  run<T>(stage: Stage, work: (scope: BoundedScope) => T | PromiseLike<T>, options: RunOptions = {}): Promise<StageResult<T>> {
    if (options.limitMs !== undefined && !isBudget(options.limitMs)) {
      throw new BudgetConfigurationError(`Stage "${stage}"`, ['limitMs must be a finite positive number']);
    }
    const refusal = this.check();
    if (refusal) return Promise.resolve({ ok: false, cause: refusal });
    if (options.upstream?.aborted) return Promise.resolve({ ok: false, cause: { kind: 'cancelled', stage, effect: effectOf(stage) } });

    // Each nested stage resolves its own limit (its override, else the operation limit that applies to the
    // whole request) and is then clamped by every enclosing deadline through the scope chain.
    const limit = options.limitMs ?? this.childLimitMs;
    const child = new Scope(this, now() + limit, this.childLimitMs, stage, limit);
    const leave = this.enter(stage);
    return new Promise<StageResult<T>>((resolve) => {
      let settled = false;
      let cancelTimer: (() => void) | undefined;
      const upstream = options.upstream;
      const detach = () => {
        cancelTimer?.();
        this.signal.removeEventListener('abort', onEnclosingEnded);
        upstream?.removeEventListener('abort', onCancelled);
        leave?.();
      };
      const settle = (result: StageResult<T>) => {
        if (settled) return;
        settled = true;
        detach();
        // Ending the child asks any work still holding its signal to stop; its result is already dropped.
        child.end(result.ok ? { kind: 'completed' } : result.cause);
        resolve(result);
      };
      const fail = (cause: LifetimeCause) => settle({ ok: false, cause });
      const onEnclosingEnded = () => fail(this.reasonOf());
      const onCancelled = () => fail({ kind: 'cancelled', stage, effect: effectOf(stage) });
      // A timer is only one way a deadline is noticed. Work that blocks the thread, or a continuation that
      // is delivered before the timer, would otherwise be accepted after the budget ran out; so a result,
      // success or failure, is first held against the absolute deadlines.
      const accept = (result: StageResult<T>) => {
        const overdue = child.check();
        settle(overdue ? { ok: false, cause: overdue } : result);
      };
      const errored = (error: unknown) =>
        accept({ ok: false, cause: error instanceof StageFailure ? error.failure : { kind: 'dependency-failure', stage, effect: effectOf(stage), error } });

      this.signal.addEventListener('abort', onEnclosingEnded, { once: true });
      upstream?.addEventListener('abort', onCancelled, { once: true });
      cancelTimer = startBoundedTimer(limit, () => fail(child.expiry()));
      try {
        Promise.resolve(work(child)).then((value) => accept({ ok: true, value }), errored);
        // Synchronous work has returned: if it overran, the stage is over now, whatever the promise says
        // (a later settlement is ignored, and a late rejection is still handled above).
        const overdue = child.check();
        if (overdue) fail(overdue);
      } catch (error) {
        errored(error);
      }
    });
  }
}

class Root extends Scope implements RequestLifetime {
  readonly #stages: Stage[] = [];
  readonly #causes: LifetimeCause[] = [];
  #cancelTimer: (() => void) | undefined;

  constructor(
    readonly operationMs: number,
    readonly requestMs: number,
  ) {
    super(undefined, now() + requestMs, operationMs, undefined, requestMs);
    this.#cancelTimer = startBoundedTimer(requestMs, () => this.end(this.expiry()));
  }

  get cause(): LifetimeCause | undefined {
    return this.signal.aborted ? this.reasonOf() : undefined;
  }

  get causes(): readonly LifetimeCause[] {
    return this.#causes;
  }

  protected override expiry(): LifetimeCause {
    const stage = this.#stages.at(-1);
    return { kind: 'request-timeout', stage, limitMs: this.requestMs, effect: effectOf(stage) };
  }

  protected override enter(stage: Stage): () => void {
    this.#stages.push(stage);
    return () => {
      const at = this.#stages.lastIndexOf(stage);
      if (at >= 0) this.#stages.splice(at, 1);
    };
  }

  override end(cause: LifetimeCause): void {
    if (this.signal.aborted) return;
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
    if (cause.kind !== 'completed') this.#causes.push(cause); // finishing normally is not something that went wrong
    super.end(cause);
  }

  record(cause: LifetimeCause): void {
    this.#causes.push(cause);
  }

  disconnect(): void {
    const stage = this.#stages.at(-1);
    this.end({ kind: 'disconnected', stage, effect: effectOf(stage) });
  }

  finish(): void {
    this.end({ kind: 'completed' });
  }

  releaseRequestBudget(): void {
    if (this.signal.aborted) return;
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
    this.deadline = Number.POSITIVE_INFINITY;
  }
}

/** Budgets for the requests one route admits. Everything is resolved and validated up front. */
export interface RequestBudgets {
  readonly operationMs: number;
  readonly requestMs: number;
  /** Starts the request deadline. Call it at admission, before the first credential, header or body wait. */
  startRequest(): RequestLifetime;
}

/** One SDK instance's settings. Instances share nothing: no timer, setting or mutable default. */
export interface ServerBudgets extends RequestBudgets {
  /** Resolves a route's overrides over this instance's settings, field by field. Throws on an invalid value. */
  forRoute(settings?: BudgetSettings): RequestBudgets;
}

function requestBudgets(operationMs: number, requestMs: number): RequestBudgets {
  return Object.freeze({
    operationMs,
    requestMs,
    startRequest: (): RequestLifetime => new Root(operationMs, requestMs),
  });
}

/**
 * Creates one SDK instance's budgets: per-route override, then this instance's setting, then the
 * SDK default (3,000 ms per operation, 10,000 ms per request). The settings are validated and copied
 * here, so a later change to the object passed in has no effect.
 */
export function createServerBudgets(settings?: BudgetSettings): ServerBudgets {
  assertBudgetSettings('Server budgets', settings);
  const operationMs = settings?.operationMs ?? DEFAULT_OPERATION_MS;
  const requestMs = settings?.requestMs ?? DEFAULT_REQUEST_MS;
  return Object.freeze({
    ...requestBudgets(operationMs, requestMs),
    forRoute(route?: BudgetSettings): RequestBudgets {
      assertBudgetSettings('Route budgets', route);
      return requestBudgets(route?.operationMs ?? operationMs, route?.requestMs ?? requestMs);
    },
  });
}
