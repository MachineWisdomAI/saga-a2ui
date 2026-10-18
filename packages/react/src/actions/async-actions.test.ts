// @vitest-environment jsdom
import { A2uiSurface } from '@a2ui/react/v0_9';
import {
  Action,
  createInstanceHost,
  prerequisite,
  proceed,
  type ActionBinding,
  type ActionDefinition,
  type InstanceHandle,
} from '@saga-a2ui/core/actions';
import { createElement } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionButton, type ActionButtonActivation, type ActionButtonEvents } from './action-button.js';
import { mount, openSession, SURFACE_ID, surfaceView, type Mounted, type Session } from './fixture.test-support.js';
import { ActionScopeContext, type ActionScope } from './instance-host.js';

// ACT4 common-seam qualification on React: the shared runtime's admission and currentness against
// this renderer's real observation seams. A real `A2uiSurface` from the published `@a2ui/react`
// 0.13.0 renders a real `ActionButton`; the clicks are real DOM clicks; the data changes are real
// messages the surface ingests. Promises are gated by the test. This is the narrowest evidence for
// the seam, not React parity: only the React 19.3.1 + jsdom 28.1.0 pairing ran.

type Handle = InstanceHandle<ActionButtonEvents>;

interface Gate<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}
function gate<T = void>(): Gate<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onValue) => {
    resolve = onValue;
  });
  return { promise, resolve };
}

let mounted: Mounted | undefined;
const sessions: Session[] = [];
afterEach(() => {
  mounted?.unmount();
  for (const session of sessions.splice(0)) session.dispose();
  mounted = undefined;
});

function start(): { session: Session; view: Mounted } {
  const session = openSession();
  sessions.push(session);
  mounted = mount({ strict: false });
  return { session, view: mounted };
}

const updateRows = (rows: { id: string; title: string }[]) => [
  { version: 'v0.9', updateDataModel: { surfaceId: SURFACE_ID, path: '/rows', value: rows } },
];

interface Trace {
  readonly calls: string[];
  readonly bindings: ActionBinding[];
  readonly handles: Handle[];
}

/** An asynchronous archive action: a pending prerequisite, then the handler, with hooks that record. */
function archiveAfter(pending: Gate<unknown>, trace: Trace): ActionDefinition<ActionButtonActivation> {
  return Action.local<ActionButtonActivation>('archive')
    .input((event) => ({ noteId: String(event.read('id')) }))
    .before(prerequisite('session', () => pending.promise.then(() => proceed({ session: 'ok' }))))
    .run(({ params }) => {
      trace.calls.push(`run ${params.noteId}`);
      return params.noteId;
    })
    .limits({ hookMs: 60_000 })
    .onSuccess(({ params, current }) => {
      if (current()) trace.calls.push(`shown ${params.noteId}`);
    })
    .onCanceled(({ params, cause }) => void trace.calls.push(`canceled ${params.noteId}: ${cause}`))
    .build();
}

function bindRows(trace: Trace, definition: ActionDefinition<ActionButtonActivation>, withSubject: boolean) {
  return (handle: Handle): void => {
    trace.handles.push(handle);
    trace.bindings.push(
      handle.bindAction('activate', definition, withSubject ? { subject: () => handle.read('id') } : {}),
    );
  };
}

const trace = (): Trace => ({ calls: [], bindings: [], handles: [] });

