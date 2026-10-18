// @vitest-environment jsdom
import {
  Action,
  prerequisite,
  proceed,
  type ActionBinding,
  type InstanceHandle,
  type ServerReply,
  type ServerRequest,
  type ServerRequestOptions,
  type ServerTransport,
} from '@saga-a2ui/core/actions';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionButton, type ActionButtonActivation, type ActionButtonEvents } from './action-button.js';
import { mount, openSession, SURFACE_ID, surfaceView, type Mounted, type Session } from './fixture.test-support.js';

// ACT6 on the React adapter: the shared server-action runtime against this renderer's real seams.
// A real `A2uiSurface` from the published `@a2ui/react` 0.13.0 renders real `ActionButton`s, the
// clicks are real DOM clicks, and the data changes are real messages. The transport is a double
// with the shape `App.callServerTool` has; the complete App/AppBridge/MCP stack is exercised in
// the Lit host app's integration test. React 19.3.1 under jsdom 28.1.0 only: not React parity.

type Handle = InstanceHandle<ActionButtonEvents>;

interface Sent {
  readonly request: ServerRequest;
  readonly options: ServerRequestOptions | undefined;
  answer(reply: ServerReply): void;
}

function transportDouble(): { transport: ServerTransport; sent: Sent[] } {
  const sent: Sent[] = [];
  const transport: ServerTransport = {
    callServerTool: (request, options) =>
      new Promise<ServerReply>((resolve) => {
        sent.push({ request, options, answer: resolve });
      }),
  };
  return { transport, sent };
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

function archiveWith(transport: ServerTransport, shown: string[]) {
  return Action.server<ActionButtonActivation>('archive', transport)
    .input((event) => ({ noteId: String(event.read('id')) }))
    .before(prerequisite('session', () => proceed({ user: 'u-1' })))
    .run(async ({ params, provided, call }) => {
      await call('archive_note', { noteId: params.noteId, user: provided.user });
      return params.noteId;
    })
    .limits({ deadlineMs: 30_000, hookMs: 1_000 })
    .onSuccess(({ result, current }) => {
      if (current()) shown.push(`archived ${result}`);
    })
    .onCanceled(({ params, cause }) => void shown.push(`canceled ${params.noteId}: ${cause}`))
    .build();
}

function bind(shown: string[], transport: ServerTransport, bindings: ActionBinding[]) {
  const archive = archiveWith(transport, shown);
  return (handle: Handle): void => {
    bindings.push(handle.bindAction('activate', archive, { subject: () => handle.read('id') }));
  };
}

describe('a server action on a rendered React control', () => {
  it('archives the note each of two repeated rows shows, one request per press, and the rows stay independent', async () => {
    const { session, view } = start();
    const { transport, sent } = transportDouble();
    const shown: string[] = [];
    const bindings: ActionBinding[] = [];
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) => void setupView.watchById('row-archive', ActionButton, bind(shown, transport, bindings)),
      }),
    );
    const [first, second] = view.buttons('Archive');

    view.press(second!);
    await view.settle();
    expect(sent.map((one) => one.request)).toEqual([{ name: 'archive_note', arguments: { noteId: 'n-2', user: 'u-1' } }]);
    expect(sent[0]?.options?.timeout).toBeGreaterThan(0);
    expect(sent[0]?.options?.timeout).toBeLessThanOrEqual(30_000);
    expect(bindings.map((binding) => binding.state.phase)).toEqual(['idle', 'running']);

    view.press(first!);
    await view.settle();
    expect(sent.map((one) => one.request.arguments?.noteId)).toEqual(['n-2', 'n-1']);

    sent[0]?.answer({ content: [] });
    sent[1]?.answer({ content: [] });
    await view.settle();
    expect(shown).toEqual(['archived n-2', 'archived n-1']);
    expect(sent).toHaveLength(2);
  });

  it('aborts the pending request’s signal when the position starts showing another note, and presents nothing for the old one', async () => {
    const { session, view } = start();
    const { transport, sent } = transportDouble();
    const shown: string[] = [];
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) => void setupView.watchById('row-archive', ActionButton, bind(shown, transport, [])),
      }),
    );
    view.press(view.buttons('Archive')[0]!);
    await view.settle();
    expect(sent[0]?.options?.signal?.aborted).toBe(false);

    await act(async () => session.ingest(updateRows([{ id: 'n-9', title: 'Replaced' }, { id: 'n-2', title: 'Beta' }])));

    expect(sent[0]?.options?.signal?.aborted).toBe(true);
    expect(shown).toEqual(['canceled n-1: subject-changed']);
    sent[0]?.answer({ content: [] }); // a late reply: nothing is shown for either note
    await view.settle();
    expect(shown).toEqual(['canceled n-1: subject-changed']);
    expect(sent).toHaveLength(1);
  });

  it('retires the request when the row disappears', async () => {
    const { session, view } = start();
    const { transport, sent } = transportDouble();
    const shown: string[] = [];
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) => void setupView.watchById('row-archive', ActionButton, bind(shown, transport, [])),
      }),
    );
    view.press(view.buttons('Archive')[1]!);
    await view.settle();

    await act(async () => session.ingest(updateRows([{ id: 'n-1', title: 'Alpha' }])));

    expect(sent[0]?.options?.signal?.aborted).toBe(true);
    expect(shown).toEqual(['canceled n-2: disposed']);
  });
});
