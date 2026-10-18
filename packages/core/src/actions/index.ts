// Public interface of the action module. Application code builds a definition with `Action` and
// attaches it to a rendered instance through the `InstanceView` its setup receives. A renderer
// adapter opens instances on an `InstanceHost`. Nothing here imports a DOM, a renderer or MCP.
//
// Implemented so far (ACT1): immutable synchronous local definitions, direct attachment with
// per-binding state, discovery and ownership. Prerequisites, hooks, limits, busy policies other
// than the default, subjects, resource scopes and server calls are later slices and are not
// declared here.
export { Action } from './definition.js';
export type {
  ActionDefinition,
  ActionDraft,
  ActionDraftAfterInput,
  ActionDraftWithHandler,
  HandlerContext,
  Synchronous,
} from './definition.js';
export type { ActionBinding, BindingPhase, BindingState } from './binding.js';
export { componentKind, createInstanceHost } from './instance-host.js';
export type {
  ComponentKind,
  InstanceEvent,
  InstanceHandle,
  InstanceHost,
  InstanceView,
  OpenInfo,
  OpenInstance,
} from './instance-host.js';
