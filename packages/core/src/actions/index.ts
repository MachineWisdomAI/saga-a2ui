// Public interface of the action module. Application code builds a definition with `Action` and
// attaches it to a rendered instance through the `InstanceView` its setup receives. A renderer
// adapter opens instances on an `InstanceHost`. Nothing here imports a DOM, a renderer or MCP.
//
// Implemented so far: immutable local definitions (ACT1); in ACT4 their asynchronous execution:
// `before` prerequisites with `proceed`/`refuse`, asynchronous handlers, the optional work
// deadline and the required hook budget (`limits`), the four hooks, both busy policies, `observe`,
// and the optional `subject` reader; and in ACT5 the invocation scope: `atActivation`, `own`,
// `acquire`, `transfer`, and release of what the invocation still holds. Server actions (ACT6) and
// `eventTurn` are later slices and are not declared.
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
  Limits,
  SuccessContext,
} from './definition.js';
export type { Synchronous } from './thenable.js';
export { InvocationEndedError } from './scope.js';
export type { ActivationScope, Held, InvocationScope, Release, ReleaseContext } from './scope.js';
export { prerequisite, proceed, refuse } from './prerequisite.js';
export type { Prerequisite, PrerequisiteContext, PrerequisiteResult, Proceed, Refuse } from './prerequisite.js';
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
