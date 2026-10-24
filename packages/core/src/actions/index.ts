// Public interface of the action module. Application code builds a definition with `Action` and
// attaches it to a rendered instance through the `InstanceView` its setup receives. A renderer
// adapter opens instances on an `InstanceHost`. Nothing here imports a DOM, a renderer or MCP.
//
// Local and server actions use immutable definitions. An action runs asynchronous `before`
// prerequisites and its handler under one work deadline. Four hooks and resource cleanup have
// separate bounds. Both busy policies, `observe` and an optional `subject` reader belong to the
// binding. The invocation scope offers `atActivation`, `own`, `acquire` and `transfer`, and releases
// whatever it still holds. `Action.server(label, transport)` also gives its handler `call`; the
// transport is the application's seam, so no MCP package is imported here. Each bound resolves
// from the action's `limits`, then the instance host's `limits`, then the default (30,000 ms of
// work, 5,000 ms per awaited hook or cleanup step). Failures carry an extensible `category`, and
// `ActionError` lets an application state one. `eventTurn` is not declared.
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
