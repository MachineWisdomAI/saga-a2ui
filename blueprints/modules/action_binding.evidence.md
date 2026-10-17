# Action binding: evidence companion

This companion belongs to the [action binding Blueprint](./action_binding.blueprint.md). It holds the complete type declarations that the Blueprint's examples are checked against, and a record of the renderer checks that other people ran earlier. The Blueprint is the review entry point and does not depend on this file for its design. Everything here is proposal-level and declaration-level evidence. None of it is a runtime, renderer or host result, and none of it approves or authorizes an implementation.

## Contents

- [A. Authoring declarations](#a-authoring-declarations): the declarations behind every authoring example, with the positive and negative type cases.
- [B. Renderer declarations](#b-renderer-declarations): the Lit and React occurrence declarations and the Lynx control declarations, with the printed examples compiled against A.
- [C. Printed renderer blocks](#c-printed-renderer-blocks): what was checked against the published Lit, React and `web_core` packages.
- [D. Lynx freshness and admission mechanism](#d-lynx-freshness-and-admission-mechanism): the code sketches and walkthrough behind the Lynx freshness summary.
- [Reported renderer checks](#reported-renderer-checks): earlier Lit, React and Lynx checks that were reported by their authors, kept as history.

## A. Authoring declarations

The file below declares the proposed interfaces and the caller examples in [Interfaces and behavior](./action_binding.blueprint.md#interfaces-and-behavior). It contains twenty-six negative directives (N1 to N25, with N11 appearing twice), the positive checks P1 to P8, the recorded static limit L1, and positive examples for the playback lease with its result-discriminated failure hook, the later-appearing occurrence with a `subject` reader and owned teardown, two different definitions (archive and star) attached to one data-bearing control kind, and a supertype action bound to two component kinds. Every declaration uses `declare`. There is no runtime implementation, and no framework was installed.

**Receipt.** The file, saved as `authoring.types.ts` (first 16 hex digits of its SHA-256: `64c1220b2b80a72d`), was checked with TypeScript 6.0.3 and TypeScript 5.9.3, the latter being the version reported for the SDK repository's installed toolchain. Each compiler used this command, with no project configuration and so without the SDK repository's `tsconfig`:

```text
tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
    --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom \
    authoring.types.ts
```

Both compilers exited 0 with no diagnostics. Each negative case carries a `@ts-expect-error` directive, which fails the build when the next line has no error. As a second check, the file with every `@ts-expect-error` line removed produced exactly twenty-six diagnostics under each compiler, one at each intended line. They are:

- `provided` of type `unknown` without the session prerequisite (N1);
- a prerequisite that is not assignable because its needs are unmet (N2, N3);
- `toUpperCase` missing on `number` (N4);
- `provided` missing at the prerequisite stage (N5);
- a field action not assignable to a button event (N6) and an unknown event name (N7);
- `call` missing on a local handler context (N8);
- `params` missing on `ObservedEvent` (N9);
- `input` missing after `before`, after `input` and after `atActivation` (N10, N11);
- `onSuccess` missing twice and before `limits` (N12, N14);
- `build` missing on a server action without `limits` (N13) and `deadlineMs` missing from server limits (N15);
- the synchronous-boundary guard rejecting an async `atActivation` (N16), a `Promise | undefined` union (N17), an attempt to pass a diagnostic string (N18, "not assignable to parameter of type 'never'"), an async `input` extractor (N19) and an async adoption callback (N20), each reported as "Expected 2 arguments, but got 1" except N18;
- `result` missing on a canceled context before the `completing` stage (N21);
- `acquire` missing on the activation scope (N22);
- `cleanupErrors` missing on `Outcome` (N23);
- a definition that needs the row event's `noteId` not assignable to a plain button (N24); and
- `readData` missing on a plain handle (N25).

The positive checks are a guard that returns nothing (P1), a prerequisite that needs less than is provided (P2), a synchronous prerequisite (P3), an always-throwing `atActivation` that returns `never` (P4), a union without a thenable (P5), two branches from one retained builder alias (P6), reading the stage of a failed outcome in `onFinally` (P7), and `current()` available to a handler and to a prerequisite (P8). L1 records that a promise returned through a declared `unknown` compiles, and that the runtime check on the returned value is what catches it.

**Shape of the declarations.** `SurfaceView` declares only the general `getById` and `watchById` overloads. The overloads that return a `DataHandle` for a data-bearing kind are on `DataSurfaceView extends SurfaceView`, which repeats each general overload after its specialized one, and only the example's `view` is declared as `DataSurfaceView`. `DataHandle.readData` and `NoteActivation` are optional occurrence-data examples, and nothing is cast. The illustrative adapter seam `AdapterOccurrence` names its liveness reader `isLive`, calls its installation stamp `installationEpoch` so that it is not confused with a renderer's observed-key epoch, and declares the optional `watchScope` wake-up. The archive workflow is written once as `archiveNoteWith(noteIdOf)`, so that each renderer supplies only its own projection of the note identifier.

**Limits.** This is type-shape evidence only. The stand-ins for `CallToolResult` and `RequestOptions` approximate the pinned upstream types and do not import them. Compile success does not show runtime ordering, timing, cancellation behavior, per-callback eligibility behind `current()`, thenable checks or limit validation, which the Blueprint describes and does not implement, nor anything about a renderer or host.

```ts
// Type-shape companion for the proposed fluent action interface.
//
// Declarations only: nothing here runs, and `declare` statements stand in for the runtime, the
// renderer adapter, and application code. Names are illustrative. A successful compile shows that
// the caller examples are well typed against these declarations and that the negative cases are
// rejected. It says nothing about runtime ordering, timing, threads, or any renderer.
//
// Check:
//   tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
//       --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom \
//       authoring.types.ts

// ---------------------------------------------------------------------------
// Outcome vocabulary
// ---------------------------------------------------------------------------

/** 'subject-changed': the binding's subject reader returned a different value than at activation. */
export type CancelCause = 'replaced' | 'disposed' | 'subject-changed';

/**
 * Failures during the synchronous activation prefix. No handler request has been sent and nothing
 * has been awaited; `atActivation` may already have performed its own effects.
 */
export type InputFailure =
  | { readonly kind: 'invalid-input'; readonly error: unknown }
  | { readonly kind: 'activation-error'; readonly error: unknown };

/** Failures while prerequisites run. The handler has not started; `provided` is incomplete. */
export type PrerequisiteFailure =
  | { readonly kind: 'refused'; readonly prerequisite: string; readonly reason: string }
  | { readonly kind: 'prerequisite-error'; readonly prerequisite: string; readonly error: unknown }
  | { readonly kind: 'timeout' };

/**
 * Failures once the handler has started. `handler-error` and `timeout` say only that the handler
 * threw or had not settled: what it already did remotely is unknown to the runtime. The two
 * success-hook kinds are different: the handler returned `result` before the required hook failed.
 */
export type RunningFailure<Result> =
  | { readonly kind: 'handler-error'; readonly error: unknown }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'success-hook-error'; readonly error: unknown; readonly result: Result }
  | { readonly kind: 'success-hook-timeout'; readonly result: Result };

/** Steps after the outcome is decided. 'adopt' is a transfer callback that returned a thenable. */
export type CleanupStep = 'onFailure' | 'onCanceled' | 'onFinally' | 'release' | 'adopt';

/** A diagnostic about cleanup. It never changes the primary outcome. */
export type CleanupError =
  | { readonly step: CleanupStep; readonly reason: 'threw'; readonly error: unknown }
  | { readonly step: CleanupStep; readonly reason: 'budget-exceeded' | 'obsolete' };

/**
 * The primary terminal decision, made once and never edited. Every failed and canceled variant
 * names the stage it was decided in, so a consumer of the outcome (including onFinally) can tell
 * "the handler never started" from "the handler may have sent its request".
 *
 * Canceled stages: 'prerequisites' and 'running' are before the handler result was observed, so
 * no result exists. 'completing' is after it was observed, while the required success hook had not
 * finished, so the result is part of the outcome.
 */
export type Outcome<Result> =
  | { readonly status: 'succeeded'; readonly result: Result }
  | { readonly status: 'failed'; readonly stage: 'input'; readonly failure: InputFailure }
  | { readonly status: 'failed'; readonly stage: 'prerequisites'; readonly failure: PrerequisiteFailure }
  | { readonly status: 'failed'; readonly stage: 'running'; readonly failure: RunningFailure<Result> }
  | { readonly status: 'canceled'; readonly cause: CancelCause; readonly stage: 'prerequisites' | 'running' }
  | { readonly status: 'canceled'; readonly cause: CancelCause; readonly stage: 'completing'; readonly result: Result };

// ---------------------------------------------------------------------------
// Invocation scope: per-invocation resource ownership
// ---------------------------------------------------------------------------

export interface ReleaseContext {
  /** Aborts when this release step's `hookMs` budget runs out. */
  readonly signal: AbortSignal;
}

/**
 * Must affect only the acquisition that `token` identifies, and must be a no-op when the owner has
 * since superseded that token. SAGA calls it once per owned token that was not transferred.
 */
export type Release<Token> = (token: Token, context: ReleaseContext) => void | Promise<void>;

/**
 * A synchronous-boundary guard, used as a rest parameter. It asks for an extra, unsatisfiable
 * argument when `Returned` has any thenable constituent (so `Promise<T> | undefined` is rejected),
 * and asks for nothing otherwise. `never` (a callback that always throws) stays valid. There is no
 * argument a caller can supply to get past it. It cannot see a promise hidden behind a declared
 * `void` or `unknown` return, so the runtime also checks the value that comes back.
 */
export type Synchronous<Returned> = [Extract<Returned, PromiseLike<unknown>>] extends [never]
  ? []
  : [returnedAThenable: never];

export interface Held<Token> {
  readonly token: Token;
  /**
   * Moves responsibility for the token to `adopt`, which is called synchronously and must finish
   * synchronously. Returns true when `adopt` returned a non-thenable value and the invocation was
   * still active; the owner now holds the token and SAGA will not release it. Returns false and
   * adopts nothing when the invocation had already ended: SAGA has released or will release it.
   * If `adopt` throws, or returns a thenable, ownership stays with the invocation: a throw
   * propagates, a thenable makes `transfer` throw a TypeError. SAGA attaches a rejection handler to
   * the thenable and reports a later rejection to the observer only.
   */
  transfer<Returned>(adopt: (token: Token) => Returned, ...synchronous: Synchronous<Returned>): boolean;
}

/** The part of the scope that may be used inside the event turn. */
export interface ActivationScope {
  /** True from the start of the invocation until its outcome is decided (work activity, not freshness). */
  readonly active: boolean;
  /**
   * Take ownership of a token the caller already holds. Needs `hookMs`. If the invocation has
   * already ended, the token is released at once and the call throws.
   */
  own<Token>(token: Token, release: Release<Token>): Held<Token>;
}

export interface InvocationScope extends ActivationScope {
  /** Await an acquisition, then `own` its token. A token that arrives after the end is released at once. */
  acquire<Token>(acquire: () => Token | Promise<Token>, release: Release<Token>): Promise<Held<Token>>;
}

/**
 * The freshness check supplied to one callback. Each callback (a prerequisite, the handler, a hook)
 * receives its own `current()`, which is distinct from `scope.active`. `scope.active` answers "has
 * this invocation's outcome been decided" and is false once a failure is decided. `current()` answers
 * "may THIS callback still change what this occurrence shows". It is true only while all of these hold:
 *  - the runtime is still waiting for this callback. That eligibility ends permanently at the first of:
 *    a synchronous callback returning or throwing; the Promise returned by an asynchronous callback
 *    settling (merely returning a pending Promise does not end it); its budget expiring (the work
 *    deadline for a prerequisite or handler, `hookMs` for a hook); or cancellation, obsolescence, the
 *    deadline or the budget making the runtime stop waiting for it. A callback started later has its
 *    own eligibility;
 *  - the binding is not disposed and the invocation is not replaced;
 *  - the adapter reports that the occurrence and installation are the live ones;
 *  - the binding's subject reader, if one was given, still returns the value captured at activation.
 * Each call reads the adapter's liveness and the subject reader afresh. It is a cooperative check for
 * the moment before a synchronous commit; it cannot recall a write that has already started. The
 * adapter supplies occurrence liveness; the runtime owns callback eligibility.
 */
export interface Freshness {
  current(): boolean;
}

// ---------------------------------------------------------------------------
// Prerequisites
// ---------------------------------------------------------------------------

/** What a prerequisite that adds no values provides. Assignable to `object`, absorbed by `&`. */
export type NoValues = Record<never, never>;

export interface PrerequisiteContext<Needs, Input> extends Freshness {
  /** Values provided by earlier prerequisites on this action. */
  readonly provided: Needs;
  readonly params: Input;
  readonly signal: AbortSignal;
  readonly scope: InvocationScope;
}

export type Proceed<Provides> = { readonly kind: 'proceed'; readonly provides: Provides };
export type Refuse = { readonly kind: 'refuse'; readonly reason: string };
export type PrerequisiteResult<Provides> = Proceed<Provides> | Refuse;

export declare function proceed(): Proceed<NoValues>;
export declare function proceed<Provides extends object>(provides: Provides): Proceed<Provides>;
export declare function refuse(reason: string): Refuse;

/** Reusable and stateless per invocation. `label` is a diagnostic name; it never selects behavior. */
export interface Prerequisite<Provides, Needs = unknown, Input = unknown> {
  readonly label: string;
  readonly run: (
    context: PrerequisiteContext<Needs, Input>,
  ) => PrerequisiteResult<Provides> | Promise<PrerequisiteResult<Provides>>;
}

/** Fixes the type parameters from the callback; a plain `{ label, run }` object is equally valid. */
export declare function prerequisite<Provides, Needs = unknown, Input = unknown>(
  label: string,
  run: Prerequisite<Provides, Needs, Input>['run'],
): Prerequisite<Provides, Needs, Input>;

// ---------------------------------------------------------------------------
// Handler and hook contexts
// ---------------------------------------------------------------------------

export interface ActivationContext<Event> {
  readonly event: Event;
  /** Only the synchronous part of the scope: `acquire` awaits, and nothing here may. */
  readonly scope: ActivationScope;
}

export interface HandlerContext<Params, Activation, Provided> extends Freshness {
  readonly params: Params;
  readonly activation: Activation;
  readonly provided: Provided;
  /** Aborts on cancellation or when the work deadline expires. */
  readonly signal: AbortSignal;
  readonly scope: InvocationScope;
}

/** Added to the handler context of a server action. The runtime supplies the request options. */
export interface ServerCalls {
  call(name: string, args: Readonly<Record<string, unknown>>): Promise<CallToolResult>;
}

/**
 * `signal` aborts when the hook's `hookMs` budget runs out. For onSuccess and onFailure it also
 * aborts once the invocation is obsolete (binding disposed, replaced, or subject changed). For
 * onCanceled and onFinally it does not: those hooks exist to respond to that. A signal is a request
 * to stop, and a non-aborted signal does not show the occurrence is still the right one: after any
 * await, this callback's own `current()` is the check that authorizes a synchronous presentation
 * write; it turns false for good once the runtime stops waiting for this callback.
 */
interface HookSignal extends Freshness {
  readonly signal: AbortSignal;
}

export interface SuccessContext<Params, Activation, Provided, Result> extends HookSignal {
  readonly params: Params;
  readonly activation: Activation;
  readonly provided: Provided;
  readonly result: Result;
}

export type FailureContext<Params, Activation, Provided, Result> = HookSignal &
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

export type CanceledContext<Params, Activation, Provided, Result> = HookSignal &
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
 * the cleanup diagnostics collected so far. The diagnostics are a separate list and never rewrite
 * the outcome. They cover onFailure, onCanceled and every release, but not onFinally itself, whose
 * own failure has no later hook.
 */
export interface FinallyContext<Result> extends HookSignal {
  readonly outcome: Outcome<Result>;
  readonly cleanupErrors: readonly CleanupError[];
  /** True when the invocation became obsolete before or while the outcome hook ran. */
  readonly obsolete: boolean;
}

// ---------------------------------------------------------------------------
// Telemetry: no params, provided values, results or error objects by construction
// ---------------------------------------------------------------------------

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
  /** Only for 'ignored' with reason 'busy': the invocation that was already busy. */
  readonly busyInvocationId?: string;
  /** Only for 'ignored': busy policy, or an event captured for an installation that is no longer current. */
  readonly ignoredReason?: 'busy' | 'stale-installation';
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

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export type Kind = 'local' | 'server';
export type BusyPolicy = 'ignore' | 'replace';

/** `hookMs` bounds every step after the handler settles: each outcome hook, each release, onFinally. */
export interface LocalLimits {
  /** Work deadline over prerequisites and handler. Absent: no deadline. */
  readonly deadlineMs?: number;
  readonly hookMs: number;
}
export interface ServerLimits {
  readonly deadlineMs: number;
  readonly hookMs: number;
}

declare const eventType: unique symbol;

export type EventTurnPhase = 'input' | 'atActivation';

/** The built, reusable definition. It holds no pending, cancel, or resource state. */
export interface ActionDefinition<Event> {
  readonly label: string;
  /**
   * Names the event-turn phases this definition uses. The list holds phase names only: it does not
   * record which execution environment each callback was written for, so it cannot by itself let an
   * adapter accept or reject a definition at bind time. That mechanism is unresolved.
   */
  readonly eventTurn: readonly EventTurnPhase[];
  /** Phantom member: a definition accepts events assignable to `Event`. */
  readonly [eventType]: (event: Event) => void;
}

type CallsFor<K extends Kind> = K extends 'server' ? ServerCalls : unknown;

/**
 * Prerequisites and the handler. `input` and `atActivation` are no longer available from here on.
 * Every builder value is immutable: each call returns a new builder and leaves its receiver as it
 * was, so a retained alias is a branch, not a second registration on the same chain.
 */
export interface Chain<Event, K extends Kind, Params, Activation, Provided> {
  before<Provides extends object>(
    prerequisite: Prerequisite<Provides, Provided, Params>,
  ): Chain<Event, K, Params, Activation, Provided & Provides>;
  run<Result>(
    handler: (context: HandlerContext<Params, Activation, Provided> & CallsFor<K>) => Result | Promise<Result>,
  ): Tail<Event, K, Params, Activation, Provided, Result>;
}

/** After `input`: only `atActivation`, then the chain. */
export interface AfterInput<Event, K extends Kind, Params> extends Chain<Event, K, Params, undefined, unknown> {
  /**
   * Event-turn work that an API requires inside the event's own call stack. Synchronous: a callback
   * with a thenable return type is a compile error, and a thenable that arrives at runtime ends the
   * invocation as 'activation-error'.
   */
  atActivation<Activation>(
    perform: (context: ActivationContext<Event>) => Activation,
    ...synchronous: Synchronous<Activation>
  ): Chain<Event, K, Params, Activation, unknown>;
}

/** The start of every definition. Order is fixed: input, atActivation, before..., run. */
export interface Begin<Event, K extends Kind> extends AfterInput<Event, K, undefined> {
  /**
   * Runs synchronously when the event occurs, before any await, and copies out what later work needs.
   * Effect-free by contract. A thenable result is a compile error, and a thenable that arrives at
   * runtime ends the invocation as 'invalid-input'.
   */
  input<Params>(extract: (event: Event) => Params, ...synchronous: Synchronous<Params>): AfterInput<Event, K, Params>;
}

type HookName = 'onSuccess' | 'onFailure' | 'onCanceled' | 'onFinally';
type TailName = 'limits' | 'whenBusy' | 'observe' | HookName;

/** Hooks wait for `limits`; a server action cannot `build` without it. Each member is available once. */
type Hidden<K extends Kind, Used extends TailName> = 'limits' extends Used
  ? never
  : HookName | (K extends 'server' ? 'build' : never);

interface TailMembers<Event, K extends Kind, Params, Activation, Provided, Result, Used extends TailName> {
  limits(limits: K extends 'server' ? ServerLimits : LocalLimits): Tail<Event, K, Params, Activation, Provided, Result, Used | 'limits'>;
  whenBusy(policy: BusyPolicy): Tail<Event, K, Params, Activation, Provided, Result, Used | 'whenBusy'>;
  observe(observer: ActionObserver): Tail<Event, K, Params, Activation, Provided, Result, Used | 'observe'>;
  onSuccess(
    hook: (context: SuccessContext<Params, Activation, Provided, Result>) => void | Promise<void>,
  ): Tail<Event, K, Params, Activation, Provided, Result, Used | 'onSuccess'>;
  onFailure(
    hook: (context: FailureContext<Params, Activation, Provided, Result>) => void | Promise<void>,
  ): Tail<Event, K, Params, Activation, Provided, Result, Used | 'onFailure'>;
  onCanceled(
    hook: (context: CanceledContext<Params, Activation, Provided, Result>) => void | Promise<void>,
  ): Tail<Event, K, Params, Activation, Provided, Result, Used | 'onCanceled'>;
  onFinally(
    hook: (context: FinallyContext<Result>) => void | Promise<void>,
  ): Tail<Event, K, Params, Activation, Provided, Result, Used | 'onFinally'>;
  build(): ActionDefinition<Event>;
}

/** What may still be called after `run`. */
export type Tail<
  Event,
  K extends Kind,
  Params,
  Activation,
  Provided,
  Result,
  Used extends TailName = never,
> = Omit<TailMembers<Event, K, Params, Activation, Provided, Result, Used>, Used | Hidden<K, Used>>;

// Stand-ins for the pinned upstream shapes (App.callServerTool, RequestOptions, CallToolResult).
export interface CallToolParams {
  readonly name: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}
export interface CallToolResult {
  readonly content: readonly unknown[];
  readonly isError?: boolean;
}
export interface ServerRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeout?: number;
}
export interface ServerTransport {
  callServerTool(params: CallToolParams, options?: ServerRequestOptions): Promise<CallToolResult>;
}

export declare const Action: {
  local<Event>(label: string): Begin<Event, 'local'>;
  server<Event>(label: string, transport: ServerTransport): Begin<Event, 'server'>;
};

// ---------------------------------------------------------------------------
// Attachment
// ---------------------------------------------------------------------------

export type BindingPhase = 'idle' | 'running' | 'settling' | 'disposed';

/** Replaced (never mutated) on every change, so identity comparison detects change. */
export interface BindingState {
  readonly phase: BindingPhase;
}

/** What `bindAction` returns: one component occurrence's connection to one definition. */
export interface ActionBinding {
  /** Opaque; equals `bindingId` in telemetry. It finds nothing: no member of this API maps an id to a binding. */
  readonly id: string;
  readonly state: BindingState;
  /**
   * Calls `listener` after each state change; carries no event data. Returns the unsubscribe
   * function. A listener that throws, or returns a rejecting thenable, never affects the action.
   * The state it reads is the snapshot for this binding only: this is not an action bus.
   */
  subscribe(listener: () => void): () => void;
  /** Idempotent. Cancels an undecided invocation with cause 'disposed', then detaches. A decided outcome is never rewritten. */
  dispose(): void;
}

/**
 * Optional, per binding. `subject` reads, through a supported application or renderer API and not
 * through a view object captured by an earlier render, the semantic item the occurrence currently
 * shows (for a list row, a token that changes whenever the shown item changes). The runtime captures
 * it at activation and compares it with `Object.is` against a fresh read at every runtime decision
 * point and on each `current()` call. A reader that throws at activation ends the invocation as
 * 'invalid-input'; one that throws later counts as a change. Without `subject`, the invocation's
 * target is the occurrence alone.
 */
export interface BindOptions {
  readonly subject?: () => unknown;
}

export interface ComponentHandle<Events> {
  readonly id: string;
  bindAction<Name extends keyof Events>(
    event: Name,
    action: ActionDefinition<Events[Name]>,
    options?: BindOptions,
  ): ActionBinding;
}

declare const kindEvents: unique symbol;
/** A directly imported token for a component kind; not a string-keyed lookup. */
export interface ComponentKind<Events> {
  readonly [kindEvents]: Events;
}

export interface SurfaceView {
  /** Throws when no occurrence, or more than one, has this id in the surface. */
  getById<Events>(id: string, kind: ComponentKind<Events>): ComponentHandle<Events>;
  /**
   * Setup-time discovery for occurrences that appear later or are recreated. Calls `onHandle` once per
   * occurrence with that occurrence's handle. Unsubscribing stops discovery only: it disposes no binding
   * and removes no installed callable. The index behind it is never consulted to route an activation.
   */
  watchById<Events>(id: string, kind: ComponentKind<Events>, onHandle: (handle: ComponentHandle<Events>) => void): () => void;
}

// Illustrative adapter event types. Each adapter defines the events of each component kind it renders;
// nothing here assumes a pointer, a keyboard, or a thread.
export interface ComponentEvent {
  readonly componentId: string;
}
export type ButtonActivation = ComponentEvent;
export interface FieldChange extends ComponentEvent {
  readonly value: string;
}
export interface ButtonEvents {
  readonly activate: ButtonActivation;
}
export interface FieldEvents {
  readonly change: FieldChange;
}

export declare const Button: ComponentKind<ButtonEvents>;
export declare const TextField: ComponentKind<FieldEvents>;

// A generic data-bearing control. This is one control kind, not one kind per action: archive, star and
// open can all attach to it. Its event carries data copied from the exact occurrence when the adapter
// admitted the event, and its handle can read what that same occurrence currently represents.
// Illustrative; each adapter supplies the real mechanism from its own data context.
export interface NoteData {
  readonly noteId: string;
}
/** `noteId` is copied from this occurrence at activation. It is undefined while the row has no note. */
export interface NoteActivation extends ComponentEvent {
  readonly noteId: string | undefined;
}
export interface NoteEvents {
  readonly activate: NoteActivation;
}
declare const kindData: unique symbol;
export interface DataBearingKind<Events, Data> extends ComponentKind<Events> {
  readonly [kindData]: Data;
}
/**
 * Bound to one exact occurrence. `readData` reads that occurrence's current data through the renderer's
 * supported data context on every call, never a closure over props resolved by an earlier render, and
 * never an ID lookup. After the occurrence is retired it returns undefined instead of reading a
 * replacement occurrence.
 */
export interface DataHandle<Events, Data> extends ComponentHandle<Events> {
  readData(): Data | undefined;
}
export declare const NoteRow: DataBearingKind<NoteEvents, NoteData>;

/**
 * An illustrative view for an adapter whose data-bearing kinds expose `readData`. Each specialized
 * overload is followed by the general one it refines, so the view stays assignable to `SurfaceView`.
 * An adapter with a different data reader declares its own view; the general `SurfaceView` is unchanged.
 */
export interface DataSurfaceView extends SurfaceView {
  getById<Events, Data>(id: string, kind: DataBearingKind<Events, Data>): DataHandle<Events, Data>;
  getById<Events>(id: string, kind: ComponentKind<Events>): ComponentHandle<Events>;
  watchById<Events, Data>(
    id: string,
    kind: DataBearingKind<Events, Data>,
    onHandle: (handle: DataHandle<Events, Data>) => void,
  ): () => void;
  watchById<Events>(id: string, kind: ComponentKind<Events>, onHandle: (handle: ComponentHandle<Events>) => void): () => void;
}

export declare const view: DataSurfaceView;
export declare const transport: ServerTransport;

// ---------------------------------------------------------------------------
// Application code (declared here so the file is self-contained)
// ---------------------------------------------------------------------------

interface Session {
  readonly userKey: string;
}
declare function currentSession(signal: AbortSignal): Promise<Session | undefined>;
declare function readDraftText(): string;
declare function saveDraftLocally(userKey: string, text: string, signal: AbortSignal): Promise<{ readonly savedAt: number }>;
/** Throws ArchiveReplyUnreadable when the reply cannot be parsed. */
declare function parseArchived(result: CallToolResult): { readonly archivedAt: number };
declare function askToArchive(userKey: string, noteId: string): Promise<boolean>;
declare const auditStore: { append(kind: string, signal: AbortSignal): Promise<boolean> };
/** Required client work after a successful archive: the application's own durable record. */
declare function recordArchived(archivedAt: number, signal: AbortSignal): Promise<void>;
declare function refreshArchiveList(signal: AbortSignal): Promise<void>;
declare function showSavedAt(savedAt: number): void;
declare function showSavedButViewFailed(savedAt: number): void;
declare function showSaveStatusUnknown(): void;
declare function showSignIn(): void;
declare function showError(message: string): void;
declare function showArchived(archivedAt: number): void;
declare function showArchivedButViewFailed(archivedAt: number): void;
declare function showArchiveStatusUnknown(): void;
declare function renderArchiveButton(busy: boolean): void;
declare const detailsPanel: { toggle(): void };
declare class ArchiveRejected extends Error {}
declare class ArchiveReplyUnreadable extends Error {}
declare const needsAsync: boolean;
declare function toggleStar(noteId: string): void;

// A reusable prerequisite that provides a value. SAGA does not decide how the session is checked,
// cached, or refreshed.
export const requireSession = prerequisite('session', async ({ signal }) => {
  const session = await currentSession(signal);
  return session ? proceed({ session }) : refuse('sign-in-required');
});

// A prerequisite that needs a provided value and the extracted params. Annotating the context fixes both.
export const confirmArchive = prerequisite(
  'confirm-archive',
  async ({ provided, params }: PrerequisiteContext<{ readonly session: Session }, { readonly noteId: string }>) => {
    const accepted = await askToArchive(provided.session.userKey, params.noteId);
    return accepted ? proceed({ confirmed: true as const }) : refuse('declined');
  },
);

// A guard that provides nothing. Durable audit that must exist before the handler runs belongs here.
export const auditIntent = prerequisite('audit-intent', async ({ signal }) =>
  (await auditStore.append('archive-requested', signal)) ? proceed() : refuse('audit-unavailable'),
);

// 1. Synchronous local action: no params, no prerequisites, no hooks, no limits.
export const toggleDetails = Action.local<ButtonActivation>('toggle-details')
  .run(() => detailsPanel.toggle())
  .build();

// 2. Asynchronous local action that reuses the session prerequisite. The numbers are examples, not defaults.
//    The hooks are synchronous and the runtime does not start them for an obsolete invocation, so
//    nothing here can run after a gap that `current()` would need to cover.
export const saveDraft = Action.local<ButtonActivation>('save-draft')
  .input(() => ({ text: readDraftText() }))
  .before(requireSession)
  .run(({ params, provided, signal }) => saveDraftLocally(provided.session.userKey, params.text, signal))
  .limits({ deadlineMs: 10_000, hookMs: 1_000 })
  .onSuccess(({ result }) => showSavedAt(result.savedAt))
  .onFailure((context) => {
    if (context.stage === 'prerequisites' && context.failure.kind === 'refused') return showSignIn();
    // input or prerequisite stage: the handler never started, so no save was attempted.
    if (context.stage !== 'running') return showError('Nothing was attempted; the draft is unchanged');
    const { failure } = context;
    // The handler returned, so the save completed; only the client's required view work failed.
    if (failure.kind === 'success-hook-error' || failure.kind === 'success-hook-timeout') {
      return showSavedButViewFailed(failure.result.savedAt);
    }
    // The handler threw, or had not settled when a deadline or cancellation decided: unknown.
    return showSaveStatusUnknown();
  })
  .build();

// 3. Server action: the same prerequisite, a second one that needs it, a guard that provides nothing,
//    and a handler that initiates the request. The server's own handler is not referenced from here.
//    The workflow is written once. Its only renderer-specific part is how the pressed occurrence's note
//    identifier is read from that renderer's event, so each renderer supplies that projection.
export function requireNoteId(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new Error('this row shows no note');
  return value;
}

export function archiveNoteWith<Event>(noteIdOf: (event: Event) => string) {
  return Action.server<Event>('archive-note', transport)
  .input((event) => ({ noteId: noteIdOf(event) }))
  .before(requireSession)
  .before(confirmArchive)
  .before(auditIntent)
  .run(async ({ params, call }) => {
    const reply = await call('archive_note', { noteId: params.noteId });
    // Tool-level failures arrive as a result with isError, not as an exception (pinned upstream doc).
    // This example's tool reports isError only when it changed nothing; that is the tool's contract, not MCP's.
    if (reply.isError) throw new ArchiveRejected('The server declined to archive the note');
    return parseArchived(reply);
  })
  .limits({ deadlineMs: 30_000, hookMs: 2_000 })
  // Required client work after the server effect, then this hook's own check right before the commit.
  // If `recordArchived` ignores the abort and outlasts `hookMs`, `current()` is false when it resumes.
  .onSuccess(async ({ result, signal, current }) => {
    await recordArchived(result.archivedAt, signal);
    if (current()) showArchived(result.archivedAt);
  })
  .onFailure(async (context) => {
    // Input or prerequisite stage: the handler never started, so no archive request was sent.
    if (context.stage !== 'running') {
      if (context.current()) showError('No archive request was sent');
      return;
    }
    const { failure } = context;
    // The handler returned, so the server effect completed; only client work failed. This failure hook
    // has its own eligibility, so its `current()` (unlike `scope.active`) stays true after the failure was
    // decided, while a late `current()` call from the abandoned `onSuccess` is false for good.
    if (failure.kind === 'success-hook-error' || failure.kind === 'success-hook-timeout') {
      await refreshArchiveList(context.signal);
      if (context.current()) showArchivedButViewFailed(failure.result.archivedAt);
      return;
    }
    if (failure.kind === 'handler-error' && failure.error instanceof ArchiveRejected) {
      if (context.current()) showError('The server declined the request');
      return;
    }
    // Timeout, transport failure, or an unreadable reply: the request may have been applied.
    if (context.current()) showArchiveStatusUnknown();
  })
  .whenBusy('ignore')
  .observe((event) => void event.phase)
  .build();
}

// The data-bearing example: the adapter copied `noteId` from the exact occurrence that fired.
export const archiveNote = archiveNoteWith(({ noteId }: NoteActivation) => requireNoteId(noteId));

// The subject reader asks THIS handle for the note its occurrence shows now.
function archiveOn(handle: DataHandle<NoteEvents, NoteData>): ActionBinding {
  return handle.bindAction('activate', archiveNote, { subject: () => handle.readData()?.noteId });
}

// Attachment: one definition, independent bindings, observable state.
export const detailsBinding = view.getById('details-toggle', Button).bindAction('activate', toggleDetails);
export const saveBinding = view.getById('save', Button).bindAction('activate', saveDraft);
export const archiveBindingA = archiveOn(view.getById('archive-a', NoteRow));
export const archiveBindingB = archiveOn(view.getById('archive-b', NoteRow));
export const stopWatchingArchive = archiveBindingA.subscribe(() =>
  renderArchiveButton(archiveBindingA.state.phase === 'running'),
);
archiveBindingA.dispose();
stopWatchingArchive();
// Disposing a binding does not retire its handle: the same live handle takes a new attachment.
export const archiveBindingA2 = archiveOn(view.getById('archive-a', NoteRow));
// A second, different definition on the same data-bearing control kind: no catalog type per action.
export const starNote = Action.local<NoteActivation>('star-note')
  .input(({ noteId }) => ({ noteId: requireNoteId(noteId) }))
  .run(({ params }) => toggleStar(params.noteId))
  .build();
export const starBinding = view.getById('star-a', NoteRow).bindAction('activate', starNote);

// An action written against the supertype binds where the adapter supplies a subtype.
export const logActivation = Action.local<ComponentEvent>('log-activation')
  .input((event) => ({ id: event.componentId }))
  .run(({ params }) => params.id)
  .build();
view.getById('details-toggle', Button).bindAction('activate', logActivation);
view.getById('title-field', TextField).bindAction('change', logActivation);

// An asynchronous observer is accepted by the type; the runtime guards its rejection.
export const asyncObserved = Action.local<ButtonActivation>('async-observed')
  .run(() => 0)
  .limits({ hookMs: 500 })
  .observe(async (event) => {
    await Promise.resolve(event.invocationId);
  })
  .build();

// Occurrences that appear later. Discovery only delivers handles; the owning setup also keeps and ends
// every binding and state subscription that its callback created, even when the callback fails part way.
const ownedRowBindings = new Set<() => void>();
export const stopRowDiscovery = view.watchById('row-archive', NoteRow, (handle) => {
  const binding = archiveOn(handle);
  let stopState: (() => void) | undefined;
  const end = (): void => {
    stopState?.();
    binding.dispose();
    ownedRowBindings.delete(end);
  };
  ownedRowBindings.add(end);
  try {
    stopState = binding.subscribe(() => {
      renderArchiveButton(binding.state.phase === 'running');
      if (binding.state.phase === 'disposed') end();
    });
  } catch (error) {
    end();
    throw error;
  }
});
export function teardownRows(): void {
  stopRowDiscovery();
  for (const end of [...ownedRowBindings]) end();
}

// ---------------------------------------------------------------------------
// Adapter plumbing (internal; not an author API). Shown so the freshness contract has a named seam.
// ---------------------------------------------------------------------------

/** What an adapter gives the runtime for one occurrence. Illustrative. */
export interface AdapterOccurrence {
  /**
   * Reads supported renderer state at call time: the node or context is not retired and the host or
   * model generation is the one this installation was attached under. Never a cached boolean.
   */
  isLive(): boolean;
  /** An event captured under another installation epoch is ignored with reason 'stale-installation'. */
  readonly installationEpoch: unknown;
  /**
   * Optional wake-up. While one invocation is not idle, the runtime subscribes, treats each call to
   * `revalidate` as a checkpoint that applies the same rules as any other, and unsubscribes when the
   * invocation settles or is replaced or disposed. It never decides an outcome differently.
   */
  watchScope?(revalidate: () => void): () => void;
}

// ---------------------------------------------------------------------------
// Resource that must survive success: owner-scoped lease with transfer
// ---------------------------------------------------------------------------

/** One acquisition of the shared foreground player. */
export interface PlayerLease {
  readonly id: symbol;
}

/** The application's owner of the one shared player. It implements the token contract itself. */
export interface PlayerOwner {
  /** Inside the activation: ends the previous lease's audio, prepares the player, returns the new lease. */
  begin(): PlayerLease;
  /** Rejects when `lease` has been superseded. */
  start(lease: PlayerLease, bytes: ArrayBuffer, signal: AbortSignal): Promise<'started' | 'blocked'>;
  /** Marks the lease as long-lived: it now belongs to the owner, not to an invocation. Synchronous. */
  keep(lease: PlayerLease): void;
  /** Ends only this lease's audio. Idempotent; a no-op when a newer lease exists or the lease already ended. */
  end(lease: PlayerLease): void;
  /** The owner's own teardown: ends whatever lease is current. Never called by an invocation. */
  endCurrent(): void;
}
declare const playerOwner: PlayerOwner;
declare function fetchMedia(userKey: string, signal: AbortSignal): Promise<ArrayBuffer>;
declare function showPlaying(): void;
declare function showGestureNeeded(): void;
declare function showPlaybackFailed(): void;
declare function showPlayingButViewFailed(): void;

export const play = Action.local<ButtonActivation>('play')
  .atActivation(({ scope }) => scope.own(playerOwner.begin(), (lease) => playerOwner.end(lease)))
  .before(requireSession)
  .run(async ({ activation, provided, signal }) => {
    const bytes = await fetchMedia(provided.session.userKey, signal);
    const started = await playerOwner.start(activation.token, bytes, signal);
    // Not started: the scope still owns the lease and releases it. Started: hand it to the owner with no await in between.
    if (started === 'blocked') return { state: 'gesture-needed' } as const;
    return activation.transfer((lease) => playerOwner.keep(lease))
      ? ({ state: 'playing', lease: activation.token } as const)
      : ({ state: 'gesture-needed' } as const);
  })
  .limits({ deadlineMs: 20_000, hookMs: 1_000 })
  .onSuccess(({ result }) => (result.state === 'playing' ? showPlaying() : showGestureNeeded()))
  // Every cancellation stage carries the activation token. After a transfer the owner holds the lease, so
  // end exactly this lease, idempotently. Before a transfer the scope releases it too, which is a harmless repeat.
  .onCanceled(({ activation }) => playerOwner.end(activation.token))
  .onFailure((context) => {
    if (context.stage === 'input') return showPlaybackFailed();
    if (context.stage === 'running') {
      const { failure } = context;
      if (failure.kind === 'success-hook-error' || failure.kind === 'success-hook-timeout') {
        // Chosen policy: only a result that records a started, transferred lease stays owner-held.
        if (failure.result.state === 'playing') return showPlayingButViewFailed();
        // A blocked start never transferred the lease. Nothing is playing; the scope still releases it.
      }
    }
    // Every other failure ends exactly this lease; a repeat of the scope's own release is harmless.
    playerOwner.end(context.activation.token);
    return showPlaybackFailed();
  })
  .build();
view.getById('play', Button).bindAction('activate', play);

// ---------------------------------------------------------------------------
// Positive checks of the type-state and synchronous-boundary rules
// ---------------------------------------------------------------------------

// P1: a guard that provides nothing attaches, and earlier provided values are preserved.
export const guardedLocal = Action.local<ButtonActivation>('guarded')
  .before(requireSession)
  .before(auditIntent)
  .run(({ provided }) => provided.session.userKey)
  .build();

// P2: a prerequisite that needs less than the action provides is accepted.
export const needsOnlySession = Action.local<ButtonActivation>('needs-only-session')
  .input(() => ({ noteId: 'note-1', extra: 1 }))
  .before(requireSession)
  .before(confirmArchive)
  .run(({ params, provided }) => `${params.noteId}:${params.extra}:${provided.confirmed}`)
  .build();

// P3: a synchronous prerequisite attaches the same way.
export const syncGuard = prerequisite('sync-guard', () => proceed());
export const withSyncGuard = Action.local<ButtonActivation>('with-sync-guard').before(syncGuard).run(() => 1).build();

// P4: a synchronous callback that always throws returns `never`, which is valid.
export const throwingActivation = Action.local<ButtonActivation>('throwing-activation')
  .atActivation(() => {
    throw new Error('activation failed synchronously');
  })
  .run(() => 0)
  .build();

// P5: a union without a thenable constituent is accepted.
export const optionalActivation = Action.local<ButtonActivation>('optional-activation')
  .atActivation(() => (needsAsync ? undefined : 1))
  .run(({ activation }) => activation ?? 0)
  .build();

// P6: a retained alias is a branch. Two branches each register one hook; neither sees the other.
const baseDraft = Action.local<ButtonActivation>('branch').run(() => 1).limits({ hookMs: 1 });
export const branchA = baseDraft.onSuccess(() => undefined).build();
export const branchB = baseDraft.onSuccess(() => undefined).build();

// P7: the primary outcome keeps the failure stage, so final reporting can tell "never started" from "unknown".
export const finalReport = Action.server<ButtonActivation>('final-report', transport)
  .run(() => 0)
  .limits({ deadlineMs: 1, hookMs: 1 })
  .onFinally(({ outcome, cleanupErrors }) => {
    if (outcome.status === 'failed' && outcome.stage === 'prerequisites') void outcome.failure.kind; // not started
    if (outcome.status === 'failed' && outcome.stage === 'running') void outcome.failure.kind; // effect may be unknown
    void cleanupErrors.length; // diagnostics, kept apart from the outcome
  })
  .build();

// P8: `current()` is available to a handler and to a prerequisite.
export const freshHandler = Action.local<ButtonActivation>('fresh-handler')
  .before(prerequisite('fresh-guard', ({ current }) => (current() ? proceed() : refuse('stale'))))
  .run(async ({ current }) => (current() ? 1 : 0))
  .build();

// L1: a static limit, recorded rather than hidden. A promise returned through a declared `unknown`
//     cannot be seen by the types, so this compiles. The runtime check on the returned value catches it.
declare const hiddenAsync: () => unknown;
export const hiddenAsyncActivation = Action.local<ButtonActivation>('hidden-async')
  .atActivation(hiddenAsync)
  .run(() => 0)
  .build();

// ---------------------------------------------------------------------------
// Negative cases: each directive must suppress exactly one real type error.
// ---------------------------------------------------------------------------

// N1: the handler reads a value no prerequisite provides.
Action.local<ButtonActivation>('n1')
  // @ts-expect-error `session` is not provided without .before(requireSession)
  .run(({ provided }) => provided.session.userKey)
  .build();

// N2: confirmArchive needs a session, so it cannot be ordered before requireSession.
Action.server<ButtonActivation>('n2', transport)
  .input(() => ({ noteId: 'note-1' }))
  // @ts-expect-error confirmArchive needs { session } that nothing has provided yet
  .before(confirmArchive)
  .before(requireSession)
  .run(() => 0)
  .limits({ deadlineMs: 1, hookMs: 1 })
  .build();

// N3: a prerequisite that reads params cannot be used on an action that extracts none.
Action.local<ButtonActivation>('n3')
  .before(requireSession)
  // @ts-expect-error confirmArchive needs { noteId } params, and this action extracts none
  .before(confirmArchive)
  .run(() => 0)
  .build();

// N4: the success hook sees the handler's actual result type.
Action.local<ButtonActivation>('n4')
  .run(() => ({ savedAt: 1 }))
  .limits({ hookMs: 1 })
  // @ts-expect-error savedAt is a number
  .onSuccess(({ result }) => result.savedAt.toUpperCase())
  .build();

// N5: provided values do not exist when a prerequisite refused.
Action.local<ButtonActivation>('n5')
  .before(requireSession)
  .run(() => 0)
  .limits({ hookMs: 1 })
  .onFailure((context) => {
    if (context.stage === 'prerequisites') {
      // @ts-expect-error `provided` is only present at stage 'running'
      void context.provided;
    }
  })
  .build();

// N6: an action that reads a field's value cannot attach to a button's activation.
declare const echoField: ActionDefinition<FieldChange>;
// @ts-expect-error ButtonActivation has no `value`
view.getById('details-toggle', Button).bindAction('activate', echoField);

// N7: a component kind with no such event.
// @ts-expect-error ButtonEvents has no 'hover'
view.getById('details-toggle', Button).bindAction('hover', toggleDetails);

// N8: a local action has no server call.
Action.local<ButtonActivation>('n8')
  // @ts-expect-error `call` exists only on server actions
  .run(({ call }) => call('archive_note', {}))
  .build();

// N9: telemetry events carry no params or results.
Action.local<ButtonActivation>('n9')
  .run(() => 0)
  // @ts-expect-error ObservedEvent has no `params`
  .observe((event) => void event.params)
  .build();

// N10: input cannot be changed once a prerequisite that depends on it is attached.
Action.local<ButtonActivation>('n10')
  .input(() => ({ noteId: 'a' }))
  .before(requireSession)
  .before(confirmArchive)
  // @ts-expect-error `input` is not available after `before`
  .input(() => ({}))
  .run(() => 0)
  .build();

// N11: input is configured once, and before atActivation.
Action.local<ButtonActivation>('n11')
  .input(() => ({ noteId: 'a' }))
  // @ts-expect-error `input` is not available twice
  .input(() => ({ noteId: 'b' }))
  .run(() => 0)
  .build();
Action.local<ButtonActivation>('n11b')
  .atActivation(() => 1)
  // @ts-expect-error `input` is not available after atActivation
  .input(() => ({ noteId: 'b' }))
  .run(() => 0)
  .build();

// N12: a hook is registered once.
Action.local<ButtonActivation>('n12')
  .run(() => 0)
  .limits({ hookMs: 1 })
  .onSuccess(() => undefined)
  // @ts-expect-error `onSuccess` is not available twice
  .onSuccess(() => undefined)
  .build();

// N13: a server action has no `build` until limits are given.
// @ts-expect-error `build` is not available before `limits` on a server action
Action.server<ButtonActivation>('n13', transport).run(() => 0).build();

// N14: hooks wait for limits, so a hook always has a budget.
Action.local<ButtonActivation>('n14')
  .run(() => 0)
  // @ts-expect-error `onSuccess` is not available before `limits`
  .onSuccess(() => undefined)
  .build();

// N15: a server action's limits must include a work deadline.
Action.server<ButtonActivation>('n15', transport)
  .run(() => 0)
  // @ts-expect-error deadlineMs is required for a server action
  .limits({ hookMs: 1 })
  .build();

// N16: an activation callback cannot return a promise, and no argument gets past the guard.
Action.local<ButtonActivation>('n16')
  // @ts-expect-error atActivation must return synchronously
  .atActivation(async () => 1)
  .run(() => 0)
  .build();

// N17: a union with a thenable constituent is rejected too, not only a plain promise.
Action.local<ButtonActivation>('n17')
  // @ts-expect-error the callback may return a Promise
  .atActivation(() => (needsAsync ? Promise.resolve(1) : undefined))
  .run(() => 0)
  .build();

// N18: the guard has no diagnostic-string escape.
Action.local<ButtonActivation>('n18')
  // @ts-expect-error a string is not assignable to the guard parameter
  .atActivation(async () => 1, 'atActivation must return synchronously; start awaited work in before or run')
  .run(() => 0)
  .build();

// N19: the input extractor is synchronous.
Action.local<ButtonActivation>('n19')
  // @ts-expect-error input must return synchronously
  .input(async (event) => event.componentId)
  .run(() => 0)
  .build();

// N20: an adoption callback is synchronous, so an async callback cannot claim a synchronous transfer.
Action.local<ButtonActivation>('n20')
  .atActivation(({ scope }) => scope.own(1, () => undefined))
  .run(({ activation }) =>
    // @ts-expect-error adoption must finish synchronously
    activation.transfer(async (token) => {
      await Promise.resolve(token);
    }),
  )
  .build();

// N21: a cancellation before the result was observed carries no result.
Action.local<ButtonActivation>('n21')
  .run(() => 0)
  .limits({ hookMs: 1 })
  .onCanceled((context) => {
    // @ts-expect-error `result` exists only at stage 'completing'
    void context.result;
  })
  .build();

// N22: the event-turn scope cannot await an acquisition.
Action.local<ButtonActivation>('n22')
  // @ts-expect-error ActivationScope has no `acquire`
  .atActivation(({ scope }) => void scope.acquire)
  .run(() => 0)
  .build();

// N23: the delivered outcome is the primary decision only; cleanup diagnostics are a separate list.
Action.local<ButtonActivation>('n23')
  .run(() => 0)
  .limits({ hookMs: 1 })
  .onFinally(({ outcome }) => {
    // @ts-expect-error Outcome has no cleanupErrors
    void outcome.cleanupErrors;
  })
  .build();

// N24: an action written for the data-bearing row event cannot attach to a plain button, whose event has no noteId.
// @ts-expect-error ButtonActivation has no `noteId`
view.getById('details-toggle', Button).bindAction('activate', archiveNote);

// N25: a plain handle has no data reader; it is never cast into one.
// @ts-expect-error ComponentHandle has no readData
void view.getById('details-toggle', Button).readData();
```

## B. Renderer declarations

This file declares the proposed Lit and React occurrence types, the discovery view that supplies them, the occurrence host and its factory, and the Lynx control types. It then compiles the renderer examples printed in the Blueprint against A: `openReport`, the archive workflow with the Lit and React projection and with the Lynx projection, the two Lynx order actions with their different busy policies, and the Lynx setup that binds three occurrences of one control type. `OccurrenceView` extends the general `SurfaceView` and is the stronger view of the Lit and React registration. The Lynx declarations use neither `watchById` nor `OccurrenceView`. One `@ts-expect-error` shows that a general handle has no `read`, so the row example needs the stronger view.

**Receipt.** Saved as `renderer.types.ts` (first 16 hex digits of its SHA-256: `4f2b0ec1fe7b8492`) next to `authoring.types.ts`, which it imports unmodified. TypeScript 6.0.3 and 5.9.3 each ran this command, which is A's command with the file name changed. Running A's command as printed checks only `authoring.types.ts`.

```text
tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
    --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom \
    renderer.types.ts
```

Both compilers exited 0 with no diagnostics. With the one directive removed, each reported exactly one error, TS2339 on `read` for the general handle. The Lynx control and the Lit and React host have signatures only. No body runs.

**What this check cannot show.** The Lynx declarations say only that `itemKey` returns a reader, so the compiler cannot tell whether two calls on one occurrence are compatible. In the proposed Lynx slot an occurrence tracks one item key, `itemKey` starts that watch at once, and a second different key throws. The setup example below therefore calls `itemKey` only inside the branch that binds, and an unrecognized ID starts no watch. That follows from the proposed mechanism in [section D](#d-lynx-freshness-and-admission-mechanism). It is not something the declaration check establishes.

```ts
// Declaration-level check of the renderer-facing declarations and examples printed in the Blueprint,
// against the authoring declarations. Declarations only; nothing here runs.
import {
  Action,
  archiveNoteWith,
  requireNoteId,
  type ActionBinding,
  type ActionDefinition,
  type ComponentEvent,
  type ComponentHandle,
  type ComponentKind,
  type SurfaceView,
} from './authoring.types';

// ---- Lit and React: occurrence data and the stronger view ----------------------------------------
export interface OccurrenceEvent extends ComponentEvent {
  readonly dataPath: string; // '/' outside any template
  readonly native: Event;
  read(path: string): unknown; // this occurrence's data scope, now; answers only during delivery
}
export interface OccurrenceHandle<Events> extends ComponentHandle<Events> {
  readonly dataPath: string;
  read(path: string): unknown; // undefined once the occurrence is not live
}
export interface ActionButtonEvents {
  readonly activate: OccurrenceEvent;
}
export declare const ActionButton: ComponentKind<ActionButtonEvents>;

// The stronger view that the Lit and React registration supplies. It stays assignable to SurfaceView.
export interface OccurrenceView extends SurfaceView {
  getById<Events>(id: string, kind: ComponentKind<Events>): OccurrenceHandle<Events>;
  watchById<Events>(
    id: string,
    kind: ComponentKind<Events>,
    onHandle: (handle: OccurrenceHandle<Events>) => void,
  ): () => void;
}

export interface BindingSeam {
  readonly isLive: () => boolean;
  readonly subject?: () => unknown;
  readonly watchScope?: (revalidate: () => void) => () => void;
  readonly detach: () => void;
}
export declare function createBinding<Event>(
  definition: ActionDefinition<Event>,
  seam: BindingSeam,
): { readonly binding: ActionBinding; readonly activate: (event: Event) => void };

export interface OpenInfo {
  readonly kind: ComponentKind<any>;
  readonly componentType: string;
  readonly componentId: string;
  readonly dataPath: string;
  readonly events: readonly string[];
  readonly isLive: () => boolean;
  readonly read: (path: string) => unknown;
  readonly watchScope?: (revalidate: () => void) => () => void;
}
export interface OpenOccurrence {
  activate(event: string, native: Event): 'started' | 'unbound' | 'retired';
  readonly retire: () => void;
}
export interface OccurrenceHost {
  register(setup: (view: OccurrenceView) => void): () => void;
  open(info: OpenInfo): OpenOccurrence;
  close(): void;
}
export declare function createOccurrenceHost(options: { onSetupError(error: unknown): void }): OccurrenceHost;

declare const occurrenceView: OccurrenceView;
declare const reportPanel: { open(): void };

export const openReport = Action.local<OccurrenceEvent>('open-report')
  .run(() => reportPanel.open())
  .build();

// The archive workflow from the authoring section, with this renderer's projection of the note identifier.
export const archiveNoteFromRow = archiveNoteWith((event: OccurrenceEvent) => requireNoteId(event.read('id')));

occurrenceView.watchById('open-report', ActionButton, (handle) => {
  handle.bindAction('activate', openReport);
});
occurrenceView.watchById('row-archive', ActionButton, (handle) => {
  handle.bindAction('activate', archiveNoteFromRow, { subject: () => handle.read('id') });
});

// An action written for the general view also works against the occurrence view.
export function attachGeneral(view: SurfaceView): void {
  view.watchById('open-report', ActionButton, (handle) => {
    handle.bindAction('activate', openReport);
  });
}
attachGeneral(occurrenceView);

// A general handle has no reader, so the row example needs the stronger view.
export function attachRowToGeneralView(view: SurfaceView): void {
  view.watchById('row-archive', ActionButton, (handle) => {
    // @ts-expect-error a general ComponentHandle has no `read`
    handle.bindAction('activate', archiveNoteFromRow, { subject: () => handle.read('id') });
  });
}

// ---- Lynx: the catalog control hands the handle to setup; no discovery facade ----------------------
export interface ControlActivation extends ComponentEvent {
  readonly surfaceId: string;
  readonly sourceComponentId: string;
  read(prop: string): unknown; // valid only while extraction runs
}
export interface ControlEvents {
  readonly activate: ControlActivation;
}
export interface LynxOccurrenceHandle extends ComponentHandle<ControlEvents> {
  readonly sourceComponentId: string;
  read(prop: string): unknown; // live, background only
  itemKey(prop: string): () => unknown; // a subject reader, background only
}
export interface ActionControlOptions {
  readonly name: string;
  setup(handle: LynxOccurrenceHandle): void;
  onSetupError(error: unknown): void;
  readonly disableWhileBusy?: boolean;
}
export declare function createActionControl(options: ActionControlOptions): { readonly name: string; readonly component: unknown };

declare function postOrder(verb: 'submit' | 'cancel', orderId: string, signal: AbortSignal): Promise<{ readonly status: string }>;
declare function refreshOrderRow(orderId: string): Promise<void>;
declare function showOrderStatus(orderId: string, status: string): void;

const orderIdOf = (event: ControlActivation): string => {
  const value = event.read('orderId');
  if (typeof value !== 'string' || value === '') throw new Error('no order selected');
  return value;
};

export const submitOrder = Action.local<ControlActivation>('submit-order')
  .input((event) => ({ orderId: orderIdOf(event) }))
  .run(({ params, signal }) => postOrder('submit', params.orderId, signal))
  .limits({ deadlineMs: 15_000, hookMs: 1_000 })
  .onSuccess(async ({ result, params, current }) => {
    await refreshOrderRow(params.orderId);
    if (current()) showOrderStatus(params.orderId, result.status);
  })
  .whenBusy('ignore')
  .build();

export const cancelOrder = Action.local<ControlActivation>('cancel-order')
  .input((event) => ({ orderId: orderIdOf(event) }))
  .run(({ params, signal }) => postOrder('cancel', params.orderId, signal))
  .limits({ deadlineMs: 15_000, hookMs: 1_000 })
  .whenBusy('replace')
  .build();

export const archiveNoteFromControl = archiveNoteWith((event: ControlActivation) => requireNoteId(event.read('noteId')));

export const actionButton = createActionControl({
  name: 'ActionButton',
  setup(handle) {
    'background only';
    // An occurrence tracks one item key, and `itemKey` starts that watch at once. Each branch therefore
    // asks only for its own key, and an unrecognized ID starts no watch.
    switch (handle.sourceComponentId) {
      case 'submit-order':
        handle.bindAction('activate', submitOrder, { subject: handle.itemKey('orderId') });
        return;
      case 'cancel-order':
        handle.bindAction('activate', cancelOrder, { subject: handle.itemKey('orderId') });
        return;
      case 'row-archive':
        handle.bindAction('activate', archiveNoteFromControl, { subject: handle.itemKey('noteId') });
        return;
      default:
        return;
    }
  },
  onSetupError: (error) => console.error('[saga] setup failed', error),
  disableWhileBusy: false,
});
```

## C. Printed renderer blocks

The Lit schema module and element, the React boundary, entry, provider and setup hook, and the React application sketch were extracted from the Blueprint text unchanged and compiled in a scratch project. The project holds these files in `src/`:

| File | Content |
| --- | --- |
| `authoring.types.ts` | Section A, unchanged |
| `occurrence.ts` | Section B (`renderer.types.ts`), standing in for the `./occurrence` module that the Lit and React blocks import |
| `action-button-schema.ts` | The Blueprint's schema block |
| `lit.ts` | The Blueprint's Lit element block |
| `react.tsx` | The Blueprint's React boundary, entry, provider and setup-hook block |
| `app.tsx` | The wrapper below, then the Blueprint's React application sketch unchanged |

The application sketch prints no imports and calls an application-supplied `reportSetupProblem`. The wrapper supplies the ordinary imports of `ActionDefinition`, `OccurrenceEvent`, `OccurrenceView`, `SurfaceModel`, `ReactCatalogComponent` and `A2uiSurface`, and declares `reportSetupProblem`:

```tsx
import { useCallback } from 'react';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import type { ReactCatalogComponent } from '@a2ui/react/v0_9';
import type { ActionDefinition } from './authoring.types';
import { ActionButton, type OccurrenceEvent, type OccurrenceView } from './occurrence';
import { OccurrenceHostProvider, useActionSetup } from './react';
import { A2uiSurface } from '@a2ui/react/v0_9';
declare function reportSetupProblem(error: unknown): void;
```

The project's `tsconfig.json` maps SAGA's Zod export to the `zod` package through a one-line declaration file, `stubs/zod3.d.ts`, containing `export { z } from 'zod';`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "skipLibCheck": true, "noEmit": true,
    "experimentalDecorators": true, "useDefineForClassFields": false, "jsx": "react-jsx",
    "types": [],
    "paths": { "@saga-a2ui/core/protocols/a2ui/zod3": ["./stubs/zod3.d.ts"] }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "stubs/**/*.d.ts"]
}
```

The command, run from the project root, was `tsc -p tsconfig.json` with TypeScript 5.9.3. It ran twice, once in a project whose `@a2ui/lit`, `@a2ui/web_core` and `@a2ui/react` are all at 0.13.0 and once with all three at 0.14.0. Both projects also install `lit` 3.3.3, `react` and `react-dom` 19.3.1, `@types/react` 19.3.0 and `zod` 3.25.76. Copying only the Blueprint's excerpts does not reproduce the check: the renderer declarations as `occurrence.ts`, the wrapper and this configuration are all needed. Removing the wrapper's `reportSetupProblem` declaration makes the compiler report that it cannot find the name, so the wrapper is part of what was checked.

| Check | Result |
| --- | --- |
| Lit schema module and element, React boundary and entry, and React application sketch with the wrapper, 0.13.0 packages | exit 0, no diagnostics |
| The same files, 0.14.0 packages | exit 0, no diagnostics |

The Lit app-element amendment in the Blueprint is illustrative and was not compiled, because the SAGA session types are private. `skipLibCheck` was on, so the dependencies' own declaration files were not checked, only their use. These are author-run results, and the React results and the 0.14.0 results have no independent reproduction. They show that the printed code is well typed against the published declarations. They do not show lifecycle order, shadow-root structure, browser behavior or any runtime property of the Lit or React renderer, and the React runtime equivalence of 0.13.0 and the inspected 0.14.0 commit is unresolved.

## D. Lynx freshness and admission mechanism

This section holds the detail behind the Lynx freshness summary in the [Blueprint](./action_binding.blueprint.md#lynx-lynx-jsgenui-070): the code sketches for the live reader, the observed-key epoch, the source-following subscription and tap admission, the walkthrough of each interval, and the table of situations. It is a proposed mechanism with pinned source citations. It was compiled only in an earlier, reported form (see [Reported renderer checks](#reported-renderer-checks)), and the sketches below are excerpts, not the checked files. Source fact numbers refer to the numbered list in the Blueprint's Lynx section.

**Freshness: which item an occurrence shows.** A logical instance can present a different application item without remounting. After a reorder or a same-position replacement, the processor can produce the same `row:0` ID, the same `/orders/0` path and the same resource for item B that it produced for item A (source fact 8), and the `List` branches key by child ID, by `item.key` or by index, so an instance may also follow an item to a new path. A binding that depended only on surface, component ID and data path would leave A's pending invocation attached to a component now displaying B. That is a lifetime-correctness problem, not only a labeling one. Hiding a stale snapshot during render would be presentation and not cancellation, and it would not protect an application hook that completes before the commit effect has run. What the runtime does when it finds a changed key is the common [outcome rule](./action_binding.blueprint.md#outcome-decision-and-obsolescence): with a subject reader, an undecided invocation is canceled with `subject-changed` and the binding stays installed, and an already-decided outcome is kept. This subsection covers only what the adapter supplies. It has four parts.

| Question | Mechanism | Runs |
| --- | --- | --- |
| Is the running invocation still about the item the data model holds now? | The subject reader, a fresh read of the data model, called by the runtime at its checkpoints and by `current()` in hooks | Background |
| Can the adapter tell the runtime sooner than its next checkpoint? | A subscription to the key's signal that counts observed changes and calls `recheck()` | Background |
| Is this tap from a render that still matches the occurrence? | A token captured in render and compared in `activate` | Render (pure), then background |
| Does the subscription follow the key's actual source? | `reconcile`, run when the key is first tracked, from the commit effect `sync` (which records the committed data context path), and from the component resource's subscription. It compares signal identity, not a path string | Background |

*Where current state comes from.* The subject reader does not read the render's props, which can be one render old. It reads the authoritative state through public types: the raw component the surface holds now (`surface.components.get(id)`), its plain `{ path }` binding resolved against the occurrence's data context path, and the signal for that path in `surface.store`. This is the resolution the built-in resolver itself performs (source fact 3), and by source fact 7 the processor writes the signal store before it publishes component updates, so from the processor's effect onward a read sees the new item before any component re-renders. A literal value is read as itself. A binding that is a function call or any other shape, and an empty resolved path, is unreadable: the live reader returns `undefined`, and the change from a readable key to `undefined` counts as a change. Four limits apply, and each is a stated dependency and not a proven property.

- `absolutePath` copies the three-line rule of the renderer's `resolveBindingPath`, which is not exported. It is a version-sensitive copy, and a planned runtime case compares it with the resolved prop.
- `getSignal` creates an empty signal when the path is absent, so a read has the observable side effect of registering a path with no value, which the store tolerates by design.
- The data context path comes from the last committed render. A processor-expanded clone's map entry also carries its path, but a `List` template row's path exists only in the `List`'s own render, so the reader uses the committed path in every case to keep one rule. When an item moves to a new path, the reader reads the old path until `sync` runs, sees another item there and reports a change. That cancels conservatively, and `sync` then moves the subscription to the new path.
- Signals are documented as reactive on the background thread. The `@lynx-js/react-signals` README (version 0.0.6, a dependency of GenUI 0.7.0) says the ReactLynx build keeps them reactive on the background thread and uses static values in main-thread first-screen rendering. Every read and subscription here is background code. Whether `peek()` and `subscribe` behave as in Node on a Lynx background runtime is unverified.

*The subject reader and the observed-key epoch.* `handle.itemKey('orderId')` returns the reader the application passes as `subject`. It returns the key joined with an adapter-owned counter, `"<epoch>:<key>"`, or `undefined` when the occurrence is retired or the key is unreadable. A key alone cannot distinguish an A, B, A that nobody observed, because the two A keys are equal under `Object.is`. The adapter supplies the narrower thing it can: the observed-key epoch increases whenever its subscription to the key's signal observes a different value.

```ts
private onKey(value: unknown): void {
  const previous = this.seen;
  this.seen = value;
  if (previous === UNSET || Object.is(previous, value)) return;
  this.epoch += 1;
  this.bound?.internal.recheck();         // ask the runtime to re-read subject() now
  this.publish();                          // new snapshot, so the next render has a fresh token
}
```

The signal subscription calls back with each distinct stored value, so an observed A, B, A produces two increments and changes the token even though both keys are `A`. A change that never became visible to the subscription, such as B set and reverted inside one batched update, is not a state anybody could have observed, and this narrower policy does not claim to detect it. An application that needs more joins a revision or version field into the key and binds that. The commit effect keeps no count of its own: the epoch moves only on a value a subscription delivers. When the effect or the resource moves the subscription to another signal, that signal's first value is compared with the last value seen, so the epoch steps only if the displayed key differs. A second counting source could cancel the invocation of the item that is now correctly displayed. This subscription is the adapter's own occurrence observation and may stay active while the binding is idle, because it maintains the tap-admission epoch. It is separate from the runtime's optional, invocation-owned wake-up, and an invocation settling must not erase its identity history. The runtime then compares as described under [the seam](./action_binding.blueprint.md#the-runtime-and-adapter-seam), after first revalidating the old invocation whenever a new tap meets a busy binding.

On timing: in the reported Node checks with the real `SignalStore`, the subscription fires synchronously inside the update, so an invocation is canceled at the data change, before any render or commit effect, and its `onSuccess` write is skipped. A second check removes the adapter's notification and shows that the runtime's own reader still cancels at its next checkpoint. These establish the logic and the Node signal behavior. They do not establish that a Lynx background runtime delivers the subscription callback synchronously, per change, or in an order that precedes React's re-render. If delivery is coalesced or late, the design degrades in a known direction: the reader still catches a changed key at the next checkpoint and `current()` still turns false, and only an unobserved return to the same key goes undetected.

*Following a replaced key binding.* The subscription must follow the key's actual source, and a path string does not identify it. By source fact 10, `updateComponents` can replace `orderId: { path: '/old/id' }` with `{ path: '/new/id' }` while the surface, the component ID and the data context stay the same. A subscription moved only when those three values change would stay on `/old/id`: a later change there would count as an item change and cancel an invocation whose own item had not changed, and an A, B, A on the new source would not be observed at all. The slot therefore keeps a `Watch` that records the signal it subscribed through, and a `reconcile` that compares signal identity with what the live raw component points at now. `reconcile` runs when setup first asks for the key, from the commit effect `sync`, and from the callback of the component's public resource subscription. By source fact 10 the processor stores every item of a message before the first resource notification of that message, so in the resource callback the live reader already sees the new binding. A notification from the retired signal is rejected twice: the `Watch` it came through is no longer current, and the signal callback checks that its own signal is still the live source before counting anything. Three intervals are covered, and one is not.

- *After the message, before the commit effect.* The reader reads the raw component, not the render, so the key it returns is the new one from the moment the processor stores the item. A tap on a render that showed the old key is refused by the live key comparison below, and the resource callback moves the subscription without waiting for the effect.
- *Inside the processor, between storing the item and notifying the resource.* By reading this is one synchronous call with no interleaved signal delivery. If a runtime delivered an old-source change there anyway, the callback would see that the live source has moved, reconcile once and count one item change from the old key to the new, not one per later old-source update.
- *Same key at another path.* The new signal's first value equals the last value seen, so the epoch does not move and the running invocation is not canceled.
- *Not covered: delivery order on a Lynx runtime.* Whether `Resource.subscribe` and `Signal.subscribe` callbacks run synchronously and in the order the Node check assumes is the same unverified mechanism as in the timing paragraph. If the resource callback is late, the live reads and the tap's live key comparison stay correct because they read the raw component. What waits for the commit effect is moving the subscription, and with it the count of an observed A, B, A on the new source.

*Admitting a tap.* A tap is a different question from a running invocation. A queued `bindtap` closure belongs to the render that created it, and also to the binding that was attached when that render was produced. Comparing only the item key would let a closure from before A, B, A pass against the newest state with obsolete props, and comparing only the mount would let a closure from before a dispose and rebind select the replacement definition. `activate` therefore checks, in order:

```ts
activate(token: TapToken): Activation {
  if (!installation || !installation.live || token.installation !== installation || !where) return 'stale';
  if (token.epoch !== this.epoch) return 'stale';                    // a change was observed since this render
  if (!bound || bound.internal.state.phase === 'disposed') return 'unbound';
  if (token.binding !== bound.internal) return 'stale';              // captured under another binding
  if (this.keyProp !== undefined && readLive(where, this.keyProp) !== token.shownKey) return 'stale';
  /* build the event; read() is valid only during this call */
  try { bound.internal.deliver(event); } finally { valid = false; }
  return 'delivered';
}
```

The installation check refuses a closure from a previous mount of the same slot. The epoch check refuses a closure from before any observed identity change, including A, B, A. The binding check refuses a closure captured under a binding that has since been disposed and replaced on the same mounted handle, even when the item and the mount are unchanged, by comparing direct references with no registry. The live key comparison does not depend on the subscription: it compares the key the render showed with the data now, so a tap on an old A is refused while the data says B even if no notification arrived. The token comes from `tapToken(snapshot, props)`, which reads only the published snapshot and the render's props, so it is intended to be pure and safe on both runtimes, and its purity is not yet pinned by a build check.

The admission policy for other inputs is *current data*. When a tap is admitted, `input` reads the occurrence's properties from the data model at that moment, not from the render that registered the handler, and copies what it needs before any asynchronous work. If the price shown was 5 and the data now says 6 with the same item key, the action receives 6. The alternative, admitting only a tap whose every captured input is still current, would refuse taps for harmless changes and would need every input captured at render. An application for which the shown value is part of the contract binds a revision into the key.

What each situation does, for a binding that supplies a subject reader:

| Condition | Result |
| --- | --- |
| Data changes to B while A's `onSuccess` is running, before any render or commit effect | The adapter's subscription or the runtime's next checkpoint finds B. `current()` is false, the success write is skipped, the invocation ends as `canceled(completing)` with cause `subject-changed`, and the binding stays installed. In the shared contract `current()` also becomes false when that particular callback's permission ends, for example by timeout, even if the binding and subject are unchanged. The common runtime owns that rule, and this adapter supplies only occurrence liveness and the subject reader |
| Array reorder `[A, B]` to `[B, A]`, instances keep their IDs | Each instance sees a different key, so each undecided invocation is canceled and the instance continues for its new item. A's pending state does not follow A to its new row |
| Same-position replacement of A with C | An undecided invocation is canceled with `subject-changed`, and the same binding serves C |
| Keyed `List` branch where A keeps its key and moves to a new path | The commit effect moves the subscription. If the new path holds A, there is no new change. In the interval the old path may show another item, which cancels conservatively |
| Old-A closure runs after A, B, A | Refused as stale by the epoch check, and a render after the change carries a fresh token |
| Old closure runs after its binding was disposed and another bound on the same handle, item unchanged | Refused as stale by the binding check, and a render after the rebind carries a token for the new binding |
| `orderId` changes from `/old/id` to `/new/id` by `updateComponents` | The resource callback moves the subscription to the new signal. If the shown key changed, the epoch steps once and an undecided invocation is canceled as `subject-changed`. Later changes at `/old/id` are ignored |
| Same replacement, but an old-source change arrives before the resource notifies | The signal callback finds the live source has moved, reconciles once and counts the item change once |
| A tap on a render from before a price change, same key | Admitted, and `input` reads the current price |
| Rows scroll out of view and back in a `<list>` | No change: the logical instance, its effects and its binding continue |
| Unmount | `close` retires the installation, stops the subscription and disposes the binding. Later closures are refused and later completions are dropped |

After a reorder, A's request may still be running on the server while row 0 shows B. Local cancellation does not prove the server stopped, so the application's server must tolerate a repeated request where that matters, or the application should hold reorders while an action is pending. Application state keyed by business item, such as a pending flag for order A shared across rows, is an ordinary application choice and is not a routing table. The binding's own pending state is not carried across rows, because the cancellation semantics belong to one occurrence.

## Reported renderer checks

These checks were run by other people earlier, against sources and configuration that are not part of this bundle. They are recorded as history, so a reader can see what kind of evidence stands behind the Lit, React and Lynx statements in the Blueprint. This companion makes no claim that a reader can reproduce them from what is here.

### Earlier Lit and React checks

An earlier independent review compiled the Lit occurrence host and element against the published Lit and `web_core` 0.13.0 packages with the workspace's own Zod and the common authoring types, using a configuration that extended the SDK repository's Lit `tsconfig`, which differs from the standalone command in A. An earlier author-run check compiled the same Lit and React sketches against 0.13.0 and against 0.14.0, and confirmed that `DataContext.surface` is optional in the 0.13.0 declarations, which is why the element's `#open` returns early without it. A Node probe against `@a2ui/web_core` 0.13.0, with no renderer, observed that `DataModel.subscribe` calls its listener synchronously inside `set`, that a descendant change and an ancestor replacement both notify a listener on `/rows/0` and an unrelated path does not, that a relative path read through a context scoped to `/rows/0` resolves against that path, that two separate `set` calls A to B to A were each observed, and that `DataModel.dispose` ended notifications. That is Node behavior of the package. It says nothing about when a Lit element's queued microtask runs relative to a click.

### Lynx checks

*Environment, as reported.* Node v26.7.0 and TypeScript 5.9.3, with `@lynx-js/genui` 0.7.0, `@lynx-js/react` 0.121.0, `@lynx-js/types` 4.3.0, `@types/node` 26.6.5, `@a2ui/web_core` 0.10.6 (installed through GenUI and hoisted) and 0.13.0 (installed under an alias). The lockfile is not part of this bundle, `skipLibCheck` was on, and the npm declarations were compared with the pinned commit by version number only.

The checks were run command by command against sources that are not part of this bundle, and an independent review reproduced digests of their source files but did not rerun the compiler or Node checks. The reported results were:

| Step | What it checks | Reported result |
| --- | --- | --- |
| 1 | Strict type-check of the stand-in contract, live reader, slot, control and admission store, without the application file | exit 0 |
| 2 | Type-check with `strictFunctionTypes` off, adding the application file | exit 0 |
| 3 | Strict type-check of the application file alone, where exactly one `TS2322` is expected at the `catalogs` array | 1 error, of type `TS2322`. The upstream `Button` and `Column` declare props narrower than `GenericComponentProps`, so `strictFunctionTypes` rejects them. It is not in the adapter code |
| 4 | Version comparison under default optional-property rules | exit 0 |
| 5 | Version comparison under `exactOptionalPropertyTypes`, where a failure naming `sendDataModel` is expected | 4 output lines name `sendDataModel` |
| 6 | Emit, then run the renderer-free checks | all checks passed |
| 7 | Ten mutation checks, each removing or weakening one guard | each mutation was reported as detected by the assertion block named for it: epoch admission, recheck on an observed change, `close()` disposal, the live key comparison at tap, binding identity at tap, watch signal identity, resource reconcile, the live-source check on a signal, abandoning a failed setup and the empty-path exclusion |
| 8 | The unmutated sources again | all checks passed |

Steps 3 and 5 expect a failing compiler result and were run with `|| true` and printed counts, so they would not have failed the run if the expected errors were absent. Those two rows are therefore reported observations of those commands and not assertions. Step 7 asserted: each mutation counted as detected only if the edit changed the file, the mutated source compiled, the check failed with an assertion error, and the failing block was the one named. The runner as a whole is not claimed to fail on every unexpected result. Two defensive guards had no mutation of their own, the rejection of a notification from a retired watch, which the Node check as written cannot reach, and the `attachment.retired` test in the subject reader. A passing mutation result shows that the named block depends on that guard and does not show that the guard is sufficient.

The Node run covered the slot, reader and admission logic with the real `SignalStore` class and `createResource` function from GenUI 0.7.0 and a stand-in runtime. Resource notification was simulated by calling `complete` on the surface's resource after storing the component, in the order the Blueprint's source fact 10 describes for the processor. The processor itself did not run. The control component was compiled but never rendered, so `useEffect`, `useSyncExternalStore`, `NodeRenderer`, `useChecks` and the effect order were not exercised. The signal and resource behavior is Node's. The stand-in runtime implements only the properties the adapter depends on, with simplified cleanup, no limits or timers, no hook budgets, no failure hooks and no full busy rule. It is not the shared runtime and shows nothing about it, including the rule that a callback's `current()` ends with its own permission. The strict-catalog variance limit and the `exactOptionalPropertyTypes` incompatibility between `web_core` 0.13.0 and 0.10.6 are type-level results, and declared versions do not prove package or commit equivalence.
