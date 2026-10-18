import type {
  ActionObserver,
  CancelCause,
  CleanupError,
  Freshness,
  InputFailure,
  Outcome,
  PrerequisiteFailure,
  RunningFailure,
} from './outcome.js';
import type { Prerequisite } from './prerequisite.js';

/**
 * Guard for a callback that must finish in the call that made it. Used as a rest parameter, it
 * asks for an extra argument nothing can supply when the callback's inferred return type has any
 * thenable constituent, so an `async` callback or `Promise<T> | undefined` does not compile. A
 * callback that always throws returns `never` and stays valid. The types cannot see a promise
 * hidden behind a declared `unknown` or `void`, so the runtime checks the returned value too.
 */
export type Synchronous<Returned> = [Extract<Returned, PromiseLike<unknown>>] extends [never]
  ? []
  : [returnedAThenable: never];

/** What the handler receives for one activation. */
export interface HandlerContext<Params, Provided = unknown> extends Freshness {
  /** What `input` copied out of the event, or `undefined` for an action without `input`. */
  readonly params: Params;
  /** The values the prerequisites provided, in the order they were written. */
  readonly provided: Provided;
  /** Aborts on cancellation or when the work deadline expires. */
  readonly signal: AbortSignal;
}

/**
 * `signal` aborts when the hook's `hookMs` budget runs out. For `onSuccess` and `onFailure` it also
 * aborts once the invocation is obsolete (binding disposed, replaced, or subject changed). For
 * `onCanceled` and `onFinally` it does not: those hooks exist to respond to that. A signal is a
 * request to stop, and a non-aborted signal does not show the instance is still the right one:
 * after any await, this callback's own `current()` is the check that authorizes a synchronous
 * presentation write.
 */
interface HookContext extends Freshness {
  readonly signal: AbortSignal;
}

export interface SuccessContext<Params, Provided, Result> extends HookContext {
  readonly params: Params;
  readonly provided: Provided;
  readonly result: Result;
}

export type FailureContext<Params, Provided, Result> = HookContext &
  (
    | { readonly stage: 'input'; readonly failure: InputFailure }
    | { readonly stage: 'prerequisites'; readonly failure: PrerequisiteFailure; readonly params: Params }
    | {
        readonly stage: 'running';
        readonly failure: RunningFailure<Result>;
        readonly params: Params;
        readonly provided: Provided;
      }
  );

export type CanceledContext<Params, Provided, Result> = HookContext &
  (
    | { readonly stage: 'prerequisites'; readonly cause: CancelCause; readonly params: Params }
    | { readonly stage: 'running'; readonly cause: CancelCause; readonly params: Params; readonly provided: Provided }
    | {
        readonly stage: 'completing';
        readonly cause: CancelCause;
        readonly params: Params;
        readonly provided: Provided;
        readonly result: Result;
      }
  );

/**
 * What final reporting can know: the immutable primary outcome as earlier hooks received it, plus
 * the cleanup diagnostics collected so far. The diagnostics never rewrite the outcome. They cover
 * `onFailure` and `onCanceled`, but not `onFinally` itself, whose own failure has no later hook.
 */
export interface FinallyContext<Result> extends HookContext {
  readonly outcome: Outcome<Result>;
  readonly cleanupErrors: readonly CleanupError[];
  /** True when the invocation became obsolete before or while the outcome hook ran. */
  readonly obsolete: boolean;
}

/**
 * `hookMs` bounds each step after the handler settles: the required `onSuccess`, the outcome
 * hook, and `onFinally`. `deadlineMs`, when given, bounds the prerequisites and the handler
 * together. Neither has a default, and no timer covers a whole invocation.
 */
export interface Limits {
  readonly deadlineMs?: number;
  readonly hookMs: number;
}

export type BusyPolicy = 'ignore' | 'replace';

/**
 * A built, reusable action. It holds no pending flag, timer or resource, so it can be bound to
 * any number of rendered instances; each binding keeps its own state.
 */
export interface ActionDefinition<Event> {
  /** Diagnostic name only. Nothing selects behavior by it. */
  readonly label: string;
  /** Phantom member: a definition accepts events assignable to `Event`. Never set at runtime. */
  readonly accepts?: (event: Event) => void;
}

