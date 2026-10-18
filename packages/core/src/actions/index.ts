// Public interface of the action module. Application code builds a definition with `Action` and
// attaches it to a rendered instance through the `InstanceView` its setup receives. A renderer
// adapter opens instances on an `InstanceHost`. Nothing here imports a DOM, a renderer or MCP.
//
// Implemented so far: immutable local definitions (ACT1), and in ACT4 their asynchronous
// execution: `before` prerequisites with `proceed`/`refuse`, asynchronous handlers, the optional
// work deadline and the required hook budget (`limits`), the four hooks, both busy policies,
// `observe`, and the optional `subject` reader. The invocation scope, resource ownership and
// transfer (ACT5), server actions (ACT6) and `atActivation` are later slices and are not declared.
export { Action } from './definition.js';
export type {
  ActionDefinition,
  ActionDraft,
  ActionDraftAfterInput,
  ActionDraftWithHandler,
  BusyPolicy,
  CanceledContext,
  FailureContext,
  FinallyContext,
  HandlerContext,
  Limits,
  SuccessContext,
  Synchronous,
} from './definition.js';
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
