// Optional React integration for direct action attachment. It qualifies the shared action seam
// against the published `@a2ui/react` runtime and is not React parity. An application that lists
// none of this in its catalog carries none of it.
export { ActionButton, ActionButtonEntry } from './action-button.js';
export type {
  ActionButtonActivation,
  ActionButtonEvents,
} from './action-button.js';
export { InstanceHostProvider, useActionSetup } from './instance-host.js';
export {
  ActionsScope,
  createReactActions,
  type ReactActions,
  type ReactActionsOptions,
} from './react-actions.js';
