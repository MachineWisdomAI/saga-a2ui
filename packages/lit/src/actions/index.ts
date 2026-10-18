// Optional Lit integration for direct action attachment. An application that lists none of this
// in its catalog carries none of it: the main `@saga-a2ui/lit` entry does not import this module.
export { ActionButton, ActionButtonElement, actionButtonEntry } from './action-button.js';
export type { ActionButtonActivation, ActionButtonEvents } from './action-button.js';
export { createLitActions, type LitActionsOptions } from './lit-actions.js';