/** The start of every definition: `input` is optional, then any number of `before`, then `run`. */
export interface ActionDraft<Event> extends ActionDraftAfterInput<Event, undefined> {
  /**
   * Copies what the handler needs out of the event, once, when it occurs. It runs synchronously
   * in the event's own call stack and must not perform effects. A thrown error, or a returned
   * promise, ends the invocation before any prerequisite or handler runs.
   */
  input<Params>(
    extract: (event: Event) => Params,
    ...synchronous: Synchronous<Params>
  ): ActionDraftAfterInput<Event, Params>;
}

export interface ActionDraftAfterInput<Event, Params, Provided = unknown> {
  /**
   * A prerequisite: application work that must finish before the handler and may stop it. They
   * run strictly in the order written, each after the previous one proceeded. The compiler
   * rejects an ordering in which a prerequisite needs a value nothing provided yet.
   */
  before<Provides extends object>(
    prerequisite: Prerequisite<Provides, Provided, Params>,
  ): ActionDraftAfterInput<Event, Params, Provided & Provides>;
  /**
   * The local work. It may return a value or a promise; a throw and a rejection are both
   * `handler-error`. It receives the invocation signal and should pass it to cancellable work.
   */
  run<Result>(
    handler: (context: HandlerContext<Params, Provided>) => Result | PromiseLike<Result>,
  ): ActionDraftWithHandler<Event, Params, Provided, Result>;
}

type HookName = 'onSuccess' | 'onFailure' | 'onCanceled' | 'onFinally';
type TailName = 'limits' | 'whenBusy' | 'observe' | HookName;

/** Hooks wait for `limits`, which supplies the budget they need. */
type Hidden<Used extends TailName> = 'limits' extends Used ? never : HookName;

interface TailMembers<Event, Params, Provided, Result, Used extends TailName> {
  /** Required before any hook. `deadlineMs` is optional; `hookMs` is required. Each finite and positive. */
  limits(limits: Limits): ActionDraftWithHandler<Event, Params, Provided, Result, Used | 'limits'>;
  /** `ignore` (the default) drops an activation while busy; `replace` cancels the running invocation. */
  whenBusy(policy: BusyPolicy): ActionDraftWithHandler<Event, Params, Provided, Result, Used | 'whenBusy'>;
  observe(observer: ActionObserver): ActionDraftWithHandler<Event, Params, Provided, Result, Used | 'observe'>;
  /** Required client work that decides success. Its exception or overrun fails the invocation. */
  onSuccess(
    hook: (context: SuccessContext<Params, Provided, Result>) => void | PromiseLike<void>,
  ): ActionDraftWithHandler<Event, Params, Provided, Result, Used | 'onSuccess'>;
  onFailure(
    hook: (context: FailureContext<Params, Provided, Result>) => void | PromiseLike<void>,
  ): ActionDraftWithHandler<Event, Params, Provided, Result, Used | 'onFailure'>;
  onCanceled(
    hook: (context: CanceledContext<Params, Provided, Result>) => void | PromiseLike<void>,
  ): ActionDraftWithHandler<Event, Params, Provided, Result, Used | 'onCanceled'>;
  onFinally(
    hook: (context: FinallyContext<Result>) => void | PromiseLike<void>,
  ): ActionDraftWithHandler<Event, Params, Provided, Result, Used | 'onFinally'>;
  build(): ActionDefinition<Event>;
}

/** What may still be called after `run`. Each member is available once. */
export type ActionDraftWithHandler<
  Event,
  Params = unknown,
  Provided = unknown,
  Result = unknown,
  Used extends TailName = never,
> = Omit<TailMembers<Event, Params, Provided, Result, Used>, Used | Hidden<Used>>;

// ---------------------------------------------------------------------------------------------
// What the runtime reads. Internal: authors only see the definition.
// ---------------------------------------------------------------------------------------------

