# Action binding: evidence companion

This companion belongs to the [action binding Blueprint](./action_binding.blueprint.md). It holds the complete type declarations that the Blueprint's examples are checked against, and a record of the renderer checks that other people ran earlier. The Blueprint is the review entry point and does not depend on this file for its design. Everything here is proposal-level and declaration-level evidence. None of it is a runtime, renderer or host result, and none of it approves or authorizes an implementation.

**Terminology and historical receipts.** The editorial update uses “rendered component instance” and renames the illustrative `Occurrence*` declarations to `Instance*`, including the scratch module `occurrence.ts` to `instance.ts`. The approval and earlier checks below remain records of the original revision; their hashes identify the original snippets, not these renamed snippets. No type contract or runtime behavior changes. The terminology check below records the current declarations separately.

**Terminology check.** After the rename, TypeScript 5.9.3 checked the current section A (`authoring.types.ts`, SHA-256 prefix `db268151d6eb67fa`) and section B (`renderer.types.ts`, `c3141ecc02fa9ae8`) using their printed commands: both exited 0 without diagnostics. Removing the directives still produced the intended 26 and 1 errors respectively. A comparison of every TypeScript block in the Blueprint and this companion against the pre-edit revision found only the terminology rename. The earlier renderer-package checks below were not rerun; their original compiler and package-version claims remain historical. This check establishes no runtime behavior.

**2026-10-19 amendment boundary.** The module now specifies optional overrides and SDK-instance defaults. Section A below and its checks remain historical evidence of the earlier explicit-limit design; specifically, N13–N15 and the `limits` gates are superseded for future implementation. They do not validate the amended builder surface or configuration resolution. Preserve these receipts; replace the relevant declaration and behavioral checks when implementing the amendment. No declarations or runtime were changed here.

