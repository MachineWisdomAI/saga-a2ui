import { Action, prerequisite, proceed, refuse } from '@saga-a2ui/core/actions';
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

// ---------------------------------------------------------------------------------------------
// ACT4: asynchronous local actions. The prerequisite and the row work wait for the test, so it
// chooses the order in which things settle. Both run on the background runtime like every other
// callback here.
// ---------------------------------------------------------------------------------------------

/** One entry per pending session request. Answering it is the test's choice. */
export const pendingSessions: Array<(answer: 'signed-in' | 'signed-out') => void> = [];

/** One entry per pending row's work. */
export const pendingRows: Array<{ readonly noteId: string; readonly release: () => void }> = [];

const requireSession = prerequisite(
  'session',
  () =>
    new Promise<ReturnType<typeof proceed<{ readonly user: string }>> | ReturnType<typeof refuse>>((resolve) => {
      pendingSessions.push((answer) => resolve(answer === 'signed-in' ? proceed({ user: 'u-1' }) : refuse('sign-in-required')));
    }),
);

/** A fixed control: it waits for a session, then records the order it reviewed. */
export const reviewOrder = Action.local<ActionButtonActivation>('review-order')
  .input((event) => ({ orderId: requireString(event.read('orderId'), 'order') }))
  .before(requireSession)
  .run(({ params, provided }) => {
    presentation.set(params.orderId, `reviewed by ${provided.user}`);
    trace({ ev: 'invoke', definition: 'review-order', item: params.orderId, background: onBackground() });
    return params.orderId;
  })
  .onFailure(({ failure, current }) => {
    if (current()) trace({ ev: 'hook', hook: 'failure', kind: failure.kind });
  })
  .onCanceled(({ cause, stage }) => void trace({ ev: 'hook', hook: 'canceled', definition: 'review-order', cause, stage }))
  .build();

/** A template row: the work waits for the test, and the position's own item is its subject. */
export const stageNote = Action.local<ActionButtonActivation>('stage-note')
  .input((event) => ({ noteId: requireString(event.read('noteId'), 'note') }))
  .run(
    ({ params }) =>
      new Promise<void>((resolve) => {
        trace({ ev: 'invoke', definition: 'stage-note', item: params.noteId, background: onBackground() });
        pendingRows.push({ noteId: params.noteId, release: resolve });
      }),
  )
  .onSuccess(({ params, current }) => {
    if (current()) presentation.set(params.noteId, 'staged');
  })
  .onCanceled(({ params, cause, stage }) => {
    presentation.set(params.noteId, `canceled: ${cause}`);
    trace({ ev: 'hook', hook: 'canceled', definition: 'stage-note', item: params.noteId, cause, stage });
  })
  .build();