/** Hooks with their types erased: the builder's types are what tie them to a result. */
export interface ErasedHooks {
  readonly onSuccess?: (context: SuccessContext<unknown, unknown, unknown>) => unknown;
  readonly onFailure?: (context: FailureContext<unknown, unknown, unknown>) => unknown;
  readonly onCanceled?: (context: CanceledContext<unknown, unknown, unknown>) => unknown;
  readonly onFinally?: (context: FinallyContext<unknown>) => unknown;
}

/** What the runtime does for one admitted activation. */
export interface ActionPlan<Event> {
  readonly label: string;
  readonly extract: ((event: Event) => unknown) | undefined;
  readonly prerequisites: readonly Prerequisite<object, unknown, unknown>[];
  readonly handler: (context: HandlerContext<unknown, unknown>) => unknown;
  readonly limits: Limits | undefined;
  readonly hooks: ErasedHooks;
  readonly busy: BusyPolicy;
  readonly observer: ActionObserver | undefined;
}

class BuiltAction<Event> implements ActionDefinition<Event> {
  constructor(
    readonly label: string,
    readonly plan: ActionPlan<Event>,
  ) {
    Object.freeze(this);
  }
}

/** The plan behind a definition. Refuses a value that `Action` did not build. */
export function planOf<Event>(definition: ActionDefinition<Event>): ActionPlan<Event> {
  if (definition instanceof BuiltAction) return definition.plan;
  throw new TypeError('This is not an action definition. Build one with Action.local(...).run(...).build().');
}

function checkPositive(label: string, name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`Action '${label}': ${name} must be a finite number greater than zero.`);
  }
  return value;
}

type HookKey = keyof ErasedHooks;
const hookKeys: readonly HookKey[] = ['onSuccess', 'onFailure', 'onCanceled', 'onFinally'];

/** Everything a chain has declared so far. Never mutated: every step makes a new one. */
interface Declared {
  readonly extract: ((event: never) => unknown) | undefined;
  readonly prerequisites: readonly Prerequisite<object, unknown, unknown>[];
  readonly handler: ((context: never) => unknown) | undefined;
  readonly limits: Limits | undefined;
  readonly hooks: ErasedHooks;
  readonly busy: BusyPolicy | undefined;
  readonly observer: ActionObserver | undefined;
}

// One class implements every step of the chain, and each method is declared to return only the
// interface that is valid next (see the interfaces above). Every value is frozen, and each call
// returns a new draft, so a retained alias is a branch rather than a second registration on one
// chain. The runtime checks each step too, so a call that bypasses the types (JavaScript, or an
// `any` cast) is refused: a repeated registration, a hook before `limits`, a bad limit.
class Draft {
  constructor(
    private readonly label: string,
    private readonly declared: Declared,
  ) {
    Object.freeze(this);
  }

  private next(change: Partial<Declared>): Draft {
    return new Draft(this.label, { ...this.declared, ...change });
  }

  private mustFollowRun(step: string): void {
    if (this.declared.handler === undefined) throw new Error(`Action '${this.label}': ${step} can only follow run.`);
  }

  input(extract: unknown): Draft {
    const { declared } = this;
    if (declared.extract !== undefined || declared.prerequisites.length > 0 || declared.handler !== undefined) {
      throw new Error(`Action '${this.label}': input can be declared once, and only before before and run.`);
    }
    if (typeof extract !== 'function') throw new TypeError(`Action '${this.label}': input needs a function.`);
    return this.next({ extract: extract as Declared['extract'] });
  }

  before(candidate: unknown): Draft {
    const { declared } = this;
    if (declared.handler !== undefined) throw new Error(`Action '${this.label}': before can only precede run.`);
    const { label, run } = (candidate ?? {}) as { label?: unknown; run?: unknown };
    if (typeof label !== 'string' || label === '' || typeof run !== 'function') {
      throw new TypeError(`Action '${this.label}': before needs a prerequisite with a label and a run function.`);
    }
    const kept = Object.freeze({ label, run }) as Prerequisite<object, unknown, unknown>;
    return this.next({ prerequisites: Object.freeze([...declared.prerequisites, kept]) });
  }

  run(handler: unknown): Draft {
    if (this.declared.handler !== undefined) throw new Error(`Action '${this.label}': run can be declared once.`);
    if (typeof handler !== 'function') throw new TypeError(`Action '${this.label}': run needs a function.`);
    return this.next({ handler: handler as Declared['handler'] });
  }