describe('an asynchronous action on a rendered React control', () => {
  it('waits for a pending prerequisite, then runs the handler and the success hook, and shows its state', async () => {
    const { session, view } = start();
    const seen = trace();
    const pending = gate();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) => void setupView.watchById('row-archive', ActionButton, bindRows(seen, archiveAfter(pending, seen), true)),
      }),
    );

    view.press(view.buttons('Archive')[0]!);
    await view.settle();
    expect(seen.calls).toEqual([]);
    expect(seen.bindings[0]!.state.phase).toBe('running');

    pending.resolve(undefined);
    await view.settle();

    expect(seen.calls).toEqual(['run n-1', 'shown n-1']);
    expect(seen.bindings[0]!.state.phase).toBe('idle');
    expect(seen.bindings[1]!.state.phase).toBe('idle');
  });

  it('cancels at the data change when the position starts showing another item; the control and binding stay, other rows are untouched', async () => {
    const { session, view } = start();
    const seen = trace();
    const pending = gate();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) => void setupView.watchById('row-archive', ActionButton, bindRows(seen, archiveAfter(pending, seen), true)),
      }),
    );
    const [first, second] = view.buttons('Archive');
    view.press(first!);
    view.press(second!);

    await act(async () => session.ingest(updateRows([{ id: 'n-9', title: 'Replaced' }, { id: 'n-2', title: 'Beta' }])));

    // The data model's own subscription woke the runtime: no press, no checkpoint of the application.
    expect(seen.calls).toEqual(['canceled n-1: subject-changed']);
    expect(view.buttons('Archive')[0]).toBe(first); // the same element and instance
    expect(seen.bindings[0]!.state.phase).toBe('idle');
    expect(seen.bindings[1]!.state.phase).toBe('running');

    pending.resolve(undefined);
    await view.settle();
    expect(seen.calls).toEqual(['canceled n-1: subject-changed', 'run n-2', 'shown n-2']);

    view.press(first!);
    await view.settle();
    expect(seen.calls.slice(-2)).toEqual(['run n-9', 'shown n-9']);
  });

  it('without a subject reader the replaced position goes unnoticed and the old item presents', async () => {
    const { session, view } = start();
    const seen = trace();
    const pending = gate();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) => void setupView.watchById('row-archive', ActionButton, bindRows(seen, archiveAfter(pending, seen), false)),
      }),
    );
    view.press(view.buttons('Archive')[0]!);

    await act(async () => session.ingest(updateRows([{ id: 'n-9', title: 'Replaced' }, { id: 'n-2', title: 'Beta' }])));
    pending.resolve(undefined);
    await view.settle();

    expect(seen.calls).toEqual(['run n-1', 'shown n-1']);
  });

  it('does not see an A, B, A that completes inside one ingest, and does not revive an invocation once B was observed', async () => {
    const { session, view } = start();
    const seen = trace();
    const pending = gate();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) => void setupView.watchById('row-archive', ActionButton, bindRows(seen, archiveAfter(pending, seen), true)),
      }),
    );
    const original = [{ id: 'n-1', title: 'Alpha' }, { id: 'n-2', title: 'Beta' }];
    view.press(view.buttons('Archive')[0]!);

    // Both messages apply in one call stack: each wake-up is a queued microtask, and both read A.
    await act(async () => session.ingest([...updateRows([{ id: 'n-9', title: 'B' }, original[1]!]), ...updateRows(original)]));
    expect(seen.calls).toEqual([]);
    expect(seen.bindings[0]!.state.phase).toBe('running');

    // Observed at a checkpoint between the two: canceled, and A coming back later changes nothing.
    await act(async () => session.ingest(updateRows([{ id: 'n-9', title: 'B' }, original[1]!])));
    await act(async () => session.ingest(updateRows(original)));
    expect(seen.calls).toEqual(['canceled n-1: subject-changed']);
    pending.resolve(undefined);
    await view.settle();
    expect(seen.calls).toEqual(['canceled n-1: subject-changed']);
  });

  it('disposes the in-flight invocation when its row disappears; the late continuation starts nothing', async () => {
    const { session, view } = start();
    const seen = trace();
    const pending = gate();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) => void setupView.watchById('row-archive', ActionButton, bindRows(seen, archiveAfter(pending, seen), true)),
      }),
    );
    view.press(view.buttons('Archive')[1]!);

    await act(async () => session.ingest(updateRows([{ id: 'n-1', title: 'Alpha' }])));
    expect(seen.calls).toEqual(['canceled n-2: disposed']);
    expect(seen.bindings[1]!.state.phase).toBe('disposed');

    pending.resolve(undefined);
    await view.settle();
    expect(seen.calls).toEqual(['canceled n-2: disposed']);
    expect(seen.bindings[1]!.state.phase).toBe('disposed');
  });

  it('disposes the in-flight invocation when the surface unmounts before the continuation', async () => {
    const { session, view } = start();
    const seen = trace();
    const pending = gate();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) => void setupView.watchById('row-archive', ActionButton, bindRows(seen, archiveAfter(pending, seen), true)),
      }),
    );
    view.press(view.buttons('Archive')[0]!);

    view.unmount();
    mounted = undefined;
    pending.resolve(undefined);
    await act(async () => {});

    expect(seen.calls).toEqual(['canceled n-1: disposed']);
    expect(seen.bindings[0]!.state.phase).toBe('disposed');
  });

  it('after a host change under a node that stays, in-flight work is canceled and its current() is false', async () => {
    const { session, view } = start();
    const seen = trace();
    const pending = gate();
    let current: (() => boolean) | undefined;
    const probing = Action.local<ActionButtonActivation>('probing')
      .before(
        prerequisite('probe', ({ current: check }) => {
          current = check;
          return pending.promise.then(() => proceed());
        }),
      )
      .run(() => void seen.calls.push('ran'))
      .limits({ hookMs: 60_000 })
      .onCanceled(({ cause }) => void seen.calls.push(`canceled: ${cause}`))
      .build();
    const scopeFor = (): ActionScope => ({ host: createInstanceHost({ onSetupError: () => undefined }), onSetupError: () => undefined });
    const oldScope = scopeFor();
    const newScope = scopeFor();
    oldScope.host.register((setupView) => void setupView.watchById('mark-a', ActionButton, (handle) => void handle.bindAction('activate', probing)));
    const under = (scope: ActionScope) =>
      createElement(ActionScopeContext.Provider, { value: scope }, createElement(A2uiSurface, { surface: session.surface }));

    view.render(under(oldScope));
    view.press(view.button('Mark A'));
    expect(current?.()).toBe(true);

    view.render(under(newScope));

    expect(current?.()).toBe(false);
    pending.resolve(undefined);
    await view.settle();
    expect(seen.calls).toEqual(['canceled: disposed']);
  });
});
