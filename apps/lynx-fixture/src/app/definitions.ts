import { Action } from '@saga-a2ui/core/actions';
import type { ActionButtonActivation } from '../adapter/kind.js';
import { onBackground, trace } from '../trace.js';

// Three definitions built once with the shared builder. Two of them attach to the same control
// kind; the third is the "archive" action of a template row. They are synchronous because that is
// all ACT1 offers, and each records one invocation with the item the pressed instance showed.
//
// Each `run` body carries a unique marker string so the partition test can show these functions
// are present in the background bundle and absent from the main-thread bundle.

/** Presentation state keyed by business item, never by a handle to a rendered view. */
export const presentation = new Map<string, string>();

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`no ${name} selected`);
  return value;
}

export const submitOrder = Action.local<ActionButtonActivation>('submit-order')
  .input((event) => {
    trace({ ev: 'input', background: onBackground() });
    return { orderId: requireString(event.read('orderId'), 'order') };
  })
  .run(({ params }) => {
    presentation.set(params.orderId, 'submitted');
    trace({ ev: 'invoke', definition: 'submit-order', item: params.orderId, marker: 'SAGA_MARKER_DEFINITION_SUBMIT', background: onBackground() });
  })
  .build();

export const cancelOrder = Action.local<ActionButtonActivation>('cancel-order')
  .input((event) => {
    trace({ ev: 'input', background: onBackground() });
    return { orderId: requireString(event.read('orderId'), 'order') };
  })
  .run(({ params }) => {
    presentation.set(params.orderId, 'cancelled');
    trace({ ev: 'invoke', definition: 'cancel-order', item: params.orderId, marker: 'SAGA_MARKER_DEFINITION_CANCEL', background: onBackground() });
  })
  .build();

export const archiveNote = Action.local<ActionButtonActivation>('archive-note')
  .input((event) => {
    trace({ ev: 'input', background: onBackground() });
    return { noteId: requireString(event.read('noteId'), 'note') };
  })
  .run(({ params }) => {
    presentation.set(params.noteId, 'archived');
    trace({ ev: 'invoke', definition: 'archive-note', item: params.noteId, marker: 'SAGA_MARKER_DEFINITION_ARCHIVE', background: onBackground() });
  })
  .build();

/** A handler that fails, to show what an activation failure does on this runtime. */
export const failingAction = Action.local<ActionButtonActivation>('failing')
  .run(() => {
    throw new Error('handler failed on purpose');
  })
  .build();