  limits(limits: unknown): Draft {
    this.mustFollowRun('limits');
    if (this.declared.limits !== undefined) throw new Error(`Action '${this.label}': limits can be declared once.`);
    const given = (limits ?? {}) as { deadlineMs?: unknown; hookMs?: unknown };
    const hookMs = checkPositive(this.label, 'hookMs', given.hookMs);
    const bounds: Limits =
      given.deadlineMs === undefined
        ? { hookMs }
        : { deadlineMs: checkPositive(this.label, 'deadlineMs', given.deadlineMs), hookMs };
    return this.next({ limits: Object.freeze(bounds) });
  }

  whenBusy(policy: unknown): Draft {
    this.mustFollowRun('whenBusy');
    if (this.declared.busy !== undefined) throw new Error(`Action '${this.label}': whenBusy can be declared once.`);
    if (policy !== 'ignore' && policy !== 'replace') {
      throw new TypeError(`Action '${this.label}': whenBusy takes 'ignore' or 'replace'.`);
    }
    return this.next({ busy: policy });
  }

  observe(observer: unknown): Draft {
    this.mustFollowRun('observe');
    if (this.declared.observer !== undefined) throw new Error(`Action '${this.label}': observe can be declared once.`);
    if (typeof observer !== 'function') throw new TypeError(`Action '${this.label}': observe needs a function.`);
    return this.next({ observer: observer as ActionObserver });
  }

  private withHook(key: HookKey, hook: unknown): Draft {
    this.mustFollowRun(key);
    if (this.declared.limits === undefined) {
      throw new Error(`Action '${this.label}': ${key} needs limits({ hookMs }) first, which bounds how long the runtime waits.`);
    }
    if (this.declared.hooks[key] !== undefined) throw new Error(`Action '${this.label}': ${key} can be declared once.`);
    if (typeof hook !== 'function') throw new TypeError(`Action '${this.label}': ${key} needs a function.`);
    return this.next({ hooks: Object.freeze({ ...this.declared.hooks, [key]: hook }) });
  }

  onSuccess(hook: unknown): Draft {
    return this.withHook('onSuccess', hook);
  }
  onFailure(hook: unknown): Draft {
    return this.withHook('onFailure', hook);
  }
  onCanceled(hook: unknown): Draft {
    return this.withHook('onCanceled', hook);
  }
  onFinally(hook: unknown): Draft {
    return this.withHook('onFinally', hook);
  }

  build(): ActionDefinition<never> {
    const { label, declared } = this;
    const { handler } = declared;
    if (handler === undefined) throw new Error(`Action '${label}' cannot be built before run.`);
    if (hookKeys.some((key) => declared.hooks[key] !== undefined) && declared.limits === undefined) {
      throw new Error(`Action '${label}' has a hook but no limits.`);
    }
    return new BuiltAction<never>(label, {
      label,
      // Interop assertions, the only ones in this module. The typed interfaces above are what tie
      // each callback to the event, params and result it receives; the plan erases that
      // relationship so the runtime handles any definition, and the runtime supplies exactly the
      // values those types promised.
      extract: declared.extract as ActionPlan<never>['extract'],
      prerequisites: declared.prerequisites,
      handler: handler as ActionPlan<never>['handler'],
      limits: declared.limits,
      hooks: declared.hooks,
      busy: declared.busy ?? 'ignore',
      observer: declared.observer,
    });
  }
}

/** Entry point of the fluent builder. */
export const Action = {
  /** Starts a local action. `Event` is what the target component's adapter delivers. */
  local<Event>(label: string): ActionDraft<Event> {
    if (typeof label !== 'string' || label === '') throw new TypeError('An action needs a non-empty label.');
    // Interop assertion: `Draft` implements every step of the typed chain, and each interface
    // exposes only the steps valid at that point.
    return new Draft(label, {
      extract: undefined,
      prerequisites: Object.freeze([]),
      handler: undefined,
      limits: undefined,
      hooks: Object.freeze({}),
      busy: undefined,
      observer: undefined,
    }) as unknown as ActionDraft<Event>;
  },
};
