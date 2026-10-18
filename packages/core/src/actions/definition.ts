import { discardOutcome, isThenable } from './thenable.js';

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
export interface HandlerContext<Params> {
  /** What `input` copied out of the event, or `undefined` for an action without `input`. */
  readonly params: Params;
}

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

/** The start of every definition: `input` is optional, then `run`, then `build`. */
export interface ActionDraft<Event> extends ActionDraftAfterInput<Event, undefined> {
  /**
   * Copies what the handler needs out of the event, once, when it occurs. It runs synchronously
   * in the event's own call stack and must not perform effects. A thrown error, or a returned
   * promise, ends the invocation before the handler runs.
   */
  input<Params>(
    extract: (event: Event) => Params,
    ...synchronous: Synchronous<Params>
  ): ActionDraftAfterInput<Event, Params>;
}

export interface ActionDraftAfterInput<Event, Params> {
  /**
   * The local work. It runs synchronously, once per admitted activation. A thrown error, or a
   * returned promise, is a failure of the invocation.
   */
  run<Result>(
    handler: (context: HandlerContext<Params>) => Result,
    ...synchronous: Synchronous<Result>
  ): ActionDraftWithHandler<Event>;
}

export interface ActionDraftWithHandler<Event> {
  build(): ActionDefinition<Event>;
}

/** What the runtime does for one admitted activation. Internal: authors only see the definition. */
export interface ActionPlan<Event> {
  readonly label: string;
  /** Extracts the input, then runs the handler, both synchronously. Throws on any failure. */
  invoke(event: Event): void;
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

function refuseThenable(label: string, step: 'input' | 'run', value: unknown): void {
  if (!isThenable(value)) return;
  discardOutcome(value);
  throw new TypeError(
    `The ${step} callback of action '${label}' returned a promise. ` +
      'Asynchronous work is not supported here; return a value synchronously.',
  );
}

type Handler<Params> = (context: HandlerContext<Params>) => unknown;

// One class implements every step of the chain, and each method is declared to return only the
// interface that is valid next. Every value is frozen, and each call returns a new draft, so a
// retained alias is a branch rather than a second registration on one chain. The runtime checks
// each step too, so a call that bypasses the types (JavaScript, or an `any` cast) is refused.
class Draft<Event, Params> implements ActionDraftAfterInput<Event, Params>, ActionDraftWithHandler<Event> {
  constructor(
    private readonly label: string,
    private readonly extract: ((event: Event) => Params) | undefined,
    private readonly handler: Handler<Params> | undefined,
  ) {
    Object.freeze(this);
  }

  input<Next>(extract: (event: Event) => Next, ..._synchronous: Synchronous<Next>): Draft<Event, Next> {
    if (this.extract !== undefined || this.handler !== undefined) {
      throw new Error(`Action '${this.label}': input can be declared once, and only before run.`);
    }
    if (typeof extract !== 'function') throw new TypeError(`Action '${this.label}': input needs a function.`);
    return new Draft<Event, Next>(this.label, extract, undefined);
  }

  run<Result>(
    handler: (context: HandlerContext<Params>) => Result,
    ..._synchronous: Synchronous<Result>
  ): Draft<Event, Params> {
    if (this.handler !== undefined) throw new Error(`Action '${this.label}': run can be declared once.`);
    if (typeof handler !== 'function') throw new TypeError(`Action '${this.label}': run needs a function.`);
    return new Draft(this.label, this.extract, handler);
  }

  build(): ActionDefinition<Event> {
    const { label, extract, handler } = this;
    if (handler === undefined) throw new Error(`Action '${label}' cannot be built before run.`);
    return new BuiltAction<Event>(label, {
      label,
      invoke(event) {
        const params = extract === undefined ? undefined : extract(event);
        refuseThenable(label, 'input', params);
        // `params` is `Params` when `extract` exists and `undefined` otherwise, which is what the
        // handler's context type promises for an action declared without `input`.
        refuseThenable(label, 'run', handler({ params: params as Params }));
      },
    });
  }
}

/** Entry point of the fluent builder. */
export const Action = {
  /** Starts a synchronous local action. `Event` is what the target component's adapter delivers. */
  local<Event>(label: string): ActionDraft<Event> {
    if (typeof label !== 'string' || label === '') throw new TypeError('An action needs a non-empty label.');
    return new Draft<Event, undefined>(label, undefined, undefined);
  },
};
