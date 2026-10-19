import type { ActionPlan, CanceledContext, FailureContext } from './definition.js';
import type {
  ActionObserver,
  CancelCause,
  CleanupError,
  CleanupStep,
  ObservedEvent,
  ObservedPhase,
  Outcome,
  PrerequisiteFailure,
} from './outcome.js';
import { categorize } from './category.js';
import { timerDelay, type ResolvedLimits } from './limits.js';
import { readAnswer, type Prerequisite } from './prerequisite.js';
import { InvocationResources } from './scope.js';
import { requestTimeout, type ServerCalls, type ServerTransport } from './server.js';
import { discardOutcome, isThenable } from './thenable.js';

// One activation that was admitted, from the user's event to its settlement. The runtime owns every
// timer, the abort signals and each callback's eligibility; the binding owns the busy policy and the
// phase it shows. Nothing here imports a renderer: the adapter's part of the seam is `Seam`.

/** What the adapter and the application supply for one binding. */
export interface Seam {
  /** A fresh pull on every call, never a cached answer: is this still the instance that was bound? */
  readonly isLive: () => boolean;
  /** The application's reader for the item the instance shows now. Absent: no replacement is detected. */
  readonly subject?: (() => unknown) | undefined;
  /**
   * Calls `revalidate` after each change the adapter can observe, and returns the unsubscribe. The
   * runtime subscribes only while an invocation is not settled; each call requests the same recheck
   * any checkpoint performs and never produces a different outcome.
   */
  readonly watchScope?: ((revalidate: () => void) => () => void) | undefined;
}

/** The binding as one of its invocations sees it. */
export interface InvocationOwner<Event> {
  readonly bindingId: string;
  isDisposed(): boolean;
  /** The outcome was decided: the binding moves to `settling` if this invocation owns its phase. */
  decided(invocation: Invocation<Event>): void;
  /** Finalization finished: the binding returns to `idle` if this invocation still owns its phase. */
  settled(invocation: Invocation<Event>): void;
  /** The instance is no longer live: the binding is retired, which disposes it. */
  retire(): void;
}

let invocationCount = 0;

type Timer = ReturnType<typeof setTimeout>;
type Settled = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown };
type WorkStage = 'prerequisites' | 'running' | 'completing';
type StepKind = 'prerequisite' | 'handler' | 'onSuccess' | 'onFailure' | 'onCanceled' | 'release' | 'onFinally';

/** What telemetry needs to know about a definition. */
export interface Observable {
  readonly label: string;
  readonly observer: ActionObserver | undefined;
}

/** Tells an observer something happened. It cannot affect the action, and it is never awaited. */
export function emitObservation(
  plan: Observable,
  bindingId: string,
  startedAt: number,
  event: Omit<ObservedEvent, 'label' | 'bindingId' | 'elapsedMs'>,
): void {
  const { observer } = plan;
  if (observer === undefined) return;
  try {
    const returned: unknown = observer({ label: plan.label, bindingId, elapsedMs: Date.now() - startedAt, ...event });
    if (isThenable(returned)) discardOutcome(returned);
  } catch {
    // An observer cannot affect the action.
  }
}

/**
 * One callback the runtime is waiting for. Its eligibility is the runtime's own bookkeeping behind
 * `current()`: it ends permanently, with no way back, when the callback finishes, when its budget
 * expires, or when the runtime stops waiting for it.
 */
class Step {
  eligible = true;
  timer: Timer | undefined;
  /** Hook steps have their own signal; work steps share the invocation's. */
  constructor(
    readonly kind: StepKind,
    readonly signal: AbortSignal,
    private readonly own: AbortController | undefined,
    /** Called once when the runtime stops waiting because the invocation became obsolete. */
    readonly onObsolete: (() => void) | undefined,
  ) {}

  /** The callback finished while the runtime was still waiting. False when it had already stopped. */
  close(): boolean {
    const waiting = this.eligible;
    this.eligible = false;
    this.clearTimer();
    return waiting;
  }

  /** The runtime stops waiting. A hook's own signal aborts; the work signal is the invocation's to abort. */
  abandon(): void {
    this.eligible = false;
    this.clearTimer();
    this.own?.abort();
  }

  clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

interface StepSpec {
  readonly kind: StepKind;
  /** A hook step: the runtime's budget for it, and what to do when that runs out. */
  readonly budget?: { readonly ms: number; readonly expire: () => void };
  readonly onObsolete?: () => void;
  readonly onResult: (settled: Settled) => void;
}

const noUnsubscribe = (): void => undefined;

export class Invocation<Event> {
  readonly id = `invocation-${++invocationCount}`;

  private readonly startedAt = Date.now();
  private readonly controller = new AbortController();
  private step: Step | undefined;
  private depth = 0;
  private readonly deferred: (() => void)[] = [];

  private params: unknown;
  /** What `atActivation` returned; `undefined` for an action without it. */
  private activation: unknown;
  private readonly resources: InvocationResources;
  private provided: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  private result: unknown;
  private stage: WorkStage = 'prerequisites';
  private outcome: Outcome<unknown> | undefined;
  private readonly cleanupErrors: CleanupError[] = [];
  private subjectAtStart: unknown;
  private subjectCaptured = false;
  private deadlineTimer: Timer | undefined;
  private workStartedAt = 0;
  private unwatch: () => void = noUnsubscribe;
  private activating = false;
  /** True while the `atActivation` callback runs, when a cancellation is noted but not yet decided. */
  private activationRunning = false;
  private pendingCancel: CancelCause | undefined;
  private rethrow: { readonly error: unknown } | undefined;

  private replacedFlag = false;
  private obsoleteFlag = false;
  private settledFlag = false;

  constructor(
    private readonly plan: ActionPlan<Event>,
    private readonly owner: InvocationOwner<Event>,
    private readonly seam: Seam,
    /** Resolved once, when the binding was made, from immutable inputs: no clock can move afterwards. */
    private readonly limits: ResolvedLimits,
  ) {
    this.resources = new InvocationResources({
      label: plan.label,
      // The scope is active until the outcome is decided: that is work activity, not freshness.
      isActive: () => this.outcome === undefined && this.pendingCancel === undefined,
      hookMs: () => this.limits.hookMs,
      report: (step) => this.emit('cleanup-error', { cleanupStep: step }),
    });
  }

  /**
   * Runs the invocation as far as it can without waiting. Returns the error to hand back to the
   * event's own caller: a failure decided in this call stack for an action with no `onFailure` to
   * receive it, because swallowing it would hide it.
   */
  start(event: Event): { readonly error: unknown } | undefined {
    this.activating = true;
    try {
      this.emit('started');
      if (!this.prefix(event)) return this.rethrow;
      this.watch();
      this.workStartedAt = Date.now();
      this.nextPrerequisite(0);
      return this.rethrow;
    } finally {
      this.activating = false;
    }
  }

  /** A checkpoint: reads liveness and the subject now and applies the outcome rule to what it finds. */
  recheck(): void {
    if (this.settledFlag || this.obsoleteFlag) return;
    const cause = this.staleCause();
    if (cause === 'not-live') this.owner.retire();
    else if (cause !== undefined) this.makeObsolete(cause);
  }

  /** A newer activation replaces this one. An undecided invocation is canceled; a decided one keeps its outcome. */
  replaced(): void {
    this.replacedFlag = true;
    this.makeObsolete('replaced');
  }

  /** The binding was disposed. */
  disposed(): void {
    this.makeObsolete('disposed');
  }

  // -------------------------------------------------------------------------------------------
  // Freshness
  // -------------------------------------------------------------------------------------------

  private staleCause(): CancelCause | 'not-live' | undefined {
    if (this.replacedFlag) return 'replaced';
    if (this.owner.isDisposed()) return 'disposed';
    if (!this.live()) return 'not-live';
    if (this.seam.subject !== undefined && this.subjectChanged()) return 'subject-changed';
    return undefined;
  }

  private live(): boolean {
    try {
      return this.seam.isLive();
    } catch {
      return false;
    }
  }

  /** A reader that throws later counts as a change. An invocation that never captured a subject has none to compare. */
  private subjectChanged(): boolean {
    if (!this.subjectCaptured) return false;
    try {
      return !Object.is(this.seam.subject?.(), this.subjectAtStart);
    } catch {
      return true;
    }
  }