**Status of this companion (cleanup baseline `2405c5d28f02a5b8d5fb70ed7a929e676cf78d43`).** This file is historical design-time evidence. Statements such as "proposal-level", "there is no runtime implementation" and "no framework was installed" describe the moment the checks ran. The action runtime has since been implemented in `packages/core/src/actions`, `packages/lit/src/actions` and `packages/react/src/actions`; the [Blueprint Status](./action_binding.blueprint.md#status) records which design revision each slice implements. The shipped exports are defined by those packages, not by the declarations here. Of the 114 type and function names declared in section A, 54 also appear by name under `packages/*/src` at the baseline and 60 do not, mostly example application functions and helper types. A name match is not a signature match, and this file was not re-checked against the shipped signatures. Compiler results, SHA-256 prefixes and package versions remain those of the original checks and were not rerun.

## Contents

- [A. Authoring declarations](#a-authoring-declarations): the declarations behind every authoring example, with the positive and negative type cases.
- [B. Renderer declarations](#b-renderer-declarations): the Lit and React instance declarations and the Lynx control declarations, with the printed examples compiled against A.
- [C. Printed renderer blocks](#c-printed-renderer-blocks): what was checked against the published Lit, React and `web_core` packages.
- [D. Lynx freshness and admission mechanism](#d-lynx-freshness-and-admission-mechanism): the code sketches and walkthrough behind the Lynx freshness summary.
- [Reported renderer checks](#reported-renderer-checks): earlier Lit, React and Lynx checks that were reported by their authors, kept as history.
- [E. Printed renderer proposals moved from the Blueprint](#e-printed-renderer-proposals-moved-from-the-blueprint): the long authoring, attachment, host and Lit, React and Lynx examples that the Blueprint now summarizes.

## A. Authoring declarations

The file below declares the proposed interfaces and the caller examples in [Interfaces and behavior](./action_binding.blueprint.md#interfaces-and-behavior). It contains twenty-six negative directives (N1 to N25, with N11 appearing twice), the positive checks P1 to P8, the recorded static limit L1, and positive examples for the playback lease with its result-discriminated failure hook, the later-appearing instance with a `subject` reader and owned teardown, two different definitions (archive and star) attached to one data-bearing control kind, and a supertype action bound to two component kinds. Every declaration uses `declare`. There is no runtime implementation, and no framework was installed.

**Historical receipt.** Before the terminology edit, the file, saved as `authoring.types.ts` (first 16 hex digits of its SHA-256: `64c1220b2b80a72d`), was checked with TypeScript 6.0.3 and TypeScript 5.9.3, the latter being the version reported for the SDK repository's installed toolchain. Each compiler used this command, with no project configuration and so without the SDK repository's `tsconfig`:

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

**Shape of the declarations.** `SurfaceView` declares only the general `getById` and `watchById` overloads. The overloads that return a `DataHandle` for a data-bearing kind are on `DataSurfaceView extends SurfaceView`, which repeats each general overload after its specialized one, and only the example's `view` is declared as `DataSurfaceView`. `DataHandle.readData` and `NoteActivation` are optional instance-data examples, and nothing is cast. The illustrative adapter seam `AdapterInstance` names its liveness reader `isLive`, calls its installation stamp `installationEpoch` so that it is not confused with a renderer's observed-key epoch, and declares the optional `watchScope` wake-up. The archive workflow is written once as `archiveNoteWith(noteIdOf)`, so that each renderer supplies only its own projection of the note identifier.

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
 * "may THIS callback still change what this instance shows". It is true only while all of these hold:
 *  - the runtime is still waiting for this callback. That eligibility ends permanently at the first of:
 *    a synchronous callback returning or throwing; the Promise returned by an asynchronous callback
 *    settling (merely returning a pending Promise does not end it); its budget expiring (the work
 *    deadline for a prerequisite or handler, `hookMs` for a hook); or cancellation, obsolescence, the
 *    deadline or the budget making the runtime stop waiting for it. A callback started later has its
 *    own eligibility;
 *  - the binding is not disposed and the invocation is not replaced;
 *  - the adapter reports that the instance and installation are the live ones;
 *  - the binding's subject reader, if one was given, still returns the value captured at activation.
 * Each call reads the adapter's liveness and the subject reader afresh. It is a cooperative check for
 * the moment before a synchronous commit; it cannot recall a write that has already started. The
 * adapter supplies instance liveness; the runtime owns callback eligibility.
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
 * to stop, and a non-aborted signal does not show the instance is still the right one: after any
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

/** What `bindAction` returns: one component instance's connection to one definition. */
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
 * through a view object captured by an earlier render, the semantic item the instance currently
 * shows (for a list row, a token that changes whenever the shown item changes). The runtime captures
 * it at activation and compares it with `Object.is` against a fresh read at every runtime decision
 * point and on each `current()` call. A reader that throws at activation ends the invocation as
 * 'invalid-input'; one that throws later counts as a change. Without `subject`, the invocation's
 * target is the instance alone.
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
  /** Throws when no instance, or more than one, has this id in the surface. */
  getById<Events>(id: string, kind: ComponentKind<Events>): ComponentHandle<Events>;
  /**
   * Setup-time discovery for instances that appear later or are recreated. Calls `onHandle` once per
   * instance with that instance's handle. Unsubscribing stops discovery only: it disposes no binding
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
// open can all attach to it. Its event carries data copied from the exact instance when the adapter
// admitted the event, and its handle can read what that same instance currently represents.
// Illustrative; each adapter supplies the real mechanism from its own data context.
export interface NoteData {
  readonly noteId: string;
}
/** `noteId` is copied from this instance at activation. It is undefined while the row has no note. */
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
 * Bound to one exact instance. `readData` reads that instance's current data through the renderer's
 * supported data context on every call, never a closure over props resolved by an earlier render, and
 * never an ID lookup. After the instance is retired it returns undefined instead of reading a
 * replacement instance.
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
//    The workflow is written once. Its only renderer-specific part is how the pressed instance's note
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

// The data-bearing example: the adapter copied `noteId` from the exact instance that fired.
export const archiveNote = archiveNoteWith(({ noteId }: NoteActivation) => requireNoteId(noteId));

// The subject reader asks THIS handle for the note its instance shows now.
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

// Instances that appear later. Discovery only delivers handles; the owning setup also keeps and ends
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

/** What an adapter gives the runtime for one instance. Illustrative. */
export interface AdapterInstance {
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

This file declares the proposed Lit and React instance types, the discovery view that supplies them, the instance host and its factory, and the Lynx control types. It then compiles the renderer examples printed in the Blueprint against A: `openReport`, the archive workflow with the Lit and React projection and with the Lynx projection, the two Lynx order actions with their different busy policies, and the Lynx setup that binds three instances of one control type. `InstanceView` extends the general `SurfaceView` and is the stronger view of the Lit and React registration. The Lynx declarations use neither `watchById` nor `InstanceView`. One `@ts-expect-error` shows that a general handle has no `read`, so the row example needs the stronger view.

**Historical receipt.** Before the terminology edit, saved as `renderer.types.ts` (first 16 hex digits of its SHA-256: `4f2b0ec1fe7b8492`) next to `authoring.types.ts`, which it imports unmodified. TypeScript 6.0.3 and 5.9.3 each ran this command, which is A's command with the file name changed. Running A's command as printed checks only `authoring.types.ts`.

```text
tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
    --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom \
    renderer.types.ts
```

Both compilers exited 0 with no diagnostics. With the one directive removed, each reported exactly one error, TS2339 on `read` for the general handle. The Lynx control and the Lit and React host have signatures only. No body runs.

**What this check cannot show.** The Lynx declarations say only that `itemKey` returns a reader, so the compiler cannot tell whether two calls on one instance are compatible. In the proposed Lynx slot an instance tracks one item key, `itemKey` starts that watch at once, and a second different key throws. The setup example below therefore calls `itemKey` only inside the branch that binds, and an unrecognized ID starts no watch. That follows from the proposed mechanism in [section D](#d-lynx-freshness-and-admission-mechanism). It is not something the declaration check establishes.

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

// ---- Lit and React: instance data and the stronger view ----------------------------------------
export interface InstanceEvent extends ComponentEvent {
  readonly dataPath: string; // '/' outside any template
  readonly native: Event;
  read(path: string): unknown; // this instance's data scope, now; answers only during delivery
}
export interface InstanceHandle<Events> extends ComponentHandle<Events> {
  readonly dataPath: string;
  read(path: string): unknown; // undefined once the instance is not live
}
export interface ActionButtonEvents {
  readonly activate: InstanceEvent;
}
export declare const ActionButton: ComponentKind<ActionButtonEvents>;

// The stronger view that the Lit and React registration supplies. It stays assignable to SurfaceView.
export interface InstanceView extends SurfaceView {
  getById<Events>(id: string, kind: ComponentKind<Events>): InstanceHandle<Events>;
  watchById<Events>(
    id: string,
    kind: ComponentKind<Events>,
    onHandle: (handle: InstanceHandle<Events>) => void,
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
export interface OpenInstance {
  activate(event: string, native: Event): 'started' | 'unbound' | 'retired';
  readonly retire: () => void;
}
export interface InstanceHost {
  register(setup: (view: InstanceView) => void): () => void;
  open(info: OpenInfo): OpenInstance;
  close(): void;
}
export declare function createInstanceHost(options: { onSetupError(error: unknown): void }): InstanceHost;

declare const instanceView: InstanceView;
declare const reportPanel: { open(): void };

export const openReport = Action.local<InstanceEvent>('open-report')
  .run(() => reportPanel.open())
  .build();

// The archive workflow from the authoring section, with this renderer's projection of the note identifier.
export const archiveNoteFromRow = archiveNoteWith((event: InstanceEvent) => requireNoteId(event.read('id')));

instanceView.watchById('open-report', ActionButton, (handle) => {
  handle.bindAction('activate', openReport);
});
instanceView.watchById('row-archive', ActionButton, (handle) => {
  handle.bindAction('activate', archiveNoteFromRow, { subject: () => handle.read('id') });
});

// An action written for the general view also works against the instance view.
export function attachGeneral(view: SurfaceView): void {
  view.watchById('open-report', ActionButton, (handle) => {
    handle.bindAction('activate', openReport);
  });
}
attachGeneral(instanceView);

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
export interface LynxInstanceHandle extends ComponentHandle<ControlEvents> {
  readonly sourceComponentId: string;
  read(prop: string): unknown; // live, background only
  itemKey(prop: string): () => unknown; // a subject reader, background only
}
export interface ActionControlOptions {
  readonly name: string;
  setup(handle: LynxInstanceHandle): void;
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
    // An instance tracks one item key, and `itemKey` starts that watch at once. Each branch therefore
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

Before the terminology edit, the Lit schema module and element, the React boundary, entry, provider and setup hook, and the React application sketch were extracted from the Blueprint text unchanged and compiled in a scratch project. Those blocks now live in section E of this file; the Blueprint text referred to here is that section. The recipe below uses the current illustrative names; the historical project used `occurrence.ts` and `Occurrence*` instead of `instance.ts` and `Instance*`. Its file layout is:

| File | Content |
| --- | --- |
| `authoring.types.ts` | Section A, unchanged |
| `instance.ts` | Section B (`renderer.types.ts`), standing in for the `./instance` module that the Lit and React blocks import |
| `action-button-schema.ts` | The Blueprint's schema block |
| `lit.ts` | The Blueprint's Lit element block |
| `react.tsx` | The Blueprint's React boundary, entry, provider and setup-hook block |
| `app.tsx` | The wrapper below, then the Blueprint's React application sketch unchanged |

The application sketch prints no imports and calls an application-supplied `reportSetupProblem`. The wrapper supplies the ordinary imports of `ActionDefinition`, `InstanceEvent`, `InstanceView`, `SurfaceModel`, `ReactCatalogComponent` and `A2uiSurface`, and declares `reportSetupProblem`:

```tsx
import { useCallback } from 'react';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import type { ReactCatalogComponent } from '@a2ui/react/v0_9';
import type { ActionDefinition } from './authoring.types';
import { ActionButton, type InstanceEvent, type InstanceView } from './instance';
import { InstanceHostProvider, useActionSetup } from './react';
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

The command, run from the project root, was `tsc -p tsconfig.json` with TypeScript 5.9.3. It ran twice, once in a project whose `@a2ui/lit`, `@a2ui/web_core` and `@a2ui/react` are all at 0.13.0 and once with all three at 0.14.0. Both projects also install `lit` 3.3.3, `react` and `react-dom` 19.3.1, `@types/react` 19.3.0 and `zod` 3.25.76. Copying only the Blueprint's excerpts does not reproduce the check: the renderer declarations as `instance.ts`, the wrapper and this configuration are all needed. Removing the wrapper's `reportSetupProblem` declaration makes the compiler report that it cannot find the name, so the wrapper is part of what was checked.

| Check | Result |
| --- | --- |
| Lit schema module and element, React boundary and entry, and React application sketch with the wrapper, 0.13.0 packages | exit 0, no diagnostics |
| The same files, 0.14.0 packages | exit 0, no diagnostics |

The Lit app-element amendment in the Blueprint is illustrative and was not compiled, because the SAGA session types are private. `skipLibCheck` was on, so the dependencies' own declaration files were not checked, only their use. These are author-run results, and the React results and the 0.14.0 results have no independent reproduction. They show that the printed code is well typed against the published declarations. They do not show lifecycle order, shadow-root structure, browser behavior or any runtime property of the Lit or React renderer, and the React runtime equivalence of 0.13.0 and the inspected 0.14.0 commit is unresolved.

## D. Lynx freshness and admission mechanism

This section holds the detail behind the Lynx freshness summary in the [Blueprint](./action_binding.blueprint.md#lynx-lynx-jsgenui-070): the code sketches for the live reader, the observed-key epoch, the source-following subscription and tap admission, the walkthrough of each interval, and the table of situations. It is a proposed mechanism with pinned source citations. It was compiled only in an earlier, reported form (see [Reported renderer checks](#reported-renderer-checks)), and the sketches below are excerpts, not the checked files. Source fact numbers refer to the numbered list in the Blueprint's Lynx section.

**Freshness: which item an instance shows.** A logical instance can present a different application item without remounting. After a reorder or a same-position replacement, the processor can produce the same `row:0` ID, the same `/orders/0` path and the same resource for item B that it produced for item A (source fact 8), and the `List` branches key by child ID, by `item.key` or by index, so an instance may also follow an item to a new path. A binding that depended only on surface, component ID and data path would leave A's pending invocation attached to a component now displaying B. That is a lifetime-correctness problem, not only a labeling one. Hiding a stale snapshot during render would be presentation and not cancellation, and it would not protect an application hook that completes before the commit effect has run. What the runtime does when it finds a changed key is the common [outcome rule](./action_binding.blueprint.md#outcome-decision-and-obsolescence): with a subject reader, an undecided invocation is canceled with `subject-changed` and the binding stays installed, and an already-decided outcome is kept. This subsection covers only what the adapter supplies. It has four parts.

| Question | Mechanism | Runs |
| --- | --- | --- |
| Is the running invocation still about the item the data model holds now? | The subject reader, a fresh read of the data model, called by the runtime at its checkpoints and by `current()` in hooks | Background |
| Can the adapter tell the runtime sooner than its next checkpoint? | A subscription to the key's signal that counts observed changes and calls `recheck()` | Background |
| Is this tap from a render that still matches the instance? | A token captured in render and compared in `activate` | Render (pure), then background |
| Does the subscription follow the key's actual source? | `reconcile`, run when the key is first tracked, from the commit effect `sync` (which records the committed data context path), and from the component resource's subscription. It compares signal identity, not a path string | Background |

*Where current state comes from.* The subject reader does not read the render's props, which can be one render old. It reads the authoritative state through public types: the raw component the surface holds now (`surface.components.get(id)`), its plain `{ path }` binding resolved against the instance's data context path, and the signal for that path in `surface.store`. This is the resolution the built-in resolver itself performs (source fact 3), and by source fact 7 the processor writes the signal store before it publishes component updates, so from the processor's effect onward a read sees the new item before any component re-renders. A literal value is read as itself. A binding that is a function call or any other shape, and an empty resolved path, is unreadable: the live reader returns `undefined`, and the change from a readable key to `undefined` counts as a change. Four limits apply, and each is a stated dependency and not a proven property.

- `absolutePath` copies the three-line rule of the renderer's `resolveBindingPath`, which is not exported. It is a version-sensitive copy, and a planned runtime case compares it with the resolved prop.
- `getSignal` creates an empty signal when the path is absent, so a read has the observable side effect of registering a path with no value, which the store tolerates by design.
- The data context path comes from the last committed render. A processor-expanded clone's map entry also carries its path, but a `List` template row's path exists only in the `List`'s own render, so the reader uses the committed path in every case to keep one rule. When an item moves to a new path, the reader reads the old path until `sync` runs, sees another item there and reports a change. That cancels conservatively, and `sync` then moves the subscription to the new path.
- Signals are documented as reactive on the background thread. The `@lynx-js/react-signals` README (version 0.0.6, a dependency of GenUI 0.7.0) says the ReactLynx build keeps them reactive on the background thread and uses static values in main-thread first-screen rendering. Every read and subscription here is background code. Whether `peek()` and `subscribe` behave as in Node on a Lynx background runtime is unverified.

*The subject reader and the observed-key epoch.* `handle.itemKey('orderId')` returns the reader the application passes as `subject`. It returns the key joined with an adapter-owned counter, `"<epoch>:<key>"`, or `undefined` when the instance is retired or the key is unreadable. A key alone cannot distinguish an A, B, A that nobody observed, because the two A keys are equal under `Object.is`. The adapter supplies the narrower thing it can: the observed-key epoch increases whenever its subscription to the key's signal observes a different value.

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

The signal subscription calls back with each distinct stored value, so an observed A, B, A produces two increments and changes the token even though both keys are `A`. A change that never became visible to the subscription, such as B set and reverted inside one batched update, is not a state anybody could have observed, and this narrower policy does not claim to detect it. An application that needs more joins a revision or version field into the key and binds that. The commit effect keeps no count of its own: the epoch moves only on a value a subscription delivers. When the effect or the resource moves the subscription to another signal, that signal's first value is compared with the last value seen, so the epoch steps only if the displayed key differs. A second counting source could cancel the invocation of the item that is now correctly displayed. This subscription is the adapter's own instance observation and may stay active while the binding is idle, because it maintains the tap-admission epoch. It is separate from the runtime's optional, invocation-owned wake-up, and an invocation settling must not erase its identity history. The runtime then compares as described under [the seam](./action_binding.blueprint.md#the-runtime-and-adapter-seam), after first revalidating the old invocation whenever a new tap meets a busy binding.

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

The admission policy for other inputs is *current data*. When a tap is admitted, `input` reads the instance's properties from the data model at that moment, not from the render that registered the handler, and copies what it needs before any asynchronous work. If the price shown was 5 and the data now says 6 with the same item key, the action receives 6. The alternative, admitting only a tap whose every captured input is still current, would refuse taps for harmless changes and would need every input captured at render. An application for which the shown value is part of the contract binds a revision into the key.

What each situation does, for a binding that supplies a subject reader:

| Condition | Result |
| --- | --- |
| Data changes to B while A's `onSuccess` is running, before any render or commit effect | The adapter's subscription or the runtime's next checkpoint finds B. `current()` is false, the success write is skipped, the invocation ends as `canceled(completing)` with cause `subject-changed`, and the binding stays installed. In the shared contract `current()` also becomes false when that particular callback's permission ends, for example by timeout, even if the binding and subject are unchanged. The common runtime owns that rule, and this adapter supplies only instance liveness and the subject reader |
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

After a reorder, A's request may still be running on the server while row 0 shows B. Local cancellation does not prove the server stopped, so the application's server must tolerate a repeated request where that matters, or the application should hold reorders while an action is pending. Application state keyed by business item, such as a pending flag for order A shared across rows, is an ordinary application choice and is not a routing table. The binding's own pending state is not carried across rows, because the cancellation semantics belong to one instance.

## Reported renderer checks

These checks were run by other people earlier, against sources and configuration that are not part of this bundle. They are recorded as history, so a reader can see what kind of evidence stands behind the Lit, React and Lynx statements in the Blueprint. This companion makes no claim that a reader can reproduce them from what is here.

### Earlier Lit and React checks

An earlier independent review compiled the Lit instance host and element against the published Lit and `web_core` 0.13.0 packages with the workspace's own Zod and the common authoring types, using a configuration that extended the SDK repository's Lit `tsconfig`, which differs from the standalone command in A. An earlier author-run check compiled the same Lit and React sketches against 0.13.0 and against 0.14.0, and confirmed that `DataContext.surface` is optional in the 0.13.0 declarations, which is why the element's `#open` returns early without it. A Node probe against `@a2ui/web_core` 0.13.0, with no renderer, observed that `DataModel.subscribe` calls its listener synchronously inside `set`, that a descendant change and an ancestor replacement both notify a listener on `/rows/0` and an unrelated path does not, that a relative path read through a context scoped to `/rows/0` resolves against that path, that two separate `set` calls A to B to A were each observed, and that `DataModel.dispose` ended notifications. That is Node behavior of the package. It says nothing about when a Lit element's queued microtask runs relative to a click.

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

## E. Printed renderer proposals moved from the Blueprint

This section holds, unchanged, the long examples and printed renderer code that the Blueprint contained before the readability pass: the authoring and attachment examples, the Lit/React instance host, and the Lit, React and Lynx proposals. The Blueprint keeps the reasoning and links here for the code. The text is the baseline text of `blueprints/modules/action_binding.blueprint.md` at `2405c5d28f02a5b8d5fb70ed7a929e676cf78d43`, lines named in each subsection; only links were retargeted so they resolve from this file. Section C describes how the printed blocks were checked; those blocks are the ones below. Nothing here is new design.

### E.1 Authoring examples

Baseline lines 124–253 (prerequisites, three actions, the archive server action) and 302–367 (attaching, discovering and disposing).

#### Declaring prerequisites

A prerequisite is reusable work that must finish before a handler runs, and it may stop the handler. It is not defined by what it shows on screen. SAGA supplies the way to declare one and to attach it to an action. The check itself is application code: whether it reads state, refreshes a token or asks the server is the application's decision. A client-side session check avoids pointless work, but it is not authorization, and SAGA does not require a session fetch before every action.

```ts
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
```

Only `proceed(...)` and `refuse(...)` are semantic: they are the two ways a prerequisite answers. The string passed to `prerequisite` is a diagnostic label that appears in failure records and logs and never selects behavior. The `prerequisite` function exists so the compiler can infer what the callback needs and provides, and a plain `{ label, run }` object is equally valid. A guard that adds no values calls `proceed()` with no argument, and the values provided earlier pass through it unchanged.

#### Three actions

A synchronous local action stays small. It needs no parameters, prerequisites, hooks, limits or telemetry.

```ts
// 1. Synchronous local action: no params, no prerequisites, no hooks, no limits.
export const toggleDetails = Action.local<ButtonActivation>('toggle-details')
  .run(() => detailsPanel.toggle())
  .build();
```

An asynchronous local action extracts a parameter at activation, requires the session, passes the invocation's abort signal to its work, and states its bounds. Its failure hook says only what the outcome establishes about the local effect, in three states. Where the handler never started, no save was attempted. Where it returned, the save completed and only the view work failed. In every other case the save may or may not have happened, because the handler threw or a deadline or cancellation decided before it settled, and the runtime cannot tell which. A message that says "not saved" would be false in the last two cases. The hooks here are synchronous and the runtime does not start them for an obsolete invocation, so no gap exists between the runtime's check and the presentation write for a freshness check to cover.

```ts
// 2. Asynchronous local action that reuses the session prerequisite.
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
```

A server action reuses the same session prerequisite, adds one that needs the session and the parameter, adds a guard that records audit intent, and sends its request through `call`. It attaches to a data-bearing control, a row or button that shows one note, and it is the workflow that the [representative flow](./action_binding.blueprint.md#representative-flow-archiving-a-note) follows on every renderer. Each renderer's event carries the note identifier differently, so the workflow is written once as a function of one projection, `noteIdOf`, which reads and validates the identifier from that renderer's event. The adapter copied the underlying value from the exact rendered instance when it admitted the event. Component ID alone cannot supply it, because a list can render one component ID twice with different data behind each instance (see [Identity](./action_binding.blueprint.md#identity-and-disposal-defaults)). The extractor validates the copied value as a nonempty string and keeps it, and a later asynchronous step never re-reads a position that may now show something else. The projection is the only renderer-specific part. Prerequisites, request, hooks, bounds and busy policy are the same for every renderer.

The success hook does required client work, a durable record, and then calls its own `current()` immediately before the synchronous presentation write. The failure hook reports only what the outcome establishes. Where the handler never started, no archive request was sent. Where it returned, the server effect is complete. Otherwise the effect is unknown and the message must not invite a retry.

```ts
function requireNoteId(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new Error('this row shows no note');
  return value;
}

// 3. Server action: the same prerequisite, a second one that needs it, a guard that provides nothing,
//    and a handler that initiates the request. The server's own handler is not referenced from here.
//    Only `noteIdOf` depends on the renderer's event shape.
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

// The data-bearing example below: the adapter copied `noteId` from the exact instance that fired.
export const archiveNote = archiveNoteWith(({ noteId }: NoteActivation) => requireNoteId(noteId));
```

`parseArchived` throws `ArchiveReplyUnreadable` when the reply cannot be read. That lands in the last branch on purpose: the server answered, but the client cannot say what the answer was. The runtime decides which branch a failure takes from `stage` and `failure.kind`, which are facts it knows. Whether the server really did nothing after `isError` is a fact about this example's tool, not a promise of MCP. Two pieces are diagnostics and not semantics: the `observe` call, and the labels passed to `Action.local`, `Action.server` and `prerequisite`. The necessary pieces are the ordered `before` calls, `run`, `limits` when an asynchronous hook or a server call needs a bound, and the hooks the application chooses to write.

#### Attaching, discovering and disposing

Attachment obtains a handle for one rendered instance, once, at setup, and binds the definition to one of its events. One definition gives independent bindings, each with its own state. Disposing a binding does not retire its handle: the same live handle takes a new attachment, so changing an action needs no remount and no new catalog type.

The common obligation on every renderer is exact instance identity, a typed `bindAction` on that instance's handle, and owned disposal. `getById` and `watchById` are the discovery facade that the authoring, Lit and React examples use. They are not required of every renderer: the Lynx adapter, for example, delivers the exact handle directly from its catalog component's setup. Likewise `readData`, used below, is an illustrative optional capability of a data-bearing handle, not a method every handle must have. Each adapter keeps the data reader its renderer supports, as the [renderer proposals](./action_binding.blueprint.md#renderer-proposals) describe.

```ts
// The subject reader asks THIS handle for the note its instance shows now.
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
```

`NoteRow` is a data-bearing control kind. One kind serves archive, star, open or any other action with a compatible event. Its event type carries the data its adapter copied from the instance that fired, and a handle for it can read what that same instance represents right now through `readData()`. Neither is a property of the generic `ComponentHandle`, which declares only `id` and `bindAction`. The companion therefore declares `DataSurfaceView`, an illustrative view that extends the general `SurfaceView` with `getById` and `watchById` overloads returning the stronger `DataHandle` for a data-bearing kind, and repeats each general overload after its specialized one. The example's `view` is declared as `DataSurfaceView`. A plain handle has no `readData` (N25), and nothing casts one into a data handle. An adapter that cannot supply the capability supplies an equivalent reader it owns: the Lit and React proposals declare a different stronger view, `InstanceView`, whose handles have `read(path)`, and the Lynx proposal hands its control's setup a handle with `read(prop)` and `itemKey(prop)` (see [Renderer proposals](./action_binding.blueprint.md#renderer-proposals)).

The star action omits `subject` because it is synchronous and has no gap in which the row could change. `archiveOn` passes one because the server call and the required hook leave a gap. Every example that holds a row across an asynchronous gap passes a subject whose reader is the exact handle's own data reader.

An instance that appears after setup, or is recreated, is discovered with `watchById`. Discovery delivers handles and nothing else: stopping it does not dispose the bindings its callback created. The example below therefore keeps what the callback creates and ends all of it from the owning setup's cleanup, including when the callback fails part way.

```ts
// Instances that appear later. Discovery only delivers handles; the owning setup also keeps and ends
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
```

### E.2 Instance data and the host (Lit and React)

Baseline lines 697–804.

The Lit and React proposals extend the generic event and handle with an `InstanceEvent` and an `InstanceHandle`, because a rendered instance has to supply data that the abstract contract leaves to the adapter. They also supply a stronger discovery view, `InstanceView`, that returns this handle. It is the view the Lit and React examples below use. It stays assignable to the general `SurfaceView`, so an action written for the general view still attaches through it, and it is not a requirement on Lynx.

```ts
export interface InstanceEvent extends ComponentEvent {   // the event an ActionButton delivers
  readonly dataPath: string;           // '/' outside any template
  readonly native: Event;
  read(path: string): unknown;         // this instance's data scope, now; answers only during delivery
}
export interface InstanceHandle<Events> extends ComponentHandle<Events> {
  readonly dataPath: string;
  read(path: string): unknown;         // undefined once the instance is not live
}
export interface ActionButtonEvents { readonly activate: InstanceEvent }
export declare const ActionButton: ComponentKind<ActionButtonEvents>;   // the catalog entry's directly imported token

export interface InstanceView extends SurfaceView {
  getById<Events>(id: string, kind: ComponentKind<Events>): InstanceHandle<Events>;
  watchById<Events>(
    id: string, kind: ComponentKind<Events>, onHandle: (handle: InstanceHandle<Events>) => void,
  ): () => void;
}
```

`ActionButton` is the component-kind token for the catalog entry proposed below. A fixed control needs no subject. In the examples that follow, `view` is an `InstanceView`.

```ts
export const openReport = Action.local<InstanceEvent>('open-report')
  .run(() => reportPanel.open())
  .build();

view.watchById('open-report', ActionButton, (handle) => {
  handle.bindAction('activate', openReport);
});
```

A row control copies the item's identity into the parameters when the user presses it, and supplies a `subject` so the runtime can tell when the position starts showing another item. The archive workflow from [Authoring](./action_binding.blueprint.md#authoring) attaches with this renderer's projection of the note identifier. The projection validates the copied identifier as a nonempty string, so an absent value fails at extraction and never becomes the text `"undefined"`.

```ts
// The authoring workflow with the Lit/React projection: the pressed row's `id`, read through its data scope.
export const archiveNoteFromRow = archiveNoteWith((event: InstanceEvent) => requireNoteId(event.read('id')));

view.watchById('row-archive', ActionButton, (handle) => {
  handle.bindAction('activate', archiveNoteFromRow, { subject: () => handle.read('id') });
});
```

`input` reads the pressed item from the event and copies the identifier, so a later `await` cannot turn the captured list position back into whichever item occupies it now. `handle.read('id')` is a pull through the instance's own data scope. It returns `undefined` once the instance has retired, which differs from any captured key, so a retired position also reads as a subject change. Omitting `subject` on a control inside a template forfeits all of this: the invocation targets the instance itself, and an invocation started for item A keeps running, and keeps presenting, after the position shows item B. That is right for a fixed control and wrong for a row. Whether an adapter should warn in development when a scoped handle binds without one is a development-experience option and not a condition of this design. Business identity comes from the data the application reads, never from the component ID.

The host that publishes handles has three members. `register` runs the application's setup against a view owned by that one registration, `open` is called by a renderer element for each instance, and `close` is terminal. `createBinding` is declared here only as the seam to the shared runtime; its body is the runtime's.

```ts
export interface BindingSeam {                       // what the runtime asks of an adapter for one binding
  readonly isLive: () => boolean;
  readonly subject?: () => unknown;
  readonly watchScope?: (revalidate: () => void) => () => void;
  readonly detach: () => void;
}
export declare function createBinding<Event>(
  definition: ActionDefinition<Event>, seam: BindingSeam,
): { readonly binding: ActionBinding; readonly activate: (event: Event) => void };  // activate is the common deliver entry

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
export interface OpenInstance {
  activate(event: string, native: Event): 'started' | 'unbound' | 'retired';
  readonly retire: () => void;
}
export interface InstanceHost {
  register(setup: (view: InstanceView) => void): () => void;
  open(info: OpenInfo): OpenInstance;
  close(): void;
}
export declare function createInstanceHost(options: { onSetupError(error: unknown): void }): InstanceHost;
```

`createBinding` is the Lit and React name for the runtime entry that the [seam table](./action_binding.blueprint.md#the-runtime-and-adapter-seam) calls `deliver`. The slot that holds the installed callable stores an installation token, and `detach` compares it before deleting, so a late disposal of an old binding cannot remove a newer one.

**How setup is owned.** `watchById` is discovery only. Stopping it stops deliveries of handles and disposes no binding, so the bindings and state subscriptions created during setup still need an owner, and the adapters give them one without adding a second public watch operation. `register(setup)` is internal to the adapters. It runs the application's setup function with a view that belongs to this one registration and returns a function that ends the registration. A registration records the discovery subscriptions its `watchById` calls made and every binding made through the handles it delivered, and ending it stops all of that discovery and disposes all of those bindings. The instance also retires its own bindings when its lifetime ends, so each binding has two paths to disposal, and both are idempotent.

Two failure rules follow. If the setup function throws, the registration ends and the error propagates to the caller, so nothing is left half attached. If one `watchById` callback throws, the registration disposes only the bindings that callback made, reports the error to the host's required `onSetupError` sink, and leaves every other binding, including one a different callback made on the same instance, in place. After `close()`, the host is terminal: `open` returns an instance that is already retired and `register` runs nothing.

#### Same-position replacement and work in flight

Lit and React both keep one instance per structural position. Lit's `bindsSameComponent` compares the component model, data model and data path ([`a2ui-lit-element.js` lines 285–298](https://unpkg.com/@a2ui/web_core@0.13.0/src/universal/a2ui-lit-element.js)), and the React resolver reuses a node when its component ID, data path, repeat ordinal (upstream `occurrence`), type and model identity match ([`node-resolver.ts` lines 475–510](https://github.com/a2ui-project/a2ui/blob/45633b97636daf89bafb43fa7db23e3cd916461d/typescript/core/web_core/src/resolution/node-resolver.ts#L475-L510)). Neither compares the business item stored at the path. When a list changes so that position 0 shows item B where it showed item A, the instance, the element or node, the binding and the installed callable all survive.

Two kinds of staleness follow. An *activation* reads current data: the event the adapter builds carries `read`, which evaluates against the instance's data scope at that moment, and the extractor copies what it needs. The DOM click listener calls `activate` synchronously, so no event waits in a queue holding values from an earlier render. A *continuation* is different: an invocation that started on item A is still running when the position shows B. It holds A's copied parameters, which stay correct for the work it was asked to do. What it must not do is act as though it still belongs to the position, and the common contract expresses that as the subject check.

1. The application replaces row 0's data. `DataModel.subscribe` calls its listener synchronously inside `set` (observed in a Node probe of `@a2ui/web_core` 0.13.0), and the adapter's listener queues a microtask that calls `revalidate`.
2. A microtask runs when the call stack that made the change empties, which is before the browser takes up the next input task, so a press should not arrive between the data change and the check (a Lit lifecycle test is the intended check). At that checkpoint the runtime reads `subject()` and applies the [outcome rule](./action_binding.blueprint.md#outcome-decision-and-obsolescence). With a subject reader and an undecided invocation, finding B where it captured A cancels the invocation with `subject-changed`, and the binding stays installed. If failure was already decided and `onFailure` is running, the outcome stays `failed` and that hook's presentation becomes obsolete. A binding without a subject reader sees no change.
3. While a canceled invocation's `onCanceled`, resource releases and `onFinally` run, each within `hookMs`, its cleanup is the only thing pending. The callable stays installed.
4. Presentation hooks (`onSuccess`, `onFailure`) do not start for the obsolete invocation. Work that must happen anyway belongs in `onCanceled`, a release or `onFinally`, and the application's own record that row A is being archived is keyed by the copied note identifier, not by position.
5. A press on B follows the definition's busy policy after the runtime revalidates the old invocation. Under `ignore` it is dropped while A's cleanup is still pending, and accepted once A has settled. Under `replace` it starts a new invocation at once, beside A's remaining cleanup. A control that should look idle for B while A's cleanup finishes derives its state from application data keyed by item, not from `binding.state`.

The wake-up covers a `subject` reader that depends on data under the instance's own scope, the row's item path or an ancestor such as `/rows`, because `DataModel.subscribe` notifies for the subscribed path and for its ancestors and descendants. A reader that depends on something else, such as application state outside the data model, gets no wake-up. For that reader the check happens at the next runtime checkpoint, the next `current()` call and the busy decision, and a spinner driven by `binding.state` can keep showing until one of those runs. The adapter promises nothing sooner, because `resolveDynamicValue` evaluates once and creates no subscription.

*A, then B, then A again.* A queued revalidation reads the value at the moment its checkpoint runs. Two `set` calls in one call stack, B and then A, each notify, but the two queued microtasks both read A, so neither finds a mismatch and the invocation continues. When a checkpoint does read B, the invocation is canceled at that moment, and a later return to A cannot revive it. A single `set` that moves the position from A directly to a new object with A's key is not an identity change. A round trip between checkpoints needs an application generation in the subject, as the seam section describes, and these adapters add no version counter of their own.

*Detaching with work in flight.* `dispose()` is the shared operation. It cancels an undecided invocation with cause `disposed` and leaves a decided outcome as it is, detaches the callable, and leaves other bindings of the same definition untouched, and a new `bindAction` for the same event on the same live handle then succeeds.

### E.3 Lit (`@a2ui/lit` and `@a2ui/web_core` 0.13.0)

Baseline lines 806–1071.

**What 0.13.0 provides.** All paths are in the published packages at [`unpkg.com/@a2ui/lit@0.13.0/`](https://unpkg.com/@a2ui/lit@0.13.0/) and [`unpkg.com/@a2ui/web_core@0.13.0/`](https://unpkg.com/@a2ui/web_core@0.13.0/).

- A catalog entry is a tag and a constructor: `WebComponentImplementation` extends `ComponentApi` with `tagName` and `element`, and SAGA's `LitComponentApi` entries have this shape.
- `a2ui-surface` renders through `ComponentContext`, not through nodes. Its `render` builds `new ComponentContext(this.surface, 'root', '/')` and calls `renderA2uiNode` (`src/surface/a2ui-surface.js`, lines 156–166), and nothing in that file creates a `NodeResolver`. On this default path `A2uiLitElement.node` stays undefined for every element under `a2ui-surface`. A custom descendant can supply a node, so the absence belongs to the default path and not to the element class. The 0.14.0 file contains the same constructor call, and its other behavior was not inspected.
- Parents rebuild the context on every render. `renderNode` calls `new ComponentContext(...)` each time when `node` is absent, and the `a2uiElement` directive keeps one custom element per child position and recreates it only when the tag name changes. On each render it assigns `element.node` and `element.context` synchronously, while the element's own `willUpdate` runs later. One element can therefore show a different component later, and its `context` object changes even when nothing observable has.
- Upstream already decides when a binding changed. `willUpdate` keeps the existing `A2uiController` when the private `bindsSameComponent` check passes, and otherwise disposes it and calls `createController()`, which is documented as overridable and is the supported seam. An override learns that the element now shows a different component or data path without copying the private comparison. Inside the override the public `controller` getter is `undefined` on the first bind, and on a replacement it still refers to the disposed old controller, so the element below never reads `controller` there.
- A component update with the same type and catalog keeps the model: `applyComponentUpdate` assigns `existing.properties`, and replaces the model through `removeComponent` then `addComponent` when type or catalog changes.
- Removal and disposal are observable synchronously. `removeComponent` deletes the entry, disposes the component, then emits `onDeleted`, and `SurfaceModel.dispose` disposes the data model and then the components model. After either, `surface.componentsModel.get(id)` no longer returns the captured model, visible at once to any later microtask. Emission is different: `EventEmitter.emit` awaits listeners one after another, so a listener other than the first runs at least a microtask later, and SAGA cannot choose its place in that order. `deleteSurface` disposes the surface before it emits `onSurfaceDeleted`.
- Data can be read once or subscribed. `DataContext.resolveDynamicValue` "evaluates the value once at the current moment without creating reactive subscriptions", `DataContext.dataModel` is public, and `DataModel.subscribe(path, onChange)` notifies for the path and its ancestors and descendants. `DataContext.surface` is optional in the declarations.
- The basic `Button` owns its click: its `@click` returns early when disabled and otherwise calls `props.action?.()`. A `functionCall` action resolves locally and an `event` action reaches `surface.dispatchAction`, which emits on `onAction`. `ButtonApi` requires `action` and `child`, with no `.optional()`.
- The play control is a different case. `saga-play-control` is a hand-authored `LitElement` that [`playback-main.ts`](https://github.com/MachineWisdomAI/saga-a2ui/blob/bcccb730489a0c5207899a755c5a8238b7f8c4f0/apps/lit-host/src/playback-main.ts) finds with `document.querySelector` and listens to directly. That is direct attachment, but the element is not rendered by A2UI, so it does not show that an A2UI-rendered component can be reached the same way. This section's design covers that second case.

**ID-only authoring and the catalog schema.** The layout of an attachable control names its ID and type and carries no behavior:

```json
{ "id": "open-report", "component": "ActionButton", "child": "open-report-label" },
{ "id": "open-report-label", "component": "Text", "text": "Open report" }
```

The basic `Button` cannot take this layout, because its schema requires `action`. A placeholder such as `{ "event": { "name": "open-report" } }` would invent exactly the handler name the design forbids, and it would make the upstream closure dispatch a server event from a control the application meant to handle locally. The proposal is an application-owned catalog entry whose schema has no `action`. The landed Lit package already gives the application the catalog (`new Catalog<LitComponentApi>(id, 'v0.9', [...])`) and `defineElements` for the tags. The entry's contract is renderer-neutral, and its Lit element is an optional export of `@saga-a2ui/lit`, so an application that does not list it carries none of it.

**The schema.** The catalog schema has no `action` field, so an ID-only layout is complete. It depends on `@a2ui/web_core` and the SDK's Zod export and on no renderer, so it lives in its own module that the Lit element and the React entry both import.

```ts
// action-button-schema.ts
import { CommonSchemas } from '@a2ui/web_core/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';

export const ActionButtonApi = {
  name: 'ActionButton',
  schema: z
    .object({
      child: CommonSchemas.ComponentId,
      checks: z.array(CommonSchemas.CheckRule).optional(), // same field as ButtonApi; yields isValid
    })
    .strict(),
};
```

**The element.** One element class serves every instance of this kind.

```ts
import { A2uiLitElement, type LitComponentApi } from '@a2ui/lit/v0_9';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import { html, nothing } from 'lit';
import { ActionButtonApi } from './action-button-schema';
import { ActionButton, type InstanceHost, type OpenInstance } from './instance';

/** Set by the app element while it presents one surface, and removed when that presentation ends. */
export interface MountOwner {
  readonly host: InstanceHost;
  readonly surface: SurfaceModel<any>;
  readonly mount: () => Element | undefined; // the one <a2ui-surface> the app element rendered
}
export const mountOwners = new WeakMap<Element, MountOwner>();

// Finds the host from the DOM position, not from the surface object. The walk crosses shadow roots
// outward. It accepts the element only when the nearest <a2ui-surface> above it is the owner's mount.
function hostOf(element: Element, surface: SurfaceModel<any>): InstanceHost | undefined {
  let nearestSurfaceElement: Element | undefined;
  let root = element.getRootNode();
  while (root instanceof ShadowRoot) {
    const host = root.host;
    if (host.localName === 'a2ui-surface') nearestSurfaceElement ??= host;
    const owner = mountOwners.get(host);
    if (owner) {
      const sameMount = nearestSurfaceElement !== undefined && nearestSurfaceElement === owner.mount();
      return owner.surface === surface && sameMount ? owner.host : undefined;
    }
    root = host.getRootNode();
  }
  return undefined;
}

export class ActionButtonElement extends A2uiLitElement<typeof ActionButtonApi> {
  protected readonly api = ActionButtonApi;
  #instance: OpenInstance | undefined;

  // Upstream calls this on first bind and whenever the element comes to show a different
  // component or data path. It does not call it when a parent merely re-renders.
  protected override createController() {
    this.#retire();
    const controller = super.createController();
    this.#open();
    return controller;
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.controller) this.#open(); // reconnect: upstream keeps the controller
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#retire();
  }

  #open() {
    if (this.#instance) return;
    const context = this.context;
    const { surface, path, dataModel } = context.dataContext;
    if (!surface) return; // DataContext.surface is optional in the 0.13.0 types: stay unbound
    const host = hostOf(this, surface);
    if (!host) return; // not presented by a SAGA app element: stay unbound
    const model = context.componentModel;
    // A fresh pull, never a stored answer. Each line closes a different window: the element left
    // the document; the model was removed, replaced or its surface disposed; a parent already gave
    // this element another component's context before its willUpdate has run.
    const isLive = () =>
      this.isConnected &&
      surface.componentsModel.get(model.id) === model &&
      this.context.componentModel === model &&
      this.context.dataContext.path === path;
    this.#instance = host.open({
      kind: ActionButton,
      componentType: model.type,
      componentId: model.id,
      dataPath: path,
      events: ['activate'],
      isLive,
      // This instance's own scope, not this.context, which a same-tag reuse may already have replaced.
      read: (dataPath) => (isLive() ? context.dataContext.resolveDynamicValue<unknown>({ path: dataPath }) : undefined),
      // Optional wake-up for the runtime while an invocation is not idle; delivered in a microtask.
      watchScope: (revalidate) => {
        const subscription = dataModel.subscribe<unknown>(path, () => queueMicrotask(revalidate));
        return () => subscription.unsubscribe();
      },
    });
  }

  #retire() {
    this.#instance?.retire();
    this.#instance = undefined;
  }

  protected override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    return html`<button type="button" ?disabled=${props.isValid === false} @click=${this.#onClick}>
      ${props.child ? this.renderNode(props.child) : nothing}
    </button>`;
  }

  #onClick = (event: Event) => {
    if (this.controller?.props?.isValid === false) return; // same check the basic Button makes
    this.#instance?.activate('activate', event);
  };
}

export const actionButtonEntry = {
  ...ActionButtonApi,
  tagName: 'saga-action-button',
  element: ActionButtonElement,
} satisfies LitComponentApi;
```

The upstream names in this block are `A2uiLitElement`, `createController`, `controller`, `context.componentModel`, `context.dataContext` (`surface`, `path`, `dataModel`, `resolveDynamicValue`), `componentsModel.get` and `renderNode`, and in the schema module `CommonSchemas`. The instance host, the `ActionButton` token and `OpenInstance` are proposed. The schema module and this block, exactly as printed, type-check against the published `@a2ui/lit` and `@a2ui/web_core` 0.13.0 packages and, separately, against 0.14.0, with the proposed declarations from [Instance data and the host](#e2-instance-data-and-the-host-lit-and-react) and the evidence companion's [renderer declarations](#b-renderer-declarations). That says nothing about lifecycle order, accessibility or browser behavior.

An alternative that reuses more upstream code is a subclass of `A2uiBasicButtonElement` registered under an entry without `action`, with its public `controller` getter overridden to return props that carry the callable. The basic Button's markup, styles and `isValid` handling would carry over. Two things argue against it. The override has to substitute a wrapper for a typed controller, which is an interop assertion that needs an explanatory comment. And an unbound press would be indistinguishable from a bound one, because the render path is not SAGA's. The recommended path costs about twenty lines of markup that mirror the basic Button's disabled rule. Which duplication to accept is a design choice for review. Either path covers only catalog entries that SAGA or the application writes.

**Event ownership and existing upstream actions.** `ActionButton` has no upstream `action` property, so its single click handler is the only activation site and there is no second effect to suppress. Application code must not add its own `click` listener to a rendered button as a shortcut. For a basic `Button`, upstream's own listener would run as well and the press would dispatch twice. Upstream `event` and `functionCall` actions on components that do not open an instance are untouched, and their closures still dispatch through `onAction` and `resolveDynamicValue` exactly as before. A catalog entry that keeps an upstream `action` beside the attach point must keep one owner per press: its one click handler starts the bound invocation when a binding exists and otherwise calls `props.action?.()`, never both, and a conformance test for such an entry counts effects.

**Instance lifetime in Lit.** The instance belongs to an element together with the component model and data path it currently shows. It does not belong to the element alone, because the directive reuses elements, and it does not belong to the `context` object, because parents replace that on every render.

- *Initial mount.* `createController` opens the instance during the first update, and the host delivers it to any `watchById` callback registered earlier. Calling `getById` right after the initial input is ingested fails, because rendering happens later, so `watchById` is the supported path.
- *Parent re-render.* The context object changes but `bindsSameComponent` holds, so `createController` does not run and the handle stays the same.
- *Same ID, same type, new properties.* The component model survives, so the instance and its bindings survive.
- *Same ID, new type or catalog.* The model is replaced. If the tag differs, the directive makes a new element and the old one disconnects. If the tag is the same, the element is reused: the directive assigns the new context at once, so `isLive` turns false at that moment, and `createController` retires the old instance and opens the new one at the next update. Either way the application's `watchById` callback fires for the new instance and binds again. A binding follows the instance it was made on, never the ID.
- *Data-path change.* The path is part of upstream's same-component test, so a new path means a new instance.
- *Data-context change at the same position.* The instance persists and `isLive` stays true. The subject check is the only protection for work in flight.
- *Template instances.* Each rendered item has its own element and its own `dataPath`, such as `/rows/0`, so `getById` fails when more than one row is rendered. The application attaches to every row in `watchById` and supplies `subject`. When the list shrinks, the removed elements disconnect and their instances retire. A reorder keeps instances on positions while the data moves, and the subject check cancels work whose item moved.
- *Ambiguous IDs.* Two identical references with the same ID and path under one parent have indistinguishable contexts at 0.13.0. They produce two handles, `getById` fails, and the only way to tell them apart is connection order, so the layout should avoid the duplication.
- *Disconnect and reconnect.* Disconnect retires the instance and disposes its bindings. A reconnect with the controller still in place opens a new instance, and the application's callback fires again. Moving an element in the DOM therefore cancels an in-flight invocation. Deferring retirement past a possible immediate reconnect would add machinery that cannot be justified without a measured case.
- *Node mode on a custom path.* If a custom descendant supplies `element.node`, the controller check is not sufficient: a sibling reorder gives a replaced node with a new unique `id` but the same model and path, so `bindsSameComponent` can still pass and `createController` would not run. A node-aware element would also override `willUpdate` and reopen the instance when `changedProperties.has('node')` and the node object differs. For retirement it would use `node.addCleanup`, which `dispose()` runs synchronously, and not `onDestroyed`, because `dispose()` emits and then disposes the emitter while `emit` awaits each listener in turn, so a second `onDestroyed` subscriber can be skipped. `addCleanup` has no unregister and does not run a callback added after disposal, so the element must check `node.disposed` before opening and keep the callback idempotent. The default `a2ui-surface` path never reaches this branch.

**Host ownership and discovery.** `createA2uiAppElement` in [`app-element.ts`](https://github.com/MachineWisdomAI/saga-a2ui/blob/c3eecaad89fcefc540ee7816a8b41731cb65e9d0/packages/lit/src/a2ui/app-element.ts) already owns the session, the one surface it presents, and their disposal: surface deletion clears `this.surface` and keeps the session, and disconnection unsubscribes the listeners and disposes the session. Attachment adds no second owner of either. It adds one optional dependency and one host per presented surface, which the app element creates and closes.

```ts
// Proposed amendment to packages/lit/src/a2ui/app-element.ts. Illustrative; not compiled.
interface A2uiAppDependencies {
  /* existing members */
  readonly actions?: {
    readonly attach: (view: InstanceView) => void;
    readonly onSetupError: (error: unknown) => void;   // a later watch callback failed
  };
}

// inside the A2uiApp class
#host?: InstanceHost;
readonly #mount = createRef<HTMLElement>();            // from 'lit/directives/ref.js'

#present(surface: SurfaceModel<LitComponentApi>) {
  this.#closeHost();                                   // a second createSurface for this id replaces the first
  const actions = deps.actions;
  if (actions) {
    const host = createInstanceHost({ onSetupError: actions.onSetupError });
    this.#host = host;
    mountOwners.set(this, { host, surface, mount: () => this.#mount.value });
    try {
      host.register(actions.attach);                   // close() ends the registration; the return value is unused
    } catch {
      this.#closeHost();
      this.failure = 'The actions for this content could not be attached.';
      return;
    }
  }
  this.surface = surface;                              // Lit renders it later, so every watch is already registered
}

#closeHost() {
  this.#host?.close();
  this.#host = undefined;
  mountOwners.delete(this);
}

// onSurfaceCreated:  if (surface.id === deps.surfaceId) this.#present(surface);
// onSurfaceDeleted:  if (id === deps.surfaceId) { this.#closeHost(); this.surface = undefined; }
// disconnectedCallback: unsubscribe the listeners, this.#closeHost(), then this.session?.dispose()
// render():          html`<a2ui-surface ${ref(this.#mount)} .surface=${this.surface}></a2ui-surface>`
```

*When the host exists.* It is created in the existing `onSurfaceCreated` listener for the matching surface, registered under the app element in a weak map, given its setup, and only then is `this.surface` assigned. Lit schedules the update that renders the surface asynchronously after that assignment, so every `watchById` is registered before any element opens an instance. If the setup function throws, the host closes, the surface is not assigned, and the existing `failure` state renders the existing fallback.

*When it ends.* Three exits call `close()`, which is terminal: it ends every registration, retires every instance and clears the host's discovery. On `onSurfaceDeleted` for the matching surface, upstream has already disposed the surface, so `surface.componentsModel.get(id)` returns no model and every `isLive` is already false. The session survives surface deletion, so a later `createSurface` with the same ID produces a new `SurfaceModel`, a new host and a fresh call to `attach`, which must therefore be safe to run once per surface instance. On `disconnectedCallback`, the listeners are unsubscribed first, so `onSurfaceDeleted` will not run for the session's own disposal, and the app element closes its host before it calls `session.dispose()`. The third exit is a setup failure, as above.

*Why a retained entry cannot reopen anything.* The weak map is keyed by the app element, and its entry is deleted when the host closes. A retired element that reconnects finds no entry and stays unbound. If the app element has meanwhile presented a different surface, the entry exists but names the new surface, and `hostOf` compares it with the surface the element still holds, so the old element is refused there as well.

*Which mount owns an element.* Looking up a host by `SurfaceModel` would be wrong, because two `<a2ui-surface .surface=${S}>` mounts for the same model share that key and both would publish into one scope. `hostOf` therefore starts from the element's position in the DOM. It walks outward through shadow roots, remembers the nearest `<a2ui-surface>` it passes, stops at the first element that has an entry in the weak map, and accepts only when that nearest surface element is the owner's own `#mount` and the owner's surface is the one the element holds. A raw second `<a2ui-surface>` for the same model, outside any app element or added by a subclass's chrome inside one, fails the comparison, and its `ActionButton` descendants stay unbound. Two app elements never share a host, because each creates its own session and surface on connect. An `ActionButton` placed in light DOM or slotted content is unsupported, because the walk does not pass through the owner's shadow tree and the element stays unbound. The walk relies on the app element and the surface rendering into shadow roots, which the app-element source shows, and a runtime test must confirm the chain through nested catalog elements. Because `defineElements` throws `ElementConflictError` for a tag bound to a different constructor, `ActionButtonElement` must not close over a per-session host: it finds its host through its position in the DOM.

An element mounted where it finds no host renders but cannot be bound, and a press does nothing. Under `actions.attach` the host exists before the surface renders, so a control that stays unbound is a missing `watchById`, not a timing artifact. Whether an unbound control should render disabled is a presentation decision.

**Application composition.**

```ts
// Real: createA2uiAppElement, defineElements, Catalog, LitComponentApi. Proposed: actions, ActionButton.
// `openReport` and `archiveNoteFromRow` are the definitions shown earlier.
export const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', [actionButtonEntry /* , Text, ... */]);

export function registerElements(): void {
  defineElements([actionButtonEntry /* , the application's other elements */]);
}

export const ReportApp = createA2uiAppElement({
  createSession,          // the application's existing session construction
  initialInput,
  surfaceId: 'report',
  actions: {
    attach: (view) => {
      view.watchById('open-report', ActionButton, (handle) => {
        handle.bindAction('activate', openReport);
      });
      view.watchById('row-archive', ActionButton, (handle) => {
        handle.bindAction('activate', archiveNoteFromRow, { subject: () => handle.read('id') });
      });
    },
    onSetupError: reportSetupProblem,
  },
});
```

The same callback binds every instance of `open-report`, one binding each. `openReport` is a single reusable definition, and each binding keeps its own state and cancellation. The `attach` function receives the `InstanceView` that the registration supplies.

**Running work and freshness in Lit.** Checking `isLive` only when a press arrives would leave a running continuation unprotected between model removal and the later Lit update or disconnect. Two mechanisms cover it, and they differ in kind. The signal is a push: it aborts when the binding is disposed, which happens when the element disconnects, when `createController` retires the instance, or when `close()` runs. All of those happen at or after the next Lit update, or at the surface-deleted notification, so there is a gap in which the signal says nothing. `isLive()` is a pull that re-reads the facts the instance depends on: the component model still registered under the ID, the element's present context, the connection, and the host being open. It is correct from the moment `removeComponent` deletes the map entry or `SurfaceModel.dispose` clears the model, which is before any notification and before any update. The runtime's `current()` includes it, and the runtime's checkpoints read it, so an already-running continuation finds the transition at its next checkpoint or at its next `current()` call before a synchronous presentation write. Nothing here suppresses an arbitrary asynchronous callback that does not check. `componentsModel.onDeleted` could give a push for a removed component, but its emitter orders listeners the same way, so it would not replace the pull.

### E.4 React (`@a2ui/react`, source at commit `45633b97636daf89bafb43fa7db23e3cd916461d`)

Baseline lines 1072–1257.

**What the inspected source provides.** Paths are under [`typescript/renderers/react/src/`](https://github.com/a2ui-project/a2ui/tree/45633b97636daf89bafb43fa7db23e3cd916461d/typescript/renderers/react/src) at that commit unless noted.

- A catalog entry can supply a node-aware `view`. `ReactComponentImplementation` has `render` and an optional `view: React.FC<NodeViewProps>`, where `NodeViewProps = { node: ComponentNode<ReactCatalogComponent>; buildChild }`. The root and `v0_9` barrels export `A2uiSurface`, `createComponentImplementation`, `NodeViewProps`, `ReactA2uiComponentProps` and `ReactComponentImplementation`.
- The factory fixes the props type. `createComponentImplementation<Api>(api, RenderComponent)` takes a `RenderComponent` over `ReactA2uiComponentProps<ResolveA2uiProps<...>>` (`adapter.tsx`, lines 38–44). A schema with the single field `child: CommonSchemas.ComponentId` resolves `child` to a string token, and the view passes the token to `buildChild` unchanged (`node-view.tsx`, lines 123–158).
- The surface resolves nodes and renders the `view`. `NodeContent` returns `<View node={node} buildChild={buildChild} />` when the implementation has a `view`, and `buildChild` renders a child as `<ChildElement key={child.id} node={child} />`, so a replaced node, which gets a new `id`, is a different React key and remounts. The root `ChildElement` in `A2uiSurface.tsx` has no such key.
- Resolvers are created only for committed renders, and disposal disposes nodes. `A2uiSurface` constructs its `NodeResolver` inside the `subscribe` function it passes to `useSyncExternalStore`. Its source comment says this keeps a discarded render from constructing one, and that StrictMode's double mount creates and disposes two in turn. The unsubscribe calls `resolver.dispose()`, which calls `disposeNode` for every record, recursively, ending with `node.dispose()`. Replacing a node also disposes the old one first (`node-resolver.ts`, line 508).
- Node disposal is synchronous and its cleanup API is minimal. `ComponentNode.dispose()` sets `disposed`, runs every `addCleanup` callback synchronously, catching and logging each error, then emits and disposes `onDestroyed`. `addCleanup(cleanup: () => void): void` returns nothing to unregister with, and a callback added after disposal is not invoked.
- Reuse ignores the business item. The resolver returns an existing node when its `componentId`, `dataPath`, repeat ordinal (upstream `occurrence`), type and model identity match.
- The factory-built view hides the node. The generated `view` calls `useNodeView(node, buildChild)` and passes the presentational component only converted props, `buildChild` and `context`.
- React context crosses host elements: the file comment in `node-view.tsx` says the React tree "nests like the DOM, so context, error boundaries and events pass from a component to the components it renders".
- Both `@a2ui/react` 0.13.0 and 0.14.0 exist on npm and both `/v0_9` type entries re-export `NodeViewProps`, `ReactComponentImplementation`, `createComponentImplementation` and `A2uiSurface`. 0.13.0 depends on `@a2ui/web_core` `^0.13.0`, matching SAGA's pin. The behavior above was read at the 0.14.0 commit, and whether the published 0.13.0 bundle's `NodeContent` and resolver match was not inspected.

**Wrapper and handle recipe.** The recipe uses only exported React-renderer API and the shared schema module, and no Lit code. It wraps the entry that `createComponentImplementation` already builds with a boundary that knows the node, and the presentational view calls `activate` through context. The boundary owns one instance for one committed `(host, node)` pair.

```tsx
import {
  createComponentImplementation, type NodeViewProps, type ReactComponentImplementation,
} from '@a2ui/react/v0_9';
import type { ComponentNode } from '@a2ui/web_core/v0_9';
import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode,
} from 'react';
import {
  ActionButton, createInstanceHost, type InstanceHost, type InstanceView, type OpenInstance,
} from './instance';
import { ActionButtonApi } from './action-button-schema'; // the renderer-neutral schema, without `action`

export const InstanceHostContext = createContext<InstanceHost | undefined>(undefined);

/**
 * Owns one host for the mounted subtree. The effect creates the host and its cleanup closes it,
 * so Strict Mode's simulated unmount closes the first host and the second setup makes another.
 * Children render only once a live host exists.
 */
export function InstanceHostProvider(props: { onSetupError(error: unknown): void; children: ReactNode }) {
  const [host, setHost] = useState<InstanceHost>();
  const sink = useRef(props.onSetupError);
  useEffect(() => { sink.current = props.onSetupError; });
  useEffect(() => {
    const created = createInstanceHost({ onSetupError: (error) => sink.current(error) });
    setHost(created);
    return () => {
      created.close();
      setHost(undefined);
    };
  }, []);
  return host ? <InstanceHostContext.Provider value={host}>{props.children}</InstanceHostContext.Provider> : null;
}

/** Runs one setup per (host, setup) pair. The effect cleanup ends it: discovery and its bindings. */
export function useActionSetup(setup: (view: InstanceView) => void): void {
  const host = useContext(InstanceHostContext);
  useEffect(() => (host ? host.register(setup) : undefined), [host, setup]);
}

const ActivateContext = createContext<(native: Event) => 'started' | 'unbound' | 'retired'>(() => 'unbound');

interface Committed { open?: OpenInstance }

function InstanceBoundary({ node, children }: { node: ComponentNode; children: ReactNode }) {
  const host = useContext(InstanceHostContext);
  const committed = useRef<Committed | undefined>(undefined); // written only by the layout effect below

  // A layout effect runs during the commit, so the previous pair's cleanup and this pair's setup
  // happen together, before any passive effect and before a continuation can observe the change.
  useLayoutEffect(() => {
    // addCleanup does not call a callback added after disposal, so check first.
    if (!host || node.disposed || !node.context) return;
    const entry: Committed = {};
    committed.current = entry; // set before open(): a watch callback may bind during open()
    const isLive = () => !node.disposed && committed.current === entry;
    entry.open = host.open({
      kind: ActionButton,
      componentType: node.type,
      componentId: node.componentId,
      dataPath: node.dataPath,
      events: ['activate'],
      isLive,
      read: (path) => (isLive() ? node.context?.dataContext.resolveDynamicValue<unknown>({ path }) : undefined),
      watchScope: (revalidate) => {
        const dataContext = node.context?.dataContext;
        if (!dataContext) return () => {};
        const subscription = dataContext.dataModel.subscribe<unknown>(node.dataPath, () => queueMicrotask(revalidate));
        return () => subscription.unsubscribe();
      },
    });
    node.addCleanup(entry.open.retire); // synchronous when the resolver disposes this node
    return () => {
      if (committed.current === entry) committed.current = undefined;
      entry.open?.retire(); // idempotent: the addCleanup callback may have run first
    };
  }, [host, node]);

  const activate = useCallback(
    (native: Event) => committed.current?.open?.activate('activate', native) ?? 'unbound',
    [],
  );
  return <ActivateContext.Provider value={activate}>{children}</ActivateContext.Provider>;
}

export function withInstance(impl: ReactComponentImplementation): ReactComponentImplementation {
  const Inner = impl.view;
  if (!Inner) throw new Error('withInstance needs an entry with a generated view');
  const View = (props: NodeViewProps) => (
    <InstanceBoundary node={props.node}>
      <Inner {...props} />
    </InstanceBoundary>
  );
  return { ...impl, view: View };
}

// The inline view takes its props from the factory's parameter type:
// ResolveA2uiProps<...> has `child: string` and an optional `isValid`.
export const ActionButtonEntry = withInstance(
  createComponentImplementation(ActionButtonApi, ({ props, buildChild }) => {
    const activate = useContext(ActivateContext);
    return (
      <button type="button" disabled={props.isValid === false} onClick={(e) => activate(e.nativeEvent)}>
        {buildChild(props.child)}
      </button>
    );
  }),
);
```

The upstream names here are `createComponentImplementation`, `NodeViewProps`, `ReactComponentImplementation`, `ComponentNode` (`disposed`, `context`, `type`, `componentId`, `dataPath`, `addCleanup`) and `DataModel.subscribe`. The host, token, `OpenInstance` and `InstanceView` are proposed. The block and the application sketch below, as printed and together with the ordinary wrapper imports that the [evidence companion](#c-printed-renderer-blocks) lists (the application sketch alone has no imports), type-check against both the published `@a2ui/react` 0.13.0 and 0.14.0 packages, with the proposed declarations from [Instance data and the host](#e2-instance-data-and-the-host-lit-and-react) and the shared schema module shown in the Lit section. The React package does not import the Lit package. A consumer that renders an entry through `render` instead of `view` gets no boundary and an inert button.

*Commit-time ownership.* The boundary's layout effect is the only writer of the ref that says which instance is committed, and `isLive` reads that ref. The [`useLayoutEffect` reference](https://react.dev/reference/react/useLayoutEffect) documents that setup runs before the browser repaints, that the cleanup of the previous dependencies runs before the next setup, that cleanup runs on removal, and that Strict Mode in development adds one extra setup and cleanup. When a new host or node renders, the old pair's cleanup therefore retires its instance and disposes its bindings, and the new pair's setup opens another, in the same commit. That is earlier than a passive effect, which [React documents](https://react.dev/reference/react/useEffect) as possibly running after the browser has painted. Three consequences follow. A running invocation for the old pair sees `isLive()` false as soon as the commit finishes, because the ref no longer holds its entry, even though the node is still live and `!node.disposed` would have stayed true. A press can only reach the committed entry, since the click handler reads the ref at press time. And nothing is published from a render React discards or has not committed, because a render writes nothing: a continuation that resumes while a concurrent render is still pending sees the previous commit, which is what the screen still shows. The documentation supports the timing the recipe depends on. It does not show that the recipe, a host transition, a discarded render or the published packages behave this way, and those tests are pending.

*Why a ref and not state or context.* The presentational view needs the instance at press time, not at render time, so a ref read in the click handler avoids a second render and the stale-render case together. Setting the entry before `host.open` matters: a `watchById` callback runs inside `open` and binds immediately, and `isLive` must already be true for it.

*Retirement paths.* Retirement happens through the effect cleanup, through `node.addCleanup` (which runs synchronously when the resolver disposes the node, whichever of the two reaches the boundary first), and through the host's `close()`. `retire` is idempotent, so the order does not matter. The `addCleanup` registration cannot be removed, so it stays on the node and is harmless after the instance has already retired.

**Host and attachment ownership in React.** `InstanceHostProvider` creates the host inside an effect, closes it in the cleanup, and renders its children only once a live host exists. Strict Mode's simulated unmount closes the first host and its second setup creates another, so the host that children use is always an open one, and any reference retained to the first can no longer open an instance or register a setup. Mounting the provider once per surface view, at the component that renders `A2uiSurface`, makes that component's unmount the explicit owner teardown. The cost is one extra render before the surface mounts.

```tsx
function ReportActions({ definition }: { definition: ActionDefinition<InstanceEvent> }) {
  const setup = useCallback(
    (view: InstanceView) => {
      view.watchById('open-report', ActionButton, (handle) => {
        handle.bindAction('activate', definition);
      });
    },
    [definition],
  );
  useActionSetup(setup);
  return null;
}

export function ReportPanel({ surface, definition }: { surface: SurfaceModel<ReactCatalogComponent>; definition: ActionDefinition<InstanceEvent> }) {
  return (
    <InstanceHostProvider onSetupError={reportSetupProblem}>
      <ReportActions definition={definition} />
      <A2uiSurface surface={surface} />
    </InstanceHostProvider>
  );
}
```

The setup function must keep a stable identity per distinct definition, here through `useCallback`, because the registration is keyed to it. A different identity ends the registration and starts another.

- *First attach.* React runs child effects before parent effects, and layout effects before passive ones. By the time the registration's `watchById` runs, instances have usually opened already, which is why `watchById` delivers present instances as well as future ones.
- *Definition A changes to B.* React runs the cleanup first. The registration ends, discovery stops, and every binding it made is disposed, so an undecided invocation for A is canceled with cause `disposed` (one whose failure is already decided keeps that outcome) and its slot is free. The new effect then registers a setup that binds every present instance with B. The duplicate-attach rule never fires, and nothing was silently replaced. The cleanup and the next setup run within the same effect flush, so no input event separates them; if one did, the press would find an unbound instance and do nothing. An application that does not want A's in-flight work canceled by a change keeps the definition's identity stable and passes changing values through what `input` copies.
- *A stale cleanup cannot remove a newer binding.* `detach` compares the slot's installation token with its own, and a registration disposes only the bindings it recorded.
- *Strict Mode.* The provider's effect runs, is cleaned up, and runs again. The setup effect does the same: the first run's bindings are disposed by the cleanup and the second run binds afresh. The setup function does nothing except register discovery and bind, so running twice is harmless.
- *Setup refusal.* Two registrations binding the same instance and event make the second `bindAction` throw inside its callback. The registration disposes the bindings that callback made, reports to `onSetupError`, and leaves the first binding untouched.

**A function component is not the instance.** React does not give application code an object for a function component. It has no stable `this`, and React can re-run it, discard a render before commit, or mount a second copy. A `ref` passed to a function component reaches only what that component chooses to expose, a host element or an imperative handle published with `useImperativeHandle`. A ref could therefore carry a handle, but nothing in the upstream view path publishes one, a view can render zero, one or several elements, and a handle created during render would belong to a render React may discard. The instance is defined instead by the committed lifetime of the boundary for one `ComponentNode`, which is what the layout effect's setup and cleanup delimit. The element a user presses is whichever one the presentational component wires to `activate`.

**Lifetime under React rules.**

- *Discarded render.* The boundary opens an instance only in an effect, so a render React throws away opens nothing and no `watchById` callback fires for it. This follows `A2uiSurface`'s own rule for its resolver.
- *Initial mount.* If the layout effect runs within the commit, as the recipe assumes, no press can land between the first commit and the opening of the instance. Before the provider has a host, the surface is not mounted at all.
- *Replacement.* A replaced node changes the `key`, so the old boundary unmounts and its cleanup retires the old instance while the new node mounts and opens a new one. For the root node, which is not keyed, the boundary's `node` prop changes and the layout effect re-runs with cleanup first. In both cases the application's callback fires again. The resolver also disposes the replaced node before it creates the new one, which runs `addCleanup` as well.
- *Same ID, new node.* Upstream gives a replaced node a new `id`, including on sibling reorder. This is a new instance even if the `componentId` and `dataPath` are identical, and nothing carries over.
- *Template items.* `node.dataPath` distinguishes them, as `/rows/0` does in Lit. The resolver's reuse predicate omits the business item, so React has the same same-position behavior as Lit and the same subject rule. A keyed remount cannot retire an unchanged node whose data now represents another item, and the subject check is what protects an invocation there.
- *Data changes without node replacement.* The boundary and instance stay. The generated view re-renders with new props, and `read` evaluates against the node's current context.
- *Host or node transition with work in flight.* The commit-time ownership above covers it, and a planned test drives a pending invocation through it.
- *Unmount, surface swap and resolver disposal.* Effect cleanup retires the instance. When the `surface` prop changes or the surface unmounts, `A2uiSurface` disposes its resolver, which disposes its nodes and runs `addCleanup` callbacks synchronously. The instance is then retired and `isLive()` is false, whichever of that and React's cleanup reaches the boundary first.
- *Ambiguous IDs and two views.* Each `A2uiSurface` mount builds its own resolver and nodes, and a provider scopes one host to its subtree, so two views under separate providers have separate scopes. Two views under one provider are unsupported as a single scope: each node is its own instance with its own handle, `getById` fails for the repeated ID, and `watchById` delivers each one.
- *Disposal during a prerequisite or an async hook.* Both retirement paths dispose the bindings synchronously. A prerequisite is then canceled at stage `prerequisites`. A running `onSuccess` or `onFailure` has its signal aborted as obsolete, and its `current()` becomes false. If failure was already decided, the outcome stays `failed`, the obsolete `onFailure` stops presenting, and `onCanceled` does not run. Cancellation before a terminal decision follows the common contract. Releases and finalization still run, including a configured `onFinally`. Whether a hook that ignores its signal stops is outside any adapter's control.

**The version decision.** SAGA pins Lit and core at 0.13.0. The React source inspected is the commit that moves React, Lit and core from 0.13.0 to 0.14.0. The published `@a2ui/react` 0.13.0 exposes the same type names and depends on the pinned core, and the boundary and entry above type-check against it. What is not known is whether 0.13.0's published runtime renders the `view` and reuses nodes as the inspected commit does. The choice is between running the recipe against `@a2ui/react` 0.13.0, which keeps one A2UI version across renderers in an application that uses both, and adopting 0.14.0 for React or for all three, which is a dependency change outside this Blueprint. Running the React lifecycle tests against the published 0.13.0 package decides it. If its behavior differs from the inspected commit, the commit-based claims here need correcting before any implementation work cites them. This Blueprint changes no dependency.

### E.5 Lynx (`@lynx-js/genui` 0.7.0)

Baseline lines 1258–1532.

The renderer examined is `@lynx-js/genui` 0.7.0 at lynx-stack commit [`bb2f9ba`](https://github.com/lynx-family/lynx-stack/commit/bb2f9ba92c8fe936be39b882047ab94aae58809f), A2UI subpath. `@saga-a2ui/lynx` is a planned package that does not exist, and the Lit extraction at `c3eecaa` shows only that an application can supply its own catalog to a renderer package, not a per-instance attachment. This section says where each part attaches in a ReactLynx tree, what the adapter must add, and what the Lynx threading model changes. Design and source feasibility, SDK implementation, runtime behavior, Web packaging and host acceptance are separate claims, and this section supports only the first. No host is claimed to support Lynx.

**Identities.**

| Term | Meaning here | Example |
| --- | --- | --- |
| Component ID | The A2UI identifier in the message stream | `submit-order` |
| Instance | One rendered use of a component ID, qualified by surface and data context | `row:2` on surface `s1`, data context `/orders/2` |
| Logical component lifetime | One mounted ReactLynx component instance and its hook state | One call of the catalog component, from mount to unmount |
| Physical node lifetime | The native UI element that displays it | A list cell that is created, hidden and reused for other items |
| Installation | One open-to-close run of the adapter's slot inside a logical instance | The span between the mount effect and its cleanup |

A binding belongs to a logical component instance. It does not belong to the component ID, because a template renders one ID many times, and it does not belong to the physical node, because `<list>` reuses nodes. The lifecycle page states that a `<list>` creates all its child component JS instances together while UI elements are created or reused as it scrolls, that `useEffect` and ordinary `ref` callbacks run even when the UI node does not exist or is in the reuse pool, and that `main-thread:ref` and its cleanup follow the physical element's visible and reused state. The binding therefore survives scrolling. When the instance presents a different application item, the [outcome rule](./action_binding.blueprint.md#outcome-decision-and-obsolescence) applies through the subject reader, and the mounted binding stays installed for the item now shown.

**What the pinned renderer provides.** These are source facts at `bb2f9ba`. Where the text says "by reading", the conclusion is an inference that was not reproduced on a runtime.

1. *A custom catalog component is a function component.* `defineCatalog` accepts `ComponentType<GenericComponentProps>`, a paired `[component, manifest]`, or a `ResolvedCatalogEntry` with an explicit `name` ([`defineCatalog.ts` L102–193](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/catalog/defineCatalog.ts#L102-L193)). Registration chooses an implementation, not a business action.
2. *The barrels export what a custom control needs, and the processor class, but a custom control cannot reach the processor instance.* `Button`, `NodeRenderer`, `useChecks`, `resolveDynamicValue`, `createMessageStore`, `MessageProcessor` ([`index.ts` L19–21](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/index.ts#L19-L21); [`store/index.ts` L6](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/store/index.ts#L6)) and the types `GenericComponentProps`, `ComponentInstance`, `Surface`, `MessageStore`, `ServerToClientMessage`, `CheckLike` and `ResolvedCatalogEntry` are exported, and `SignalStore` comes from `@lynx-js/genui/a2ui/store`. `A2UIProvider`, `A2UIContext`, `useA2UIContext` and `useCatalog` are not exported. The all-in-one `<A2UI>` therefore keeps the `MessageProcessor` instance it owns, and a custom control cannot obtain it to call `resolveDynamicValue`, which needs one.
3. *A rendered component receives a `Surface`.* `GenericComponentProps` carries `surface` and the plumbing props `id`, `setValue`, `sendAction` and `dataContextPath` ([`A2UIRenderer.tsx` L103–120](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/react/A2UIRenderer.tsx#L103-L120)). `Surface.components` is a `Map<string, ComponentInstance>` of the raw stored components and `Surface.store` is a `SignalStore`, a path-keyed map of signals. The built-in resolver reads a plain `{ path }` binding exactly this way, as `surface.store.getSignal(path).value` ([`useDataBinding.ts` L188–191](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/react/useDataBinding.ts#L158-L202)).
4. *Props are resolved before the component renders, and resolution executes function calls anywhere in them, including `action`.* `NodeRenderer` calls `useResolvedProps` ([L278–284](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/react/A2UIRenderer.tsx#L278-L284)), which resolves the whole component instance once for the snapshot and again when it subscribes. A leaf with a `call` goes to `executeFunctionCall`, and `resolveDeepValue` has no exclusion for `action` ([`resolveFunctionCall.ts`](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/store/resolveFunctionCall.ts#L114-L143)). By reading, an `action.functionCall` can run before the catalog component receives props, and can run more than once. The function context also exposes the processor and a `set(path, value)` operation, so registered functions are arbitrary application code.
5. *The protocol callback cannot report completion.* The `sendAction` given to a component discards the returned promise (`void sendAction(...)`, [L118](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/react/A2UIRenderer.tsx#L118)) and ends in `processor.dispatch({ userAction })`. `<A2UI>`'s listener resolves `[]` at once and then calls `onAction` inside a `try/catch` that only logs ([`A2UI.tsx` L216–225](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/react/A2UI.tsx#L216-L225)).
6. *Protocol messages reach the processor through the `messageStore` prop, in an effect.* `MessageStore` is a public interface (`subscribe`, `getSnapshot`, `push`, `clear`). `<A2UI>` creates one processor per mount and processes `messages.slice(processedCount)` in a `useEffect`. The prop documentation says replacing the store does not reset the processor and recommends a `key` for a new session ([`A2UI.tsx` L38–48, L238–249](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/react/A2UI.tsx#L238-L249)).
7. *A data update writes the signal store before components are re-expanded.* For `updateDataModel` the processor calls `surface.store.updateBatch`, and only afterwards re-expands template containers and publishes component updates ([`MessageProcessor.ts` L386–467](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/store/MessageProcessor.ts#L386-L467)). From the processor's effect, the data model already shows the new item before any component re-renders.
8. *`updateComponents` stores each incoming item whole, and template clones are positional.* The stored instance is `{ ...item }`. `cloneComponentTree` JSON-copies the original, names the copy `${originalId}${suffix}` with suffix `:${index}` for arrays and `:${key}` for objects, sets its `dataContextPath` and reuses an existing resource for that ID, and a clone does not record its original's ID ([L155–175](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/store/MessageProcessor.ts#L155-L175)). The built-in `List` keys an explicit child array by child ID and a still-templated `children` object by `item.key` or else by index, rendering every row from the one original ID with a different `dataContextPath` ([`List/index.tsx` L57–107](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/catalog/List/index.tsx#L57-L107)). Which branch a message sequence reaches is not settled by reading.
9. *The built-in `Button` requires a protocol `action`.* `enabled = isValid && ok`, with `ok` from `useChecks`. The view gets `bindtap={enabled ? handleClick : undefined}`, and `handleClick` calls `sendAction(action)` only when `action` exists. `action` is a required member of `ButtonProps` ([`Button/index.tsx` L16–107](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/catalog/Button/index.tsx#L16-L107)). `useChecks` takes `CheckLike[] | undefined` and counts an unrecognized condition shape as passing, so checks gate the interface and authorize nothing.
10. *A component update can replace a property binding without changing the instance, and its resource is public.* For `updateComponents` the processor spreads the incoming item, keeps the existing `dataContextPath`, replaces `surface.components[id]` and keeps the resource already registered for that ID ([L304–345](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/store/MessageProcessor.ts#L304-L345)). `<A2UI>`'s update listener then calls `resource.complete(...)` for each updated ID ([`A2UI.tsx` L168–205](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/react/A2UI.tsx#L168-L205)), and by reading every `surface.components.set` of one message precedes the first resource notification of that message. `orderId: { path: '/old/id' }` can therefore become `{ path: '/new/id' }` with the same surface, component ID and data context. `Surface.resources` is a public `Map<string, Resource>`, and `Resource` has a public `subscribe(callback)` and `getSnapshot()` ([`Resource.ts` L35–51](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/store/Resource.ts#L35-L51)). The built-in resolver follows the raw component's current binding, and it does not read an empty resolved path: `if (path && surface?.store)` ([`useDataBinding.ts` L184–193](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/react/useDataBinding.ts#L184-L193)).

**What the adapter supplies.** The adapter adds no authoring surface. Applications use the common builder and `handle.bindAction(event, definition, options?)`. The adapter supplies four things the shared contract leaves to it. Its declarations are below. They are the Lynx counterpart of the Lit and React `InstanceEvent` and `InstanceHandle`, and the Lynx proposal uses neither `watchById` nor `InstanceView`.

```ts
export interface ControlActivation extends ComponentEvent {
  readonly surfaceId: string;
  readonly sourceComponentId: string;
  read(prop: string): unknown;                 // valid only while extraction runs; throws afterwards
}
export interface ControlEvents { readonly activate: ControlActivation }
export interface LynxInstanceHandle extends ComponentHandle<ControlEvents> {
  readonly sourceComponentId: string;
  read(prop: string): unknown;                 // live; background only
  itemKey(prop: string): () => unknown;        // a subject reader; background only
}
export interface ActionControlOptions {
  readonly name: string;
  setup(handle: LynxInstanceHandle): void;   // runs once per mounted instance, in the background
  onSetupError(error: unknown): void;
  readonly disableWhileBusy?: boolean;
}
export declare function createActionControl(options: ActionControlOptions): { readonly name: string; readonly component: unknown };
```

1. *The event.* `ControlActivation` carries the component IDs, the surface ID, and `read(prop)`, which returns the named property of the tapped instance as the data model holds it at the call. `read` is valid only while extraction runs, so a later asynchronous step cannot turn a captured position back into whatever item occupies it now. No DOM `Event` is involved.
2. *A handle per instance.* `LynxInstanceHandle` is the common `ComponentHandle<ControlEvents>` plus `sourceComponentId`, a live `read(prop)`, and `itemKey(prop)`, which returns a subject reader. All three extra members are background only.
3. *An observable snapshot for rendering.* `useSyncExternalStore` needs a reference-stable snapshot and a subscription. The slot publishes `{ installation, binding, state, keyProp, epoch }`, where `binding` is a direct reference to the exact attached binding (or undefined while the instance is unbound) that changes on every attachment and disposal, `state` is the common `binding.state` object itself, and `epoch` is the observed-key epoch defined under freshness. The slot's `installation` plays the role of the seam's installation epoch, and the observed-key epoch is a separate counter, so the two are never conflated. The adapter invents no result field; a control that shows an outcome does so from the definition's own hooks.
4. *The runtime entry.* The adapter calls the runtime's `deliver(event)` and `recheck()` from the [seam](./action_binding.blueprint.md#the-runtime-and-adapter-seam). The slot's own `activate(token)` is the adapter's admission step in front of `deliver`.

**One generic control, selected per instance at setup.** Markup names a layout and component IDs and carries no action. The adapter proposes one catalog component type, here `ActionButton`, that any number of instances use. Application setup code sees each mounted instance once, after commit, and binds an already constructed definition to it. This is the setup-time component lookup the accepted direction permits. After setup the control holds a direct reference to the binding, and a tap calls it. Nothing is looked up by name at activation. No component type per action is introduced. The agent sends no action for the bound buttons, and a protocol action for the unrelated `help` button.

```json
{ "updateComponents": { "surfaceId": "orders", "components": [
  { "id": "root", "component": "Column",
    "children": ["submit-order", "cancel-order", "row-archive", "help"] },
  { "id": "submit-order", "component": "ActionButton", "child": "submit-label",
    "orderId": { "path": "/order/id" } },
  { "id": "submit-label", "component": "Text", "text": "Submit" },
  { "id": "cancel-order", "component": "ActionButton", "child": "cancel-label",
    "orderId": { "path": "/order/id" } },
  { "id": "cancel-label", "component": "Text", "text": "Cancel order" },
  { "id": "row-archive", "component": "ActionButton", "child": "archive-label",
    "noteId": { "path": "/note/id" } },
  { "id": "archive-label", "component": "Text", "text": "Archive note" },
  { "id": "help", "component": "Button", "child": "help-label",
    "action": { "event": { "name": "open_help" } } },
  { "id": "help-label", "component": "Text", "text": "Help" }
] } }
```

This layout uses fixed controls, so the `row-archive` control reads one absolute path. A control repeated by a list template binds a relative path such as `{ "path": "id" }`, which each instance resolves against its own data context, as the [representative flow](./action_binding.blueprint.md#representative-flow-archiving-a-note) shows. Application code, abridged. Two fixed controls bind two different local definitions, and the third instance binds the archive workflow from [Authoring](./action_binding.blueprint.md#authoring) with this renderer's projection of the note identifier.

```tsx
const orderIdOf = (event: ControlActivation): string => {
  const value = event.read('orderId');
  if (typeof value !== 'string' || value === '') throw new Error('no order selected');
  return value;
};

// Built once, reusable, inert: no pending flag, timer or resource lives here.
export const submitOrder = Action.local<ControlActivation>('submit-order')
  .input((event) => ({ orderId: orderIdOf(event) }))        // copies the item id at the tap
  .run(({ params, signal }) => postOrder('submit', params.orderId, signal))
  .limits({ deadlineMs: 15_000, hookMs: 1_000 })
  .onSuccess(async ({ result, params, current }) => {
    await refreshOrderRow(params.orderId);                   // required work; may take time
    if (current()) showOrderStatus(params.orderId, result.status); // checked at the commit
  })
  .whenBusy('ignore')
  .build();

export const cancelOrder = Action.local<ControlActivation>('cancel-order')
  .input((event) => ({ orderId: orderIdOf(event) }))
  .run(({ params, signal }) => postOrder('cancel', params.orderId, signal))
  .limits({ deadlineMs: 15_000, hookMs: 1_000 })
  .whenBusy('replace')
  .build();

// The authoring workflow with the Lynx projection: the pressed control's `noteId` property.
export const archiveNoteFromControl = archiveNoteWith((event: ControlActivation) => requireNoteId(event.read('noteId')));

// Module scope: one stable component type for the life of the bundle.
export const actionButton = createActionControl({
  name: 'ActionButton',
  setup(handle) {
    'background only';
    // An instance tracks one item key, and `itemKey` starts that watch at once. Each branch therefore
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
        return; // nothing bound: the control stays unbound and refuses taps
    }
  },
  onSetupError: (error) => console.error('[saga] setup failed', error),
  // Each definition's own busy policy decides what a second tap does.
  disableWhileBusy: false,
});
```

All three instances use one component type and receive different definitions. `submitOrder` ignores a second tap while it runs, and `cancelOrder` replaces the running invocation. The control overrides neither policy. By default it disables the tap while the binding is not idle, which is presentation only, and this application sets `disableWhileBusy: false` so that each definition's own policy decides. The `switch` runs once at setup to choose which definition to attach, and a tap does not consult it. The `help` button keeps its protocol path. An instance that setup does not recognize, such as a later `refund-order`, binds nothing and refuses every tap. The item identifier is copied by `input` at the tap from the data model as it stands then, and the handler receives only `params`. The markup binds the data to a prop (`orderId`, `noteId`) and the application reads it from the event, so business identity is data the application controls and is never inferred from a component ID or data path.

The generic control, abridged. Its render path reads props and the published snapshot and writes nothing.

```tsx
export function createActionControl(options: ActionControlOptions): ActionControl {
  const { name, setup, onSetupError, disableWhileBusy = true } = options;

  function ActionControlView(props: GenericComponentProps) {
    // Inert: constructing the slot does no I/O and registers nothing.
    const [slot] = useState(() => new InstanceSlot(setup, onSetupError));
    const snap = useSyncExternalStore(slot.subscribe, slot.getSnapshot, slot.getSnapshot);
    const where: Where = { surface: props.surface, componentId: id, sourceComponentId, dataContextPath: props.dataContextPath };

    // Effects run on the background side after commit.
    useEffect(() => { slot.open(where); return () => slot.close(); }, [slot]);
    useEffect(() => { slot.sync(where); }, [slot, where.surface, where.componentId, where.dataContextPath]);

    const checked = useChecks({ checks: readChecks(props['checks']), componentId: id, surface: props.surface, dataContextPath: props.dataContextPath });
    const token = slot.tapToken(snap, props);            // pure: what this render showed
    const idle = snap.state !== undefined && (!disableWhileBusy || snap.state.phase === 'idle');
    const enabled = props['isValid'] !== false && checked.ok && idle && token !== undefined;
    const onTap = () => { if (token) slot.activate(token); };
    /* child lookup through the public NodeRenderer, as the built-in Column does */
    return (<><view bindtap={enabled ? onTap : undefined}>{/* child */}</view>{/* first failed check message */}</>);
  }
  ActionControlView.displayName = name;
  return { name, component: ActionControlView };
}
```

`isValid` and `checks` gate `bindtap` as `Button` gates its own: a failing check leaves `bindtap` undefined and shows the first failure message. The control copies the built-in `Column`'s child-context rule and uses no CSS class names, because an application-owned catalog owns its styling, so visual, accessibility and `variant` parity with `Button` is not established. Rendering `<Button>` with a placeholder `action` is possible but ties the control to `Button`'s required `action`. Nothing is bound on first commit: `bindtap` is undefined until the mount effect has run setup and published a snapshot with a bound `state`. A render that React never commits constructs only an inert slot object and registers nothing, because binding and subscription happen in effects.

The table states the behavior the design requires for instances of one type. Renderer-free Node checks exercised the slot's rows against a stand-in runtime, and nothing has run in ReactLynx.

| Step | What happens | Result |
| --- | --- | --- |
| First commit | Every `ActionButton` instance renders before any effect has run | All are unbound: `bindtap` is undefined |
| Effects | `open` runs setup. `submit-order` binds `submitOrder`, `cancel-order` binds `cancelOrder`, each with its own subject reader | Each snapshot carries an `idle` state and each bound button enables |
| Tap on submit | `slot.activate` delivers to the submit binding | Submit is `running` and cancel is `idle`. No protocol callback runs |
| Tap on `help` | The built-in `Button` calls its renderer-supplied `sendAction` | `onAction` receives the `open_help` payload once |
| Application disposes the submit binding | `binding.dispose()` cancels an undecided invocation with cause `disposed` | The slot drops the binding, the snapshot has no state, and taps refuse as unbound |
| Application binds again on the same handle | `handle.bindAction('activate', otherDefinition, …)` | A new binding on the same mounted instance, with no remount and no new component type. The snapshot now carries the new binding reference |
| A tap closure captured before the dispose is delivered | `slot.activate(oldToken)`, item and mount unchanged | During the unbound interval the delivery is refused as unbound. After the second binding is attached, the old token is refused as stale, because it holds the first binding |
| Setup binds, then throws | `open` disposes what that setup attached, drops its key watch, retires its handle, then reports the error | The instance is unbound and refuses taps. A later installation that binds validly is not affected |
| A second `bindAction` while one is live | Same call | Throws, naming the event |
| Agent replaces `cancel-order` with a `Text` | The component type at that ID changes, so React unmounts the control | `close` retires the installation and disposes the binding |

**Bound-control action policy before prop resolution.** A wrapper cannot enforce the policy, because source fact 4 runs first. If an agent message gives `submit-order` a protocol `action`, `NodeRenderer` resolves it before `ActionControlView` renders. A `functionCall` in that `action`, or in an event's `context`, executes during resolution, before the tap and before any SAGA prerequisite. Overwriting the prop, warning in development, or `suppressActionDispatch` (which only withholds the callable) cannot undo that. The proposed enforcement point is the message buffer. The adapter supplies the `MessageStore` that `<A2UI>` reads, and that store checks each message before appending it. By source fact 6 nothing else carries messages to the processor `<A2UI>` owns.

```ts
export function admit(message: ServerToClientMessage, boundControlNames: ReadonlySet<string>): Admission {
  if (!('updateComponents' in message) || !message.updateComponents) {
    return { kind: 'admitted', message };
  }
  const { surfaceId, components } = message.updateComponents;
  const annotated: ComponentInstance[] = [];
  for (const item of components as ComponentInstance[]) {
    if (!boundControlNames.has(item.component)) { annotated.push(item); continue; }
    if ('action' in item) {
      return { kind: 'rejected',
        rejection: { surfaceId, componentId: item.id ?? '', reason: 'action-on-bound-control' } };
    }
    annotated.push({ ...item, [SOURCE_ID_PROP]: item.id } as ComponentInstance);
  }
  return { kind: 'admitted', message: {
    ...message, updateComponents: { ...message.updateComponents, components: annotated },
  } as ServerToClientMessage };
}
```

`createAdmittingMessageStore({ controls, onRejected })` wraps `createMessageStore()`, applies `admit` to every pushed message and to `initialMessages`, reports each rejection, and appends the admitted messages in order.

- *What it guarantees.* For items whose `component` is a bound control's catalog name, an `action` key of either shape (`event` or `functionCall`) never reaches the processor. That closes the duplicate protocol path for the bound control. An unbound `Button` with its own `action` is untouched and keeps its protocol path. Source fact 8 puts the type on every item, so the check holds no state.
- *What it does not guarantee.* It does not make rendering free of application code. Other properties of the bound control (such as `orderId: { call: … }`), its `checks[].condition`, and any other component's properties can still contain function calls that `useResolvedProps` or `useChecks` execute, and registered functions are arbitrary code (source fact 4). Restricting those routes to pure expressions is a restriction on the application and its catalog functions, enforced by review or a separate validator and not by this adapter, and this Blueprint does not propose changing GenUI. The adapter's live reader does not execute function calls: it supports only literals and plain data bindings and returns `undefined` for anything else. That alone does not make a tap refuse. Refusal comes from the validating policy the examples show, where the projection throws for a missing or empty value and `itemKey` returns `undefined` for an unreadable key, and an application must keep that validation.
- *Rejection, not removal.* A message that puts `action` on a bound control is rejected whole and reported with the component ID. Dropping the field silently would hide a supplied action, and a partial message could leave a surface half built. Removing the field and continuing is the alternative, listed under the open decisions.
- *Source ID annotation.* The admitted copy carries `sagaSourceId`, set by the adapter over any value the agent sent. A plain string property set on the stored item survives on the inspected path: the processor stores a spread of the item, cloning JSON-copies it, recursive resolution returns a string unchanged, and `splitUnsupportedProps` removes only fields whose value is the unsupported sentinel ([`useDataBinding.ts` L125–150](https://github.com/lynx-family/lynx-stack/blob/bb2f9ba92c8fe936be39b882047ab94aae58809f/packages/genui/a2ui/src/react/useDataBinding.ts#L125-L150)). That is source reading for this version, and runtime confirmation is pending. Without the annotation, setup would see `row-archive:3` and would have to parse a suffix that is an upstream convention, not an interface.
- *Advertised schema.* The `ActionButton` manifest can omit `action` so agents are told not to send it, and admission enforces it. An application that builds its own renderer on the exported `MessageProcessor` bypasses `<A2UI>` and this guard.

**Event ownership.** A tap on an `ActionButton` runs only the control's own `bindtap`. The control never calls the `sendAction` it receives, so `useAction`, `processor.dispatch` and `onAction` are not reached, and admission has removed the bound control's own `action` route to them. That guarantee is narrow. It covers the event path of this control and does not remove every catalog function that markup could trigger through other properties or `checks`. One tap makes at most one `deliver`, so no backend effect of the bound action runs twice through the two event paths. `NodeRenderer` still calls `useAction` for every node, which creates the callback and dispatches nothing until something calls it. Unrelated components keep `sendAction`, and `<A2UI onAction={…}>` stays wired for them. Composing with the upstream path is not available as an awaited stage, because the renderer discards the promise behind its callback, so an invocation that must settle cannot use it. An application that calls a protocol channel from its own handler makes an ordinary best-effort call and owns the duplicate-effect risk. The handle provides no such channel.

**Freshness: which item an instance shows.** A logical instance can present a different application item without remounting. After a reorder or a same-position replacement, the processor can produce the same `row:0` ID, the same `/orders/0` path and the same resource for item B that it produced for item A (source fact 8), and the `List` branches key by child ID, by `item.key` or by index, so an instance may also follow an item to a new path. A binding that depended only on surface, component ID and data path would leave A's pending invocation attached to a component now displaying B. That is a lifetime-correctness problem, not only a labeling one, and hiding a stale snapshot during render would be presentation and not cancellation. What the runtime does when it finds a changed key is the common [outcome rule](./action_binding.blueprint.md#outcome-decision-and-obsolescence): with a subject reader, an undecided invocation is canceled with `subject-changed` and the binding stays installed, and an already-decided outcome is kept. The adapter supplies four things for it, and the [evidence companion](#d-lynx-freshness-and-admission-mechanism) holds the code sketches, the walkthrough of each interval and the full table of situations.

- **A live subject reader.** `handle.itemKey(prop)` reads the authoritative state through public types, not the render's props: the raw component the surface holds now (`surface.components.get(id)`), its plain `{ path }` binding resolved against the instance's data context path, and the signal for that path in `surface.store`. By source fact 7 the processor writes the signal store before it publishes component updates, so from the processor's effect onward a read sees the new item before any component re-renders. A literal is read as itself. A function-call binding, any other shape and an empty resolved path are unreadable: the reader returns `undefined`, and the change from a readable key to `undefined` counts as a change. The path-resolution rule is a version-sensitive copy of one the renderer does not export, `getSignal` registers an empty signal for an absent path, and the data context path is the last committed one, so after an item moves to a new path the reader reads the old path until `sync` runs and cancels conservatively. Signals are documented as reactive on the background thread, and whether `peek()` and `subscribe` behave as in Node on a Lynx background runtime is unverified.
- **An observed-key epoch.** The reader returns `"<epoch>:<key>"`. A key alone cannot tell an A, B, A that nobody observed, because the two A keys are equal under `Object.is`. The epoch increases whenever the adapter's subscription to the key's signal observes a different value, so an observed A, B, A produces two increments and changes the token, and each increment asks the runtime to `recheck()`. A change that never became visible to the subscription, such as B set and reverted inside one batched update, is not claimed to be detected, and an application that needs more joins a revision into the key. This subscription is the adapter's own instance observation. It may stay active while the binding is idle, because it maintains the tap-admission epoch, and it is separate from the runtime's invocation-owned wake-up. In the reported Node checks the subscription fires synchronously inside the update, so an invocation is canceled at the data change. Whether a Lynx background runtime delivers it synchronously, once per change and before React's re-render is unverified. If delivery is coalesced or late, the design degrades in a known direction: the runtime's reader still catches a changed key at its next checkpoint and `current()` still turns false, and only an unobserved return to the same key goes undetected.
- **A subscription that follows the key's actual source.** `updateComponents` can replace `orderId: { path: '/old/id' }` with `{ path: '/new/id' }` while the surface, component ID and data context stay the same (source fact 10). The slot therefore records the signal it subscribed through and `reconcile`s by signal identity, when setup first asks for the key, from the commit effect `sync`, and from the public component Resource's subscription. A notification from a retired signal is rejected, and the same key at another path does not move the epoch. Delivery order of the Resource and signal callbacks on a Lynx runtime is the same unverified mechanism as above. If the Resource callback is late, the live reads and the tap comparison stay correct, and only the count of an observed A, B, A on the new source waits for the commit effect.
- **Tap admission.** A queued `bindtap` closure belongs to the render that created it and to the binding attached then. `activate(token)` checks, in order, that the installation is live and is the one the token captured, that the observed-key epoch has not moved since that render, that a binding is attached (`unbound` otherwise), that the token's binding is the attached one by direct reference with no registry (`stale` otherwise), and that the live key still equals the key the render showed. A closure captured before a dispose is refused as unbound during the unbound interval and as stale once a second binding is attached. Other inputs follow the policy *current data*: `input` reads the instance's properties at the tap, copies what it needs, and a price that changed to 6 under the same key is delivered as 6. Whoever needs the shown value to be part of the contract binds a revision into the key. `tapToken` reads only the published snapshot and the render's props, so it is intended to be pure on both runtimes, and its purity is not pinned by a build check.

After a reorder, A's request may still be running on the server while row 0 shows B. Local cancellation does not prove the server stopped, so the application's server must tolerate a repeated request where that matters, or the application should hold reorders while an action is pending. The binding's own pending state is not carried across rows.

**Late completion and the unmount window.** A late handler result or error is dropped by the runtime and does not change the delivered outcome, and a late resource handed to the scope is released by the runtime. The adapter adds only that a retired binding no longer notifies the slot. One window is unresolved. Unmounting a component is detected by `close`, which runs in the effect cleanup. ReactLynx lifecycle hooks run asynchronously in the background, and the lifecycle page does not state when cleanup runs relative to the main thread removing the node. Between native removal and the cleanup, `installation.live` is still true and a hook's `current()` can still be true, so liveness is established after the adapter retires the instance, not at the instant the native node is removed.

A stale presentation write in that interval is not assumed harmless. A write to a native view the application still holds, or to state that is rendered elsewhere, could land on something that is gone or reused. Measuring the interval tells how large the window is on a device and does not prevent a write inside it. A stronger guarantee needs one of two things, and neither appears in the sources read. The first is a supported retirement seam: a signal that the logical instance has been removed, earlier than the effect cleanup. The sources name none for a logical component, and `main-thread:ref` cleanup follows the physical element, which scrolling reuses, so it is not a logical retirement signal. The second is a narrower support contract: the shared contract would state that a hook's presentation write must go to a target that tolerates a retired instance, for example application state keyed by the item identifier rather than a handle to a rendered view, and that `current()` is not a substitute for that tolerance. That narrower contract is the supported recommendation until a seam is found. Choosing between the two is a decision, and it needs no runtime run.

**Threads, prerequisites and gestures.** Where each piece runs:

| Piece | Runs in | Why |
| --- | --- | --- |
| Component body, `tapToken`, `useChecks`, child lookup | Both runtimes | The component body runs on the main and background threads. `tapToken` and the child lookup use only props and the published snapshot. `useChecks` reads the same inputs, but the pinned hook can execute application functions found in a check condition (source fact 4), so the component body is pure only if the application's check expressions are. That is the application restriction stated in the action-policy paragraph, not something the control enforces |
| `useEffect` bodies: `open`, `sync`, `close` | Background | Lifecycle hooks execute asynchronously in the background thread, and ReactLynx has no `useLayoutEffect` |
| `setup`, `handle.read`, `handle.itemKey`, `bindAction`, `reconcile`, the signal and resource subscriptions | Background | Side effects unrelated to rendering are background-only. `setup` carries the `'background only'` directive because it reaches the control as a function prop |
| `bindtap` handler, `activate`, `deliver`, `input` extraction | Background | The ordinary event callback runs on the background side. Extraction is synchronous in that call stack |
| Prerequisites, the handler, hooks, timers, network calls, the abort signal | Background | Synchronous ones need no boundary, and asynchronous ones are awaited work in the same runtime |
| Imperative element operations such as `setStyleProperty` | Main thread | Supported main-thread script work, not invocation work |

The documentation shows supported imperative main-thread operations and the sources do not say they are forbidden, so it is wrong to read all effects or data updates as forbidden on the main thread. The binding reference that appears in the snapshot and in the tap token is plausible as background-local identity, because the main-thread first-screen render starts unbound and later ordinary event work is background-side. That is a plausible mapping and not a pinned build proof, and the build-partition check listed under verification includes confirming that the snapshot's binding and token remain background-local.

A render-time selector and a live reader are different functions. `tapToken` is called during render, so it must be valid on both runtimes: it takes props and a snapshot and returns a plain object. The live reader and the signal subscription call `store`, signals and the `Surface` map, so they are background-only and are never called during render. They communicate through the published snapshot (`keyProp`, `epoch`) and the slot's fields, not through a shared function reference, because putting the `'background only'` directive on a function that render also calls would be a contradiction.

*Asynchronous prerequisites.* A prerequisite such as `requireSession` is ordinary awaited background work that finishes before the handler starts. The Lynx pages describe no DOM user-activation window, and nothing here depends on one. A prerequisite or hook that returns synchronously needs no artificial boundary.

*Event-turn phases and the optional main-thread bridge.* This control delivers a background `bindtap`, so both event-turn phases run in the background event call stack. A definition that needs a phase on the main thread cannot have it run by passing a background function by reference: no function reference crosses threads, and the adapter cannot move `atActivation` onto the main thread. The mechanism that would let `bindAction` reject a definition whose phase callback was written for another environment does not exist yet (see [Event-turn work](./action_binding.blueprint.md#event-turn-work)), and until it does this adapter cannot detect such a definition. Ordinary asynchronous background prerequisites do not depend on it. If an operation genuinely needs main-thread gesture work, the control could declare it in its own module as a separate `main-thread:bindtap` function carrying the `'main thread'` directive, which does synchronous element work only and then starts the invocation with `runOnBackground` over a background function that calls `slot.activate`. The sources identify no operation that needs this path, and the following sketch is illustrative and uncompiled.

```tsx
const startInvocation = runOnBackground(() => { void slot.activate(latestTokenRef.current); });
const onTapMainThread = (e: MainThread.ITouchEvent) => {
  'main thread';
  // synchronous element work only; capture JSON-serializable values only
  void startInvocation();
};
<view main-thread:bindtap={onTapMainThread} />
```

The binding, installation, slot and token objects must never be captured by the main-thread function or cross threads. The documentation says values captured by a main-thread function reach the main thread only after the component re-renders and must survive `JSON.stringify()`, so anything it captures can be one render stale, and `activate` repeats its checks. The design neither adds a registry nor replaces direct references to solve a transfer requirement that is not proven. Three checks would qualify the bridge: a build that accepts `runOnBackground` over a function referencing the slot, a device run that shows the call order, and a named host API that rejects non-gesture calls. A main-thread `setStyleProperty` for a pressed state must be undone in the `main-thread:ref` cleanup, or a recycled element keeps the old style. The design relies only on this about lifecycle: setup runs once per logical instance after its first commit, the cleanup runs in the background after the unmounting commit, an early or uncommitted render holds only an inert slot, and a tap handler already queued when cleanup runs finds the installation retired and is refused.

**Mount, session reset and unmount.** The processor and surfaces live as long as one `<A2UI>` mount, and a new session is a new mount. The application keys the mount and creates the admitting store with it:

```tsx
<A2UI key={sessionKey} messageStore={store} catalogs={catalogs} onAction={forwardToAgent} />
```

A changed `key` unmounts every catalog component, so each control runs `close()`, retires its installation, disposes its binding and cancels its invocation, and a fresh processor starts. Replacing the `messageStore` prop without changing the key is not an upstream error, but the processor keeps its surfaces and `processedCount`: a replacement store holding fewer messages than `processedCount` has all of them skipped, one holding exactly as many triggers nothing, and one holding more is processed from index `processedCount`. This adapter chooses a stricter rule and labels it as its own: one admitting store per session, replaced only together with the key, because bound controls and the admission annotation assume one continuous message history. `store.clear()` empties the buffer but leaves the processor's surfaces and the mounted bindings in place, so it is not a session reset. Within a mount, new messages update components in place through their resources, and an instance, its slot and any pending invocation continue. A component is removed from the rendered tree when its parent no longer references it, its subtree unmounts, or its surface is deleted, and in those cases the control's cleanup runs. A component ID merely omitted from a later `updateComponents` is not removed. The component type must stay stable, because React remounts instances when the component function identity changes, which would dispose every binding: `createActionControl` is called once at module scope and the `catalogs` array is a module constant.

**Failure.** `activate` never throws into the renderer. A refused tap returns `'unbound'` or `'stale'` and the control ignores it. A thrown `input` ends the invocation as `invalid-input` inside the runtime. A setup exception leaves the instance unbound, in this order: the slot disposes the bindings that setup attached and drops the key watch that setup started, retires the handle so a copy kept by the failed setup cannot bind later, publishes the unbound snapshot, and only then calls `onSetupError`. The reporter therefore sees an instance that is already unbound, and a reporter that itself throws cannot leave behavior installed. Cleanup is by identity: it disposes only what that setup attached, so a later installation's valid binding is not touched when a kept view from the failed setup is disposed.

**Versions and compatibility.** SAGA pins Lit and core at 0.13.0. `@lynx-js/genui` 0.7.0 depends on `@a2ui/web_core` at exactly 0.10.6 and ships its own `MessageProcessor`, resources and signal-backed state, with peer dependencies `@lynx-js/react >=0.121.0` and an optional `@lynx-js/lynx-ui >=3.133.0`. In a scratch install, npm installed 0.10.6 (through GenUI) and 0.13.0 (under an alias) side by side, and both expose a `v0_9` entry. Under default TypeScript optional-property rules, `A2uiMessage` from each version is assignable to the other. Under `exactOptionalPropertyTypes`, the 0.13.0 type is not assignable to the 0.10.6 type, and the compiler names `createSurface.sendDataModel`, declared `?: boolean | undefined` in 0.13.0 and `?: boolean` in 0.10.6. This is a type-level result. It does not show that the two versions' runtime message shapes and semantics agree, and version numbers in npm declarations do not establish that the published packages equal the pinned commit. Separately, the array `[actionButton, Button, Column, Text]` does not type-check under `strictFunctionTypes`, because the upstream built-ins declare narrower props than `ComponentType<GenericComponentProps>`. The compile check shows the single resulting error and that the file compiles with that option off. That is an observation about upstream's documented usage, not a design question. This Blueprint upgrades neither dependency.

The SDK standards place A2UI decoding in a named protocol module in core, and `packages/core/src/protocols/a2ui` now exists. Adopting GenUI means GenUI also interprets the protocol. Whether `@saga-a2ui/lynx` wraps GenUI and accepts a second validation path, or renders core-decoded values through its own catalog components, is open. It changes where messages enter the admitting store, not where the binding attaches. The core files at `c3eecaa` were not read for this purpose.
