import type { ActionBinding, InstanceHandle, InstanceView } from '@saga-a2ui/core/actions';
import { ActionButton, type ActionButtonEvents } from '../adapter/kind.js';
import { archiveNote, cancelOrder, submitOrder } from './definitions.js';

/** Test-driver hook: told about each handle and binding the application's setup makes. */
export interface SetupObserver {
  bound(handle: InstanceHandle<ActionButtonEvents>, binding: ActionBinding): void;
  discovered(handle: InstanceHandle<ActionButtonEvents>): void;
}

/**
 * The application's setup, written exactly as it is for Lit: it discovers instances by the
 * layout's component ID and binds an already built definition to the exact handle it receives.
 * An ID selects handles here, once; a tap never looks anything up.
 *
 * `'background only'` marks it so the compiler removes its body from the main-thread bundle.
 * Nothing here is called during render.
 */
export function attach(view: InstanceView, observer: SetupObserver): void {
  'background only';
  // SAGA_MARKER_SETUP_BODY: present in the background bundle only.
  view.watchById('submit-order', ActionButton, (handle) => {
    observer.discovered(handle);
    observer.bound(handle, handle.bindAction('activate', submitOrder));
  });
  view.watchById('cancel-order', ActionButton, (handle) => {
    observer.discovered(handle);
    observer.bound(handle, handle.bindAction('activate', cancelOrder));
  });
  // Every row of a template shares this one ID.
  view.watchById('row-archive', ActionButton, (handle) => {
    observer.discovered(handle);
    observer.bound(handle, handle.bindAction('activate', archiveNote));
  });
  // Setup that binds and then throws: nothing may stay bound.
  view.watchById('flaky', ActionButton, (handle) => {
    observer.discovered(handle);
    observer.bound(handle, handle.bindAction('activate', submitOrder));
    throw new Error('setup failed after binding');
  });
  // Discovered, but nothing is bound: this control stays unbound and refuses every tap.
  view.watchById('refund-order', ActionButton, (handle) => {
    observer.discovered(handle);
  });
}