  /** The callback's own `current()`. Calling it is a checkpoint, but only while the callback is eligible. */
  private currentFor(step: Step): boolean {
    if (!step.eligible) return false;
    this.recheck();
    return step.eligible && !this.obsoleteFlag && this.staleCause() === undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Becoming obsolete
  // -------------------------------------------------------------------------------------------

  private makeObsolete(cause: CancelCause): void {
    if (this.obsoleteFlag || this.settledFlag) return;
    this.obsoleteFlag = true;
    this.stopWatching();
    if (this.outcome === undefined) {
      this.cancel(cause);
      return;
    }
    // Decided: the outcome stays as it was and only a presentation hook still running is affected.
    const { step } = this;
    if (step?.onObsolete === undefined) return;
    step.abandon();
    this.step = undefined;
    step.onObsolete();
  }

  private cancel(cause: CancelCause): void {
    if (this.activationRunning) {
      // The activation has not produced its value yet. Whether this is a cancellation or the
      // callback's own failure is decided when the callback returns, so a canceled hook that is
      // typed as carrying `activation` never runs without one. The scope stops being active now.
      this.pendingCancel ??= cause;
      return;
    }
    const stage = this.stage;
    this.controller.abort();
    this.abandonStep();
    if (stage === 'completing') this.decide({ status: 'canceled', cause, stage, result: this.result });
    else if (stage === 'running') this.decide({ status: 'canceled', cause, stage });
    else this.decide({ status: 'canceled', cause, stage });
  }

  private abandonStep(): void {
    const { step } = this;
    this.step = undefined;
    step?.abandon();
  }

  // -------------------------------------------------------------------------------------------
  // Activation prefix
  // -------------------------------------------------------------------------------------------

  /**
   * Reads the input and the subject, then runs `atActivation`, all in the event's own call stack
   * and in that order, so the activation work never runs for an event whose input or subject
   * already failed. False when the invocation ended.
   */
  private prefix(event: Event): boolean {
    try {
      const { extract } = this.plan;
      this.params = extract === undefined ? undefined : extract(event);
      if (isThenable(this.params)) {
        discardOutcome(this.params);
        this.params = undefined;
        throw new TypeError(
          `The input callback of action '${this.plan.label}' returned a promise. ` +
            'It runs in the event itself; return a value synchronously.',
        );
      }
      this.subjectAtStart = this.seam.subject?.();
      this.subjectCaptured = true;
    } catch (error) {
      this.decide({
        status: 'failed',
        stage: 'input',
        failure: { kind: 'invalid-input', error, category: categorize(error, 'validation') },
      });
      return false;
    }
    return this.outcome === undefined && this.activate(event);
  }

  /**
   * Runs `atActivation` synchronously. What it took into the scope before it threw is released by
   * the ordinary end of the invocation. The runtime never continues the invocation inside the
   * callback's own call stack: a cancellation from inside it (`dispose()`, say) is noted and
   * decided when the callback returns. If the callback returned, `activation` is set by then, so
   * the canceled hook can still end that resource. If it threw, no activation value exists, so the
   * callback's failure is the outcome (stage `input`, which carries no `activation`) and the
   * cancellation only leaves the invocation obsolete: the failure hook does not present, and the
   * scope still releases what it owned.
   */
  private activate(event: Event): boolean {
    const { activate } = this.plan;
    if (activate === undefined) return true;
    let returned: unknown;
    let threw: { readonly error: unknown } | undefined;
    this.depth += 1;
    this.activationRunning = true;
    try {
      returned = activate({ event, scope: this.resources.activation });
      // A thenable is a failure of the callback, so the check belongs to the same boundary.
      if (isThenable(returned)) {
        discardOutcome(returned);
        returned = undefined;
        throw new TypeError(
          `The atActivation callback of action '${this.plan.label}' returned a promise. ` +
            'It runs in the event itself; start awaited work in before or run.',
        );
      }
    } catch (error) {
      threw = { error };
    }
    this.activationRunning = false;
    this.depth -= 1;
    const pending = this.pendingCancel;
    this.pendingCancel = undefined;
    if (threw !== undefined) {
      this.decide({
        status: 'failed',
        stage: 'input',
        failure: { kind: 'activation-error', error: threw.error, category: categorize(threw.error) },
      });
    } else {
      this.activation = returned;
    }
    // A cancellation noted inside the callback is decided now, after the activation value exists.
    // If the callback threw, its failure is already the outcome and its cleanup may have started:
    // the cancellation had already made the invocation obsolete, and it must not abort or abandon
    // the step that belongs to that outcome.
    if (pending !== undefined && this.outcome === undefined) this.cancel(pending);
    this.drain();
    return this.outcome === undefined;
  }

  private watch(): void {
    const { watchScope } = this.seam;
    if (watchScope === undefined) return;
    try {
      this.unwatch = watchScope(() => this.recheck());
    } catch {
      // A failing subscription cannot affect the action; checkpoints still find the change.
    }
  }

  private stopWatching(): void {
    const unwatch = this.unwatch;
    this.unwatch = noUnsubscribe;
    try {
      unwatch();
    } catch {
      // See `watch`.
    }
  }

  // -------------------------------------------------------------------------------------------
  // Prerequisites and the handler: bounded together by the work deadline
  // -------------------------------------------------------------------------------------------

  private nextPrerequisite(index: number): void {
    if (this.outcome !== undefined) return;
    this.recheck();
    if (this.outcome !== undefined) return;
    const { prerequisites } = this.plan;
    const current = prerequisites[index];
    if (current === undefined) {
      if (prerequisites.length > 0) this.emit('prerequisites-settled');
      this.startHandler();
      return;
    }
    this.runStep(
      {
        kind: 'prerequisite',
        onResult: (settled) => this.afterPrerequisite(current, index, settled),
      },
      (step) =>
        current.run({
          provided: this.providedSnapshot(),
          params: this.params,
          signal: this.controller.signal,
          scope: this.resources.invocation,
          current: () => this.currentFor(step),
        }),
    );
  }

  private afterPrerequisite(current: Prerequisite<object, unknown, unknown>, index: number, settled: Settled): void {
    // A change nobody saw until now cancels the invocation before this answer counts.
    this.recheck();
    if (this.outcome !== undefined) return;
    const failure = (failed: PrerequisiteFailure): void => {
      this.decide({ status: 'failed', stage: 'prerequisites', failure: failed });
    };
    const broken = (error: unknown): void =>
      failure({ kind: 'prerequisite-error', prerequisite: current.label, error, category: categorize(error) });
    if (!settled.ok) return broken(settled.error);
    const answer = readAnswer(settled.value);
    // A refusal is the application's own answer. Its reason text is not evidence of why.
    if (answer.kind === 'refuse') {
      return failure({ kind: 'refused', prerequisite: current.label, reason: answer.reason, category: 'application' });
    }
    if (answer.kind === 'malformed') {
      return broken(new TypeError(`Prerequisite '${current.label}' must answer with proceed(...) or refuse(...).`));
    }
    for (const key of Object.keys(answer.provides)) {
      if (key in this.provided) {
        return broken(new TypeError(`Prerequisite '${current.label}' provides '${key}', which an earlier prerequisite already provided.`));
      }
    }
    for (const [key, value] of Object.entries(answer.provides)) {
      Object.defineProperty(this.provided, key, { value, enumerable: true, writable: false, configurable: false });
    }
    this.nextPrerequisite(index + 1);
  }

  private providedSnapshot(): Record<string, unknown> {
    return Object.freeze(Object.assign(Object.create(null) as Record<string, unknown>, this.provided));
  }

  private startHandler(): void {
    this.stage = 'running';
    this.runStep(
      {
        kind: 'handler',
        onResult: (settled) => {
          this.clearDeadline();
          // The handler's answer is observed here. A change nobody saw until now cancels the
          // invocation before the answer counts: the decision is the point after which nothing is delivered.
          this.recheck();
          if (this.outcome !== undefined) return;
          if (!settled.ok) {
            this.decide({
              status: 'failed',
              stage: 'running',
              failure: { kind: 'handler-error', error: settled.error, category: categorize(settled.error) },
            });
            return;
          }
          this.result = settled.value;
          this.stage = 'completing';
          this.emit('handler-settled');
          this.startSuccess();
        },
      },
      (step) =>
        this.plan.handler({
          params: this.params,
          activation: this.activation,
          provided: this.providedSnapshot(),
          signal: this.controller.signal,
          scope: this.resources.invocation,
          current: () => this.currentFor(step),
          ...(this.plan.transport === undefined ? {} : { call: this.serverCall(step, this.plan.transport) }),
        }),
    );
  }

  /**
   * The handler's way to reach the server. The runtime, not the handler, builds the request
   * options: the invocation's signal, and as timeout what is left of the work deadline, or less if
   * the handler asked for less. A call from a handler the runtime stopped waiting for sends nothing.
   * A rejection of the transport is the handler's to see, and arrives as `handler-error` unless
   * the deadline or a cancellation decided first.
   */
  private serverCall(step: Step, transport: ServerTransport): ServerCalls['call'] {
    const { label } = this.plan;
    return async (name, args, options) => {
      // Reading the options first makes a malformed request fail the same way at any time.
      const asked = (options as { timeoutMs?: unknown } | undefined)?.timeoutMs;
      if (typeof name !== 'string' || name === '') throw new TypeError(`Action '${label}': a server call needs a tool name.`);
      this.recheck();
      const remainingMs = this.limits.deadlineMs - (Date.now() - this.workStartedAt);
      if (!step.eligible || this.controller.signal.aborted || remainingMs <= 0) {
        throw new Error(`Action '${label}': the invocation stopped waiting for this handler, so the request was not sent.`);
      }
      const timeout = requestTimeout(label, remainingMs, asked);
      return transport.callServerTool({ name, arguments: args }, { signal: this.controller.signal, timeout });
    };
  }

  private armDeadline(): void {
    if (this.deadlineTimer !== undefined || this.outcome !== undefined) return;
    // Counted from the end of the activation prefix, so progress and a later wait never extend it.
    const remaining = Math.max(0, this.limits.deadlineMs - (Date.now() - this.workStartedAt));
    this.deadlineTimer = setTimeout(() => this.onDeadline(), timerDelay(remaining));
  }

  private clearDeadline(): void {
    if (this.deadlineTimer !== undefined) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = undefined;
  }

  private onDeadline(): void {
    this.deadlineTimer = undefined;
    if (this.outcome !== undefined) return;
    const stage = this.stage;
    if (stage === 'completing') return;
    // The callback's permission ends first: abort listeners run synchronously inside `abort()`.
    this.abandonStep();
    this.controller.abort();
    this.decide(
      stage === 'prerequisites'
        ? { status: 'failed', stage, failure: { kind: 'timeout', category: 'timeout' } }
        : { status: 'failed', stage, failure: { kind: 'timeout', category: 'timeout' } },
    );
  }

  // -------------------------------------------------------------------------------------------
  // Required success work: it decides success
  // -------------------------------------------------------------------------------------------

  private startSuccess(): void {
    const hook = this.plan.hooks.onSuccess;
    if (hook === undefined) {
      this.decide({ status: 'succeeded', result: this.result });
      return;
    }
    const result = this.result;
    this.runHook(
      'onSuccess',
      (step) =>
        hook({
          ...this.hookBase(step),
          params: this.params,
          activation: this.activation,
          provided: this.providedSnapshot(),
          result,
        }),
      {
        onResult: (settled) => {
          // Required success work may finish without any presentation write, so nothing else has
          // checked the instance: a change nobody saw until now cancels before success is decided.
          this.recheck();
          if (this.outcome !== undefined) return;
          if (settled.ok) this.decide({ status: 'succeeded', result });
          else
            this.decide({
              status: 'failed',
              stage: 'running',
              failure: { kind: 'success-hook-error', error: settled.error, result, category: categorize(settled.error) },
            });
        },
        expire: () =>
          this.decide({ status: 'failed', stage: 'running', failure: { kind: 'success-hook-timeout', result, category: 'timeout' } }),
      },
    );
  }

  // -------------------------------------------------------------------------------------------
  // The decision, the outcome hook and finalization
  // -------------------------------------------------------------------------------------------

  private decide(outcome: Outcome<unknown>): void {
    if (this.outcome !== undefined) return;
    this.abandonStep();
    this.clearDeadline();
    this.outcome = outcome;
    if (this.activating && outcome.status === 'failed' && this.plan.hooks.onFailure === undefined) {
      const { failure } = outcome;
      if ('error' in failure) this.rethrow = { error: failure.error };
    }
    this.emit('outcome-decided', {
      status: outcome.status,
      ...(outcome.status === 'failed' ? { failureKind: outcome.failure.kind } : {}),
    });
    this.owner.decided(this);
    this.later(() => this.runOutcomeHook());
  }

  private runOutcomeHook(): void {
    const outcome = this.outcome;
    if (outcome === undefined || outcome.status === 'succeeded') return this.releaseHeld();
    if (outcome.status === 'canceled') {
      const hook = this.plan.hooks.onCanceled;
      if (hook === undefined) return this.releaseHeld();
      this.runHook('onCanceled', (step) => hook(this.canceledContext(step, outcome)), {
        onResult: (settled) => this.afterCleanup('onCanceled', settled),
        expire: () => this.cleanupOverran('onCanceled'),
      });
      return;
    }
    const hook = this.plan.hooks.onFailure;
    if (hook === undefined) return this.releaseHeld();
    // The presentation hook does not start for an invocation that is already obsolete.
    this.recheck();
    if (this.obsoleteFlag) {
      this.recordCleanup({ step: 'onFailure', reason: 'obsolete' });
      return this.releaseHeld();
    }
    this.runHook('onFailure', (step) => hook(this.failureContext(step, outcome)), {
      onResult: (settled) => this.afterCleanup('onFailure', settled),
      expire: () => this.cleanupOverran('onFailure'),
      onObsolete: () => {
        this.recordCleanup({ step: 'onFailure', reason: 'obsolete' });
        this.later(() => this.releaseHeld());
      },
    });
  }

  private afterCleanup(step: CleanupStep, settled: Settled): void {
    if (!settled.ok) this.recordCleanup({ step, reason: 'threw', error: settled.error });
    this.releaseHeld();
  }

  private cleanupOverran(step: CleanupStep): void {
    this.recordCleanup({ step, reason: 'budget-exceeded' });
    this.releaseHeld();
  }

  /**
   * Releases every token the scope still holds, newest first, one step each with its own signal and
   * its own `hookMs` budget, and then finalizes. A release that throws or overruns is a cleanup
   * diagnostic, never a change of outcome, and does not stop the releases after it. Releasing runs
   * for an obsolete invocation too: nothing here presents.
   */
  private releaseHeld(): void {
    const hold = this.resources.takeLast();
    if (hold === undefined) return this.finalize();
    this.runStep(
      {
        kind: 'release',
        budget: {
          ms: this.limits.hookMs,
          expire: () => {
            this.recordCleanup({ step: 'release', reason: 'budget-exceeded' });
            this.releaseHeld();
          },
        },
        onResult: (settled) => {
          if (!settled.ok) this.recordCleanup({ step: 'release', reason: 'threw', error: settled.error });
          this.releaseHeld();
        },
      },
      (step) => hold.release(hold.token, { signal: step.signal }),
    );
  }

  /** Finalization always occurs: a configured `onFinally` runs last, and then the invocation settles. */
  private finalize(): void {
    const hook = this.plan.hooks.onFinally;
    const outcome = this.outcome;
    if (hook === undefined || outcome === undefined) return this.settle();
    this.runHook('onFinally', (step) => hook({ ...this.hookBase(step), outcome, cleanupErrors: [...this.cleanupErrors], obsolete: this.obsoleteFlag }), {
      onResult: (settled) => {
        if (!settled.ok) this.emit('cleanup-error', { cleanupStep: 'onFinally' });
        this.settle();
      },
      expire: () => {
        this.emit('cleanup-error', { cleanupStep: 'onFinally' });
        this.settle();
      },
    });
  }

  private settle(): void {
    if (this.settledFlag) return;
    this.settledFlag = true;
    this.clearDeadline();
    this.stopWatching();
    this.emit('finished', this.outcome === undefined ? {} : { status: this.outcome.status });
    this.owner.settled(this);
  }

  private recordCleanup(error: CleanupError): void {
    this.cleanupErrors.push(error);
    this.emit('cleanup-error', { cleanupStep: error.step });
  }

  // -------------------------------------------------------------------------------------------
  // Hook contexts
  // -------------------------------------------------------------------------------------------

  private hookBase(step: Step): { readonly signal: AbortSignal; readonly current: () => boolean } {
    return { signal: step.signal, current: () => this.currentFor(step) };
  }

  private failureContext(
    step: Step,
    outcome: Extract<Outcome<unknown>, { status: 'failed' }>,
  ): FailureContext<unknown, unknown, unknown, unknown> {
    const base = this.hookBase(step);
    const { params, activation } = this;
    if (outcome.stage === 'input') return { ...base, stage: outcome.stage, failure: outcome.failure };
    if (outcome.stage === 'prerequisites') {
      return { ...base, stage: outcome.stage, failure: outcome.failure, params, activation };
    }
    return { ...base, stage: outcome.stage, failure: outcome.failure, params, activation, provided: this.providedSnapshot() };
  }

  private canceledContext(
    step: Step,
    outcome: Extract<Outcome<unknown>, { status: 'canceled' }>,
  ): CanceledContext<unknown, unknown, unknown, unknown> {
    const base = this.hookBase(step);
    const { cause } = outcome;
    const { params, activation } = this;
    if (outcome.stage === 'prerequisites') return { ...base, stage: outcome.stage, cause, params, activation };
    if (outcome.stage === 'running') {
      return { ...base, stage: outcome.stage, cause, params, activation, provided: this.providedSnapshot() };
    }
    return { ...base, stage: outcome.stage, cause, params, activation, provided: this.providedSnapshot(), result: outcome.result };
  }

  // -------------------------------------------------------------------------------------------
  // Waiting for one callback
  // -------------------------------------------------------------------------------------------

  private runHook(
    kind: Extract<StepKind, 'onSuccess' | 'onFailure' | 'onCanceled' | 'onFinally'>,
    invoke: (step: Step) => unknown,
    handling: { readonly onResult: (settled: Settled) => void; readonly expire: () => void; readonly onObsolete?: () => void },
  ): void {
    this.runStep(
      {
        kind,
        budget: { ms: this.limits.hookMs, expire: handling.expire },
        ...(handling.onObsolete === undefined ? {} : { onObsolete: handling.onObsolete }),
        onResult: handling.onResult,
      },
      invoke,
    );
  }

  /**
   * Calls `invoke` and waits for what it returns only when that is a promise. A callback that
   * answers synchronously lets the invocation continue in the same call stack. `onResult` is
   * called at most once, and never for a callback the runtime has stopped waiting for: whatever
   * such a callback produces later is a late settlement, dropped.
   */
  private runStep(spec: StepSpec, invoke: (step: Step) => unknown): void {
    const own = spec.budget === undefined ? undefined : new AbortController();
    const step = new Step(spec.kind, own === undefined ? this.controller.signal : own.signal, own, spec.onObsolete);
    this.step = step;
    let arrived = false;
    const arrive = (settled: Settled): void => {
      if (arrived) return;
      arrived = true;
      if (!step.close()) {
        this.emit('late-settlement');
        return;
      }
      if (this.step === step) this.step = undefined;
      spec.onResult(settled);
    };

    this.depth += 1;
    let returned: unknown;
    let threw: { readonly error: unknown } | undefined;
    try {
      returned = invoke(step);
    } catch (error) {
      threw = { error };
    }
    this.depth -= 1;

    if (threw !== undefined) arrive({ ok: false, error: threw.error });
    else if (!isThenable(returned)) arrive({ ok: true, value: returned });
    else {
      this.wait(step, spec);
      try {
        returned.then(
          (value) => arrive({ ok: true, value }),
          (error: unknown) => arrive({ ok: false, error }),
        );
      } catch (error) {
        arrive({ ok: false, error });
      }
    }
    this.drain();
  }

  /** Arms the timer that bounds this wait: a hook's own budget, or the invocation's work deadline. */
  private wait(step: Step, spec: StepSpec): void {
    if (!step.eligible) return;
    if (spec.budget !== undefined) {
      const { ms, expire } = spec.budget;
      step.timer = setTimeout(() => {
        if (!step.eligible) return;
        step.abandon();
        if (this.step === step) this.step = undefined;
        expire();
      }, timerDelay(ms));
      return;
    }
    this.armDeadline();
  }

  // -------------------------------------------------------------------------------------------
  // Keeping the invocation out of its own callbacks' call stacks
  // -------------------------------------------------------------------------------------------

  /** Continues the invocation, but never inside one of its own callbacks: that waits for the callback to return. */
  private later(continuation: () => void): void {
    if (this.depth > 0) this.deferred.push(continuation);
    else continuation();
  }

  private drain(): void {
    while (this.depth === 0) {
      const next = this.deferred.shift();
      if (next === undefined) return;
      next();
    }
  }

  private emit(phase: ObservedPhase, extra: Partial<Pick<ObservedEvent, 'status' | 'failureKind' | 'cleanupStep'>> = {}): void {
    emitObservation(this.plan, this.owner.bindingId, this.startedAt, { invocationId: this.id, phase, ...extra });
  }
}
