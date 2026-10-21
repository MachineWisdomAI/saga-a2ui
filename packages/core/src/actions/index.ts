// Public interface of the action module. Application code builds a definition with `Action` and
// attaches it to a rendered instance through the `InstanceView` its setup receives. A renderer
// adapter opens instances on an `InstanceHost`. Nothing here imports a DOM, a renderer or MCP.
//
// Implemented so far: immutable local definitions (ACT1); in ACT4 their asynchronous execution:
// `before` prerequisites with `proceed`/`refuse`, asynchronous handlers, the work deadline and the
// hook budget, the four hooks, both busy policies, `observe`, and the optional `subject` reader; in
// ACT5 the invocation scope: `atActivation`, `own`, `acquire`, `transfer`, and release of what the
// invocation still holds; and in ACT6 server actions: `Action.server(label, transport)`, whose
// handler also receives `call`. The transport is the application's seam, so no MCP package is
// imported here. Both bounds are optional everywhere: each resolves from the action's `limits`
// override, then the `limits` of the instance host that owns the binding, then the default
// (30,000 ms of work, 5,000 ms per awaited hook or cleanup step). Failures carry an extensible
// `category`, and `ActionError` lets an application state one. `eventTurn` is a later slice and
// is not declared.
export { Action } from './definition.js';
export type {
  ActionDefinition,
  ActionDraft,
  ActionDraftAfterInput,
  ActionDraftChain,
  ActionDraftWithHandler,
  ActivationContext,
  BusyPolicy,
  CanceledContext,
  FailureContext,
  FinallyContext,
  HandlerContext,
  SuccessContext,
} from './definition.js';
export { snapshotLimits } from './limits.js';
export type { Limits } from './limits.js';
export { ActionError } from './category.js';
export type { ErrorCategory, KnownErrorCategory } from './category.js';
export type {
  ServerCallOptions,
  ServerCalls,
  ServerReply,
  ServerRequest,
  ServerRequestOptions,
  ServerTransport,
} from './server.js';
export type { Synchronous } from './thenable.js';
export { InvocationEndedError } from './scope.js';
export type {
  ActivationScope,
  Held,
  InvocationScope,
  Release,
  ReleaseContext,
} from './scope.js';
export { prerequisite, proceed, refuse } from './prerequisite.js';
export type {
  Prerequisite,
  PrerequisiteContext,
  PrerequisiteResult,
  Proceed,
  Refuse,
} from './prerequisite.js';
export type {
  ActionObserver,
  CancelCause,
  CleanupError,
  CleanupStep,
  Freshness,
  NoValues,
  InputFailure,
  ObservedEvent,
  ObservedPhase,
  Outcome,
  PrerequisiteFailure,
  RunningFailure,
} from './outcome.js';
export type { ActionBinding, BindingPhase, BindingState } from './binding.js';
export { componentKind, createInstanceHost } from './instance-host.js';
export type {
  BindOptions,
  ComponentKind,
  InstanceEvent,
  InstanceHandle,
  InstanceHost,
  InstanceView,
  OpenInfo,
  OpenInstance,
} from './instance-host.js';
