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
import type { ActivationScope, InvocationScope } from './scope.js';
import { checkTransport, type ServerCalls, type ServerLimits, type ServerReply, type ServerTransport } from './server.js';
import type { Synchronous } from './thenable.js';

/** What `atActivation` receives, in the event's own call stack. */
export interface ActivationContext<Event> {
  readonly event: Event;
  /** Only the synchronous part of the scope: `acquire` awaits, and nothing here may. */
  readonly scope: ActivationScope;
}

/** What the handler receives for one activation. */
export interface HandlerContext<Params, Activation, Provided = unknown> extends Freshness {
  /** What `input` copied out of the event, or `undefined` for an action without `input`. */
  readonly params: Params;
  /** What `atActivation` returned, or `undefined` for an action without it. */
  readonly activation: Activation;
  /** The values the prerequisites provided, in the order they were written. */
  readonly provided: Provided;
  /** Aborts on cancellation or when the work deadline expires. */
  readonly signal: AbortSignal;
  /** Owns what this invocation acquires and releases it when the invocation ends. */
  readonly scope: InvocationScope;
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

// Every hook that can follow the activation prefix carries `activation`, so a hook can end exactly
// the resource this invocation took, whatever stage the outcome was decided in. A failure of the
// prefix itself has none: `atActivation` did not return one.

export interface SuccessContext<Params, Activation, Provided, Result> extends HookContext {
  readonly params: Params;
  readonly activation: Activation;
  readonly provided: Provided;
  readonly result: Result;
}

export type FailureContext<Params, Activation, Provided, Result> = HookContext &
  (
    | { readonly stage: 'input'; readonly failure: InputFailure }
    | {
        readonly stage: 'prerequisites';
        readonly failure: PrerequisiteFailure;
        readonly params: Params;
        readonly activation: Activation;
      }
    | {
        readonly stage: 'running';
        readonly failure: RunningFailure<Result>;
        readonly params: Params;
        readonly activation: Activation;
        readonly provided: Provided;
      }
  );

export type CanceledContext<Params, Activation, Provided, Result> = HookContext &
  (
    | {
        readonly stage: 'prerequisites';
        readonly cause: CancelCause;
        readonly params: Params;
        readonly activation: Activation;
      }
    | {
        readonly stage: 'running';
        readonly cause: CancelCause;
        readonly params: Params;
        readonly activation: Activation;
        readonly provided: Provided;
      }
    | {
        readonly stage: 'completing';
        readonly cause: CancelCause;
        readonly params: Params;
        readonly activation: Activation;
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

/**
 * What the handler of a server action also receives. A local action has none of it: its `Calls`
 * is `unknown`, which adds nothing to the handler context.
 */
type IsServer<Calls> = Calls extends ServerCalls<ServerReply> ? true : false;

/**
 * The start of every definition. The order is fixed: `input` (optional), `atActivation` (optional),
 * any number of `before`, then `run`. `Calls` is what `run` also receives: nothing for a local
 * action, the server call for a server action.
 */
export interface ActionDraft<Event, Calls = unknown> extends ActionDraftAfterInput<Event, undefined, Calls> {
  /**
   * Copies what the handler needs out of the event, once, when it occurs. It runs synchronously
   * in the event's own call stack and must not perform effects. A thrown error, or a returned
   * promise, ends the invocation before any prerequisite or handler runs.
   */
  input<Params>(
    extract: (event: Event) => Params,
    ...synchronous: Synchronous<Params>
  ): ActionDraftAfterInput<Event, Params, Calls>;
}

export interface ActionDraftAfterInput<Event, Params, Calls = unknown> extends ActionDraftChain<Event, Params, undefined, unknown, Calls> {
  /**
   * Work that an API requires inside the event's own call stack, such as taking a lease before
   * anything is awaited. It runs synchronously after `input`, in the environment and event stack
   * the adapter delivers the event in, and what it returns reaches the handler and every hook as
   * `activation`. Its scope can `own` a token the callback already holds and has no `acquire`,
   * because an acquisition awaits. A thrown error, or a promise the types could not see, ends the
   * invocation as `activation-error`; tokens it already took into the scope are still released.
   * `before` promises nothing about activation: it is prerequisite work.
   */
  atActivation<Activation>(
    perform: (context: ActivationContext<Event>) => Activation,
    ...synchronous: Synchronous<Activation>
  ): ActionDraftChain<Event, Params, Activation, unknown, Calls>;
}

export interface ActionDraftChain<Event, Params, Activation, Provided = unknown, Calls = unknown> {
  /**
   * A prerequisite: application work that must finish before the handler and may stop it. They
   * run strictly in the order written, each after the previous one proceeded. The compiler
   * rejects an ordering in which a prerequisite needs a value nothing provided yet.
   */
  before<Provides extends object>(
    prerequisite: Prerequisite<Provides, Provided, Params>,
  ): ActionDraftChain<Event, Params, Activation, Provided & Provides, Calls>;
  /**
   * The work. It may return a value or a promise; a throw and a rejection are both
   * `handler-error`. It receives the invocation signal and should pass it to cancellable work. A
   * server action's handler also receives `call`, which sends its request through the transport.
   */
  run<Result>(
    handler: (context: HandlerContext<Params, Activation, Provided> & Calls) => Result | PromiseLike<Result>,
  ): ActionDraftWithHandler<Event, Params, Activation, Provided, Result, never, Calls>;
}

type HookName = 'onSuccess' | 'onFailure' | 'onCanceled' | 'onFinally';
type TailName = 'limits' | 'whenBusy' | 'observe' | HookName;

/**
 * Hooks wait for `limits`, which supplies the budget they need. A server action also cannot
 * `build` until it has them, because it needs a work deadline as well.
 */
type Hidden<Used extends TailName, Calls> = 'limits' extends Used
  ? never
  : HookName | (IsServer<Calls> extends true ? 'build' : never);

interface TailMembers<Event, Params, Activation, Provided, Result, Used extends TailName, Calls> {
  /**
   * Required before any hook, and before a scope can own a token: `hookMs` bounds each release.
   * `deadlineMs` is optional for a local action and required for a server action. Each finite and
   * positive.
   */
  limits(
    limits: IsServer<Calls> extends true ? ServerLimits : Limits,
  ): ActionDraftWithHandler<Event, Params, Activation, Provided, Result, Used | 'limits', Calls>;
  /** `ignore` (the default) drops an activation while busy; `replace` cancels the running invocation. */
  whenBusy(
    policy: BusyPolicy,
  ): ActionDraftWithHandler<Event, Params, Activation, Provided, Result, Used | 'whenBusy', Calls>;
  observe(
    observer: ActionObserver,
  ): ActionDraftWithHandler<Event, Params, Activation, Provided, Result, Used | 'observe', Calls>;
  /** Required client work that decides success. Its exception or overrun fails the invocation. */
  onSuccess(
    hook: (context: SuccessContext<Params, Activation, Provided, Result>) => void | PromiseLike<void>,
  ): ActionDraftWithHandler<Event, Params, Activation, Provided, Result, Used | 'onSuccess', Calls>;
  onFailure(
    hook: (context: FailureContext<Params, Activation, Provided, Result>) => void | PromiseLike<void>,
  ): ActionDraftWithHandler<Event, Params, Activation, Provided, Result, Used | 'onFailure', Calls>;
  onCanceled(
    hook: (context: CanceledContext<Params, Activation, Provided, Result>) => void | PromiseLike<void>,
  ): ActionDraftWithHandler<Event, Params, Activation, Provided, Result, Used | 'onCanceled', Calls>;
  onFinally(
    hook: (context: FinallyContext<Result>) => void | PromiseLike<void>,
  ): ActionDraftWithHandler<Event, Params, Activation, Provided, Result, Used | 'onFinally', Calls>;
  build(): ActionDefinition<Event>;
}

/** What may still be called after `run`. Each member is available once. */
export type ActionDraftWithHandler<
  Event,
  Params = unknown,
  Activation = unknown,
  Provided = unknown,
  Result = unknown,
  Used extends TailName = never,
  Calls = unknown,
> = Omit<TailMembers<Event, Params, Activation, Provided, Result, Used, Calls>, Used | Hidden<Used, Calls>>;

// ---------------------------------------------------------------------------------------------
// What the runtime reads. Internal: authors only see the definition.
// ---------------------------------------------------------------------------------------------

/** Hooks with their types erased: the builder's types are what tie them to a result. */
export interface ErasedHooks {
  readonly onSuccess?: (context: SuccessContext<unknown, unknown, unknown, unknown>) => unknown;
  readonly onFailure?: (context: FailureContext<unknown, unknown, unknown, unknown>) => unknown;
  readonly onCanceled?: (context: CanceledContext<unknown, unknown, unknown, unknown>) => unknown;
  readonly onFinally?: (context: FinallyContext<unknown>) => unknown;
}

/** What the runtime does for one admitted activation. */
export interface ActionPlan<Event> {
  readonly label: string;
  readonly extract: ((event: Event) => unknown) | undefined;
  readonly activate: ((context: ActivationContext<Event>) => unknown) | undefined;
  readonly prerequisites: readonly Prerequisite<object, unknown, unknown>[];
  readonly handler: (context: HandlerContext<unknown, unknown, unknown>) => unknown;
  readonly limits: Limits | undefined;
  readonly hooks: ErasedHooks;
  readonly busy: BusyPolicy;
  readonly observer: ActionObserver | undefined;
  /** Present only for a server action: the application's way to reach its server. */
  readonly transport: ServerTransport | undefined;
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
  readonly activate: ((context: never) => unknown) | undefined;
  readonly prerequisites: readonly Prerequisite<object, unknown, unknown>[];
  readonly handler: ((context: never) => unknown) | undefined;
  readonly limits: Limits | undefined;
  readonly hooks: ErasedHooks;
  readonly busy: BusyPolicy | undefined;
  readonly observer: ActionObserver | undefined;
  readonly transport: ServerTransport | undefined;
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
    if (
      declared.extract !== undefined ||
      declared.activate !== undefined ||
      declared.prerequisites.length > 0 ||
      declared.handler !== undefined
    ) {
      throw new Error(`Action '${this.label}': input can be declared once, and only before atActivation, before and run.`);
    }
    if (typeof extract !== 'function') throw new TypeError(`Action '${this.label}': input needs a function.`);
    return this.next({ extract: extract as Declared['extract'] });
  }

  atActivation(perform: unknown): Draft {
    const { declared } = this;
    if (declared.activate !== undefined || declared.prerequisites.length > 0 || declared.handler !== undefined) {
      throw new Error(`Action '${this.label}': atActivation can be declared once, and only before before and run.`);
    }
    if (typeof perform !== 'function') throw new TypeError(`Action '${this.label}': atActivation needs a function.`);
    return this.next({ activate: perform as Declared['activate'] });
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
    // A server request is bounded by what is left of the work deadline, so a server action has one.
    if (this.declared.transport !== undefined && given.deadlineMs === undefined) {
      throw new TypeError(`Action '${this.label}': a server action needs limits({ deadlineMs, hookMs }), because each request is bounded by the work deadline.`);
    }
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
    if (declared.transport !== undefined && declared.limits === undefined) {
      throw new Error(`Action '${label}' is a server action and cannot be built without limits({ deadlineMs, hookMs }).`);
    }
    return new BuiltAction<never>(label, {
      label,
      // Interop assertions, the only ones in this module. The typed interfaces above are what tie
      // each callback to the event, params and result it receives; the plan erases that
      // relationship so the runtime handles any definition, and the runtime supplies exactly the
      // values those types promised.
      extract: declared.extract as ActionPlan<never>['extract'],
      activate: declared.activate as ActionPlan<never>['activate'],
      prerequisites: declared.prerequisites,
      handler: handler as ActionPlan<never>['handler'],
      limits: declared.limits,
      hooks: declared.hooks,
      busy: declared.busy ?? 'ignore',
      observer: declared.observer,
      transport: declared.transport,
    });
  }
}

function startDraft(label: string, transport: ServerTransport | undefined): Draft {
  if (typeof label !== 'string' || label === '') throw new TypeError('An action needs a non-empty label.');
  return new Draft(label, {
    extract: undefined,
    activate: undefined,
    prerequisites: Object.freeze([]),
    handler: undefined,
    limits: undefined,
    hooks: Object.freeze({}),
    busy: undefined,
    observer: undefined,
    transport,
  });
}

/** Entry point of the fluent builder. */
export const Action = {
  /** Starts a local action. `Event` is what the target component's adapter delivers. */
  local<Event>(label: string): ActionDraft<Event> {
    // Interop assertion: `Draft` implements every step of the typed chain, and each interface
    // exposes only the steps valid at that point.
    return startDraft(label, undefined) as unknown as ActionDraft<Event>;
  },

  /**
   * Starts a server action: the same chain, plus `call` in the handler and a required work
   * deadline. `transport` is the application's way to reach its server; the action module imports
   * no MCP package, and the server's own handler is never referenced from here. A prerequisite is
   * not authorization: the server stays authoritative for every request the handler sends.
   * Pass `Reply` to keep the transport's own reply type.
   */
  server<Event, Reply extends ServerReply = ServerReply>(
    label: string,
    transport: ServerTransport<Reply>,
  ): ActionDraft<Event, ServerCalls<Reply>> {
    // Interop assertion, as for `local`.
    return startDraft(label, checkTransport(label, transport)) as unknown as ActionDraft<Event, ServerCalls<Reply>>;
  },
};
