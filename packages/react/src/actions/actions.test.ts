// @vitest-environment jsdom
import { A2uiSurface } from '@a2ui/react/v0_9';
import {
  Action,
  createInstanceHost,
  type ActionBinding,
  type ActionDefinition,
  type InstanceHandle,
  type InstanceHost,
  type InstanceView,
} from '@saga-a2ui/core/actions';
import {
  Component,
  createElement,
  Fragment,
  Suspense,
  use,
  useContext,
  useLayoutEffect,
  useState,
  useTransition,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActionButton,
  type ActionButtonActivation,
  type ActionButtonEvents,
} from './action-button.js';
import {
  columnHooks,
  mount,
  openSession,
  SURFACE_ID,
  surfaceView,
  type Mounted,
  type Session,
} from './fixture.test-support.js';
import {
  ActionScopeContext,
  InstanceHostProvider,
  useActionSetup,
  type ActionScope,
} from './instance-host.js';

// Real React 19 rendering of a real `A2uiSurface` from the published `@a2ui/react` 0.13.0, with
// the application's own catalog: upstream-contract Column, Row, List, Text and Button, plus the
// opt-in `ActionButton`. jsdom supplies the DOM; the clicks are real DOM clicks that React's own
// event system delivers. Strict Mode is on unless a test says otherwise. Nothing here asserts on
// how the adapter is built inside: it uses the public setup interface, the DOM and the surface.

type Handle = InstanceHandle<ActionButtonEvents>;

let mounted: Mounted | undefined;
const sessions: Session[] = [];
afterEach(() => {
  mounted?.unmount();
  for (const session of sessions.splice(0)) session.dispose();
  mounted = undefined;
});

const log: unknown[] = [];
const named = (label: string): ActionDefinition<ActionButtonActivation> =>
  Action.local<ActionButtonActivation>(label)
    .run(() => void log.push(label))
    .build();
/** Copies the pressed row's `id` through the instance's own data scope. */
const archive = Action.local<ActionButtonActivation>('archive')
  .input((event) => ({ noteId: String(event.read('id')), at: event.dataPath }))
  .run(
    ({ params }) => void log.push({ archived: params.noteId, at: params.at }),
  )
  .build();
const probe = named('probe');

function start(options: { messages?: unknown[]; strict?: boolean } = {}): {
  session: Session;
  view: Mounted;
} {
  log.length = 0;
  const session = openSession(options.messages);
  sessions.push(session);
  mounted = mount({ strict: options.strict ?? true });
  return { session, view: mounted };
}

/** Collects every handle a registration delivers and the binding made on each. */
function recorder() {
  const delivered: Handle[] = [];
  const bindings: ActionBinding[] = [];
  return {
    delivered,
    bindings,
    bind:
      (definition: ActionDefinition<ActionButtonActivation>) =>
      (handle: Handle) => {
        delivered.push(handle);
        bindings.push(handle.bindAction('activate', definition));
      },
  };
}

/** What binding a probe through this handle does: `bound` or the message of the refusal. */
function tryBind(handle: Handle): string {
  try {
    handle.bindAction('activate', probe);
    return 'bound';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
const isStale = (message: string): boolean => message.includes('is stale');

const updateComponents = (...components: object[]) => [
  { version: 'v0.9', updateComponents: { surfaceId: SURFACE_ID, components } },
];
const updateRows = (rows: { id: string; title: string }[]) => [
  {
    version: 'v0.9',
    updateDataModel: { surfaceId: SURFACE_ID, path: '/rows', value: rows },
  },
];

describe('attaching one definition to one rendered control', () => {
  it('a press runs only the definition attached to that control, once; unbound and upstream controls keep their own path', async () => {
    const { session, view } = start();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) => {
          setupView.watchById(
            'mark-a',
            ActionButton,
            (handle) => void handle.bindAction('activate', named('mark-a')),
          );
          setupView.watchById(
            'mark-b',
            ActionButton,
            (handle) => void handle.bindAction('activate', named('mark-b')),
          );
        },
      }),
    );

    view.press(view.button('Mark A'));
    expect(log).toEqual(['mark-a']);
    view.press(view.button('Mark B'));
    expect(log).toEqual(['mark-a', 'mark-b']);

    view.press(view.button('Unbound'));
    expect(log).toEqual(['mark-a', 'mark-b']);
    expect(session.upstream).toEqual([]);

    view.press(view.button('Upstream'));
    await view.settle();
    expect(session.upstream).toHaveLength(1);
    expect(log).toEqual(['mark-a', 'mark-b']);
  });

  it('a failing checks rule disables the control and no invocation starts', () => {
    const { session, view } = start();
    session.ingest(
      updateComponents({
        id: 'mark-a',
        component: 'ActionButton',
        child: 'mark-a-label',
        checks: [
          {
            condition: { call: 'required', args: { value: '' } },
            message: 'Required',
          },
        ],
      }),
    );
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) =>
          setupView.watchById(
            'mark-a',
            ActionButton,
            (handle) => void handle.bindAction('activate', named('mark-a')),
          ),
      }),
    );

    expect(view.button('Mark A').disabled).toBe(true);
    view.press(view.button('Mark A'));
    expect(log).toEqual([]);
  });

  it('the strict schema rejects an upstream action or a handler name before anything binds', () => {
    const { session } = start();
    expect(() =>
      session.ingest(
        updateComponents({
          id: 'mark-a',
          component: 'ActionButton',
          child: 'mark-a-label',
          action: { event: { name: 'x' } },
        }),
      ),
    ).toThrow(/action/);
    expect(() =>
      session.ingest(
        updateComponents({
          id: 'mark-a',
          component: 'ActionButton',
          child: 'mark-a-label',
          handler: 'x',
        }),
      ),
    ).toThrow(/handler/);
  });
});

describe('Strict Mode', () => {
  it('leaves exactly one live binding per control; handles from the discarded first pass cannot bind', () => {
    const { session, view } = start({ strict: true });
    const seen = recorder();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) =>
          void setupView.watchById(
            'mark-a',
            ActionButton,
            seen.bind(named('mark-a')),
          ),
      }),
    );

    // Development Strict Mode set up, cleaned up and set up again: more than one handle was delivered.
    expect(seen.delivered.length).toBeGreaterThan(1);
    const liveBindings = seen.bindings.filter(
      (binding) => binding.state.phase !== 'disposed',
    );
    expect(liveBindings).toHaveLength(1);

    const outcomes = seen.delivered.map(tryBind);
    expect(outcomes.filter(isStale)).toHaveLength(seen.delivered.length - 1);
    // The one live handle is refused only because its slot is taken, never silently replaced.
    expect(outcomes.filter((outcome) => !isStale(outcome))).toEqual([
      expect.stringContaining('already has a live binding'),
    ]);

    view.press(view.button('Mark A'));
    expect(log).toEqual(['mark-a']);
  });
});

describe('work React starts and discards', () => {
  it('a transition that never commits publishes nothing; the committed instance keeps working until the replacement commits', async () => {
    const { session, view } = start({ strict: false });
    const second = openSession();
    const third = openSession();
    sessions.push(second, third);
    const seen = recorder();
    const setup = (setupView: InstanceView): void =>
      void setupView.watchById(
        'mark-a',
        ActionButton,
        seen.bind(named('mark-a')),
      );

    const controls: {
      swap(surface: Session['surface'], gate: Promise<void> | undefined): void;
    } = { swap: () => undefined };
    function Gate(props: { gate: Promise<void> | undefined }): null {
      if (props.gate) use(props.gate);
      return null;
    }
    function Switcher(): ReactNode {
      const [shown, setShown] = useState<{
        surface: Session['surface'];
        gate: Promise<void> | undefined;
      }>({
        surface: session.surface,
        gate: undefined,
      });
      const [, startTransition] = useTransition();
      controls.swap = (surface, gate) =>
        startTransition(() => setShown({ surface, gate }));
      return createElement(InstanceHostProvider, {
        onSetupError: () => undefined,
        children: createElement(
          Fragment,
          null,
          createElement(SetupOnly, { setup }),
          createElement(
            Suspense,
            { fallback: null },
            createElement(Gate, { gate: shown.gate }),
            createElement(A2uiSurface, { surface: shown.surface }),
          ),
        ),
      });
    }
    function SetupOnly(props: { setup: (view: InstanceView) => void }): null {
      useActionSetup(props.setup);
      return null;
    }
    view.render(createElement(Switcher));
    expect(seen.delivered).toHaveLength(1);

    // A transition whose render suspends is held back: the screen still shows, and runs, the first surface.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await act(async () => controls.swap(second.surface, held));
    expect(seen.delivered).toHaveLength(1);
    expect(seen.bindings[0]!.state.phase).toBe('idle');
    view.press(view.button('Mark A'));
    expect(log).toEqual(['mark-a']);

    // A newer transition replaces the held one, so the held render is discarded for good.
    await act(async () => controls.swap(third.surface, undefined));
    expect(seen.delivered).toHaveLength(2);
    expect(seen.bindings[0]!.state.phase).toBe('disposed');
    expect(tryBind(seen.delivered[0]!)).toContain('is stale');

    await act(async () => release());
    expect(seen.delivered).toHaveLength(2);
    view.press(view.button('Mark A'));
    expect(log).toEqual(['mark-a', 'mark-a']);
  });
});

describe('replacement', () => {
  it('replacing a keyed child retires its instance; the same ID rendered again is a new instance and starts unbound until discovery delivers it', () => {
    const { session, view } = start({ strict: false });
    const seen = recorder();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) =>
          void setupView.watchById(
            'mark-a',
            ActionButton,
            seen.bind(named('mark-a')),
          ),
      }),
    );
    expect(seen.delivered).toHaveLength(1);

    act(() =>
      session.ingest(
        updateComponents({
          id: 'mark-a',
          component: 'Column',
          children: ['mark-a-label'],
        }),
      ),
    );
    expect(seen.bindings[0]!.state.phase).toBe('disposed');
    expect(view.buttons('Mark A')).toHaveLength(0);
    expect(tryBind(seen.delivered[0]!)).toContain('is stale');

    // The parent's layout effect runs after its children's: by then the new instance is open and delivered,
    // so no frame shows a live-looking control that has no instance.
    const atParentLayout: number[] = [];
    columnHooks.afterLayout = () =>
      void atParentLayout.push(seen.delivered.length);
    act(() =>
      session.ingest(
        updateComponents({
          id: 'mark-a',
          component: 'ActionButton',
          child: 'mark-a-label',
        }),
      ),
    );
    columnHooks.afterLayout = undefined;
    expect(atParentLayout.at(-1)).toBe(2);
    expect(seen.delivered).toHaveLength(2);
    expect(seen.delivered[1]).not.toBe(seen.delivered[0]);
    view.press(view.button('Mark A'));
    expect(log).toEqual(['mark-a']);
  });

  // In the published 0.13.0 a new surface first renders the loading placeholder, so the root boundary remounts
  // rather than receiving a new node prop; either way the old instance is retired and the new one is delivered.
  it('swapping the surface retires the old root instance; the registration binds the new one', () => {
    log.length = 0;
    const rootOnly = [
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: SURFACE_ID,
          catalogId:
            'https://saga-a2ui.local/catalogs/react-action-consumer/v1',
        },
      },
      ...updateComponents(
        { id: 'root', component: 'ActionButton', child: 'root-label' },
        { id: 'root-label', component: 'Text', text: 'Root' },
      ),
    ];
    const first = openSession(rootOnly);
    const second = openSession(rootOnly);
    sessions.push(first, second);
    mounted = mount({ strict: false });
    const seen = recorder();
    const setup = (setupView: InstanceView): void =>
      void setupView.watchById('root', ActionButton, seen.bind(named('root')));

    mounted.render(surfaceView({ surface: first.surface, setup }));
    const firstButton = mounted.button('Root');
    mounted.render(surfaceView({ surface: second.surface, setup }));

    expect(seen.delivered).toHaveLength(2);
    expect(seen.bindings.map((binding) => binding.state.phase)).toEqual([
      'disposed',
      'idle',
    ]);
    expect(tryBind(seen.delivered[0]!)).toContain('is stale');
    // The old element is gone; a click that still reached its node would find a retired instance.
    expect(firstButton.isConnected).toBe(false);
    mounted.press(mounted.button('Root'));
    expect(log).toEqual(['root']);
  });

  it('a node disposed by the resolver retires its instance synchronously, before React updates the screen', () => {
    const { session, view } = start({ strict: false });
    const seen = recorder();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) =>
          void setupView.watchById(
            'mark-a',
            ActionButton,
            seen.bind(named('mark-a')),
          ),
      }),
    );
    const oldButton = view.button('Mark A');

    // Outside `act`: React has been told but has not rendered yet.
    const complaints = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    session.ingest(
      updateComponents({
        id: 'mark-a',
        component: 'Column',
        children: ['mark-a-label'],
      }),
    );
    complaints.mockRestore();

    expect(oldButton.isConnected).toBe(true);
    expect(seen.bindings[0]!.state.phase).toBe('disposed');
    expect(tryBind(seen.delivered[0]!)).toContain('is stale');
    oldButton.click();
    expect(log).toEqual([]);
  });
});

describe('host changes under a node that stays', () => {
  it('a new host retires the old instance within the commit; the old handle cannot bind and a press reaches only the new binding', () => {
    const { session, view } = start({ strict: false });
    const scopeFor = (): ActionScope => ({
      host: createInstanceHost({ onSetupError: () => undefined }),
      onSetupError: () => undefined,
    });
    const oldScope = scopeFor();
    const newScope = scopeFor();
    const oldSeen = recorder();
    const newSeen = recorder();
    oldScope.host.register(
      (setupView) =>
        void setupView.watchById(
          'mark-a',
          ActionButton,
          oldSeen.bind(named('old')),
        ),
    );
    newScope.host.register(
      (setupView) =>
        void setupView.watchById(
          'mark-a',
          ActionButton,
          newSeen.bind(named('new')),
        ),
    );
    const under = (scope: ActionScope) =>
      createElement(
        ActionScopeContext.Provider,
        { value: scope },
        createElement(A2uiSurface, { surface: session.surface }),
      );

    view.render(under(oldScope));
    const button = view.button('Mark A');
    expect(oldSeen.delivered).toHaveLength(1);
    expect(newSeen.delivered).toHaveLength(0);

    view.render(under(newScope));
    expect(view.button('Mark A')).toBe(button); // the same node and element: nothing remounted
    expect(oldSeen.bindings[0]!.state.phase).toBe('disposed');
    expect(isStale(tryBind(oldSeen.delivered[0]!))).toBe(true);
    expect(newSeen.delivered).toHaveLength(1);

    view.press(button);
    expect(log).toEqual(['new']);
  });
});

describe('teardown', () => {
  it('unmounting the provider closes its host for good: a reference kept to it can neither register a setup nor open an instance', () => {
    const { session, view } = start({ strict: false });
    let kept: ActionScope | undefined;
    function Keep(): null {
      kept = useContext(ActionScopeContext);
      return null;
    }
    view.render(
      surfaceView({
        surface: session.surface,
        setup: () => undefined,
        after: createElement(Keep),
      }),
    );
    expect(kept).toBeDefined();

    view.unmount();
    mounted = undefined;

    const late = vi.fn();
    kept!.host.register(late);
    expect(late).not.toHaveBeenCalled();
    const opened = kept!.host.open({
      kind: ActionButton,
      componentId: 'late',
      dataPath: '/',
      events: ['activate'],
      isLive: () => true,
      read: () => undefined,
    });
    expect(opened.activate('activate', new Event('click'))).toBe('retired');
  });

  it('unmounting disposes every binding and ends the setup view', () => {
    const { session, view } = start({ strict: false });
    const seen = recorder();
    let captured: InstanceView | undefined;
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) => {
          captured = setupView;
          setupView.watchById(
            'mark-a',
            ActionButton,
            seen.bind(named('mark-a')),
          );
          setupView.watchById('row-archive', ActionButton, seen.bind(archive));
        },
      }),
    );
    expect(seen.bindings).toHaveLength(3);

    view.unmount();
    mounted = undefined;

    expect(seen.bindings.map((binding) => binding.state.phase)).toEqual([
      'disposed',
      'disposed',
      'disposed',
    ]);
    expect(seen.delivered.map((handle) => isStale(tryBind(handle)))).toEqual([
      true,
      true,
      true,
    ]);
    expect(() => captured?.getById('mark-a', ActionButton)).toThrow(
      /has ended/,
    );
    expect(() =>
      captured?.watchById('mark-a', ActionButton, () => undefined),
    ).toThrow(/has ended/);
  });
});

describe('teardown between a commit’s layout and passive effects', () => {
  it('an unmount queued after the commit that opened the controls retires every instance and binding that commit left', async () => {
    // Outside `act`, React commits in one task and runs that commit's passive effects in a later
    // one. The Column's layout effect runs after its children's, i.e. after the controls' instances
    // opened; the unmount is queued from there, so it lands before the commit's passive effects.
    // React runs a pending passive effect before it processes the next update, so on 19.3.1 the
    // setup still discovers and binds the instances, and the unmount then disposes those bindings.
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    log.length = 0;
    const session = openSession();
    sessions.push(session);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const seen = recorder();
    const errors: unknown[] = [];

    let queued = false;
    columnHooks.afterLayout = () => {
      if (queued || container.querySelector('button') === null) return;
      queued = true;
      queueMicrotask(() => root.unmount());
    };
    try {
      root.render(
        surfaceView({
          surface: session.surface,
          setup: (setupView) =>
            setupView.watchById(
              'mark-a',
              ActionButton,
              seen.bind(named('mark-a')),
            ),
          onSetupError: (error) => void errors.push(error),
        }),
      );
      await vi.waitFor(
        () => expect(container.querySelector('button')).toBeNull(),
        { timeout: 2_000 },
      );
      // Let any passive effect React still held run before judging what is left.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      columnHooks.afterLayout = undefined;
      container.remove();
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    }

    expect(queued).toBe(true);
    expect(errors).toEqual([]);
    // Whatever was bound before the unmount took effect is disposed, and nothing can bind again.
    expect(
      seen.bindings.filter((binding) => binding.state.phase !== 'disposed'),
    ).toEqual([]);
    expect(seen.delivered.map((handle) => isStale(tryBind(handle)))).toEqual(
      seen.delivered.map(() => true),
    );
    expect(log).toEqual([]);
  });
});

describe('repeated IDs and data scopes', () => {
  it('each row acts on its own data; getById refuses the ambiguity and names the ID', () => {
    const { session, view } = start();
    let setupView: InstanceView | undefined;
    let duringSetup = '';
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (received) => {
          setupView = received;
          received.watchById(
            'row-archive',
            ActionButton,
            (handle) => void handle.bindAction('activate', archive),
          );
          try {
            received.getById('row-archive', ActionButton);
          } catch (error) {
            duringSetup = String(error);
          }
        },
      }),
    );

    // The first commit renders the surface's loading state: no instance is open while the setup effect
    // runs, so `getById` finds none then and `watchById` is the discovery that reaches instances later.
    expect(duringSetup).toContain('No rendered instance');
    let ambiguity = '';
    try {
      setupView?.getById('row-archive', ActionButton);
    } catch (error) {
      ambiguity = String(error);
    }
    expect(ambiguity).toContain("'row-archive'");
    expect(ambiguity).toContain('2 rendered instances');
    const [first, second] = view.buttons('Archive');
    view.press(second!);
    view.press(first!);
    expect(log).toEqual([
      { archived: 'n-2', at: '/rows/1' },
      { archived: 'n-1', at: '/rows/0' },
    ]);
  });

  it('a row that appears later is discovered and bound once; a row that disappears has its binding disposed and nothing else is touched', () => {
    const { session, view } = start({ strict: false });
    const seen = recorder();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) =>
          void setupView.watchById(
            'row-archive',
            ActionButton,
            seen.bind(archive),
          ),
      }),
    );
    expect(seen.delivered).toHaveLength(2);

    act(() =>
      session.ingest(
        updateRows([
          { id: 'n-1', title: 'Alpha' },
          { id: 'n-2', title: 'Beta' },
          { id: 'n-3', title: 'Gamma' },
        ]),
      ),
    );
    expect(seen.delivered).toHaveLength(3);
    expect(seen.delivered.map((handle) => handle.dataPath)).toEqual([
      '/rows/0',
      '/rows/1',
      '/rows/2',
    ]);

    act(() => session.ingest(updateRows([{ id: 'n-1', title: 'Alpha' }])));
    expect(seen.bindings.map((binding) => binding.state.phase)).toEqual([
      'idle',
      'disposed',
      'disposed',
    ]);
    expect(seen.delivered.map((handle) => isStale(tryBind(handle)))).toEqual([
      false,
      true,
      true,
    ]);
    view.press(view.button('Archive'));
    expect(log).toEqual([{ archived: 'n-1', at: '/rows/0' }]);
  });

  it('replacing the item at a position keeps the instance and its binding; the next press and the live reader see the new item', () => {
    const { session, view } = start({ strict: false });
    const seen = recorder();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) =>
          void setupView.watchById(
            'row-archive',
            ActionButton,
            seen.bind(archive),
          ),
      }),
    );
    const [firstHandle] = seen.delivered;
    const [firstBinding] = seen.bindings;
    expect(firstHandle!.read('id')).toBe('n-1');

    act(() =>
      session.ingest(
        updateRows([
          { id: 'n-9', title: 'Replaced' },
          { id: 'n-2', title: 'Beta' },
        ]),
      ),
    );

    expect(seen.delivered).toHaveLength(2); // nothing was re-delivered
    expect(firstBinding!.state.phase).toBe('idle');
    expect(firstHandle!.read('id')).toBe('n-9'); // the live reader pulls from the instance's data scope now
    view.press(view.buttons('Archive')[0]!);
    expect(log).toEqual([{ archived: 'n-9', at: '/rows/0' }]);
  });

  it('the event reads the instance only while it is delivered; the live reader is undefined once the instance retires', () => {
    const { session, view } = start({ strict: false });
    const kept: ActionButtonActivation[] = [];
    const keep = Action.local<ActionButtonActivation>('keep')
      .input((event) => event)
      .run(({ params }) => void kept.push(params))
      .build();
    const seen = recorder();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) =>
          void setupView.watchById(
            'row-archive',
            ActionButton,
            seen.bind(keep),
          ),
      }),
    );

    view.press(view.buttons('Archive')[1]!);
    expect(kept).toHaveLength(1);
    expect(() => kept[0]!.read('id')).toThrow(
      /only while the event is being delivered/,
    );
    expect(kept[0]!.dataPath).toBe('/rows/1');

    act(() => session.ingest(updateRows([{ id: 'n-1', title: 'Alpha' }])));
    expect(seen.delivered[1]!.read('id')).toBeUndefined();
  });
});

describe('failure, duplicates and rebinding', () => {
  class Boundary extends Component<
    { children: ReactNode; onCatch(error: unknown): void },
    { failed: boolean }
  > {
    override state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    override componentDidCatch(error: unknown, _info: ErrorInfo) {
      this.props.onCatch(error);
    }
    override render() {
      return this.state.failed
        ? createElement('p', { role: 'alert' }, 'Actions are unavailable')
        : this.props.children;
    }
  }

  it('a setup that throws is reported, leaves nothing bound and reaches the nearest error boundary; a later mount recovers', () => {
    const { session, view } = start({ strict: false });
    const seen = recorder();
    const reported: unknown[] = [];
    const caught: unknown[] = [];
    const guarded = (
      generation: number,
      setup: (setupView: InstanceView) => void,
    ) =>
      createElement(Boundary, {
        key: generation,
        onCatch: (error) => caught.push(error),
        children: surfaceView({
          surface: session.surface,
          onSetupError: (error) => reported.push(error),
          setup,
        }),
      });
    const working = (setupView: InstanceView): void =>
      void setupView.watchById(
        'mark-a',
        ActionButton,
        seen.bind(named('mark-a')),
      );
    // Instances exist by now, so this setup binds the present control and only then fails.
    const failing = (setupView: InstanceView): void => {
      setupView.watchById('mark-a', ActionButton, seen.bind(named('mark-a')));
      throw new Error('setup failed on purpose');
    };

    view.render(guarded(1, working));
    expect(seen.bindings).toHaveLength(1);

    const complaints = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    // Same boundary and provider, a different setup function: React ends the first registration and runs the second.
    view.render(guarded(1, failing));
    complaints.mockRestore();

    expect(reported.map(String)).toEqual(['Error: setup failed on purpose']);
    expect(caught.map(String)).toEqual(['Error: setup failed on purpose']);
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(
      'Actions are unavailable',
    );
    expect(seen.bindings.map((binding) => binding.state.phase)).toEqual([
      'disposed',
      'disposed',
    ]);
    expect(seen.delivered.map((handle) => isStale(tryBind(handle)))).toEqual([
      true,
      true,
    ]);

    // A fresh view over the same surface model recovers and binds again.
    view.render(guarded(2, working));
    view.press(view.button('Mark A'));
    expect(log).toEqual(['mark-a']);
  });

  it('a discovery callback that throws loses only its own bindings and is reported without disturbing the tree', () => {
    const { session, view } = start({ strict: false });
    const reported: unknown[] = [];
    view.render(
      surfaceView({
        surface: session.surface,
        onSetupError: (error) => reported.push(error),
        setup: (setupView) => {
          setupView.watchById('mark-a', ActionButton, (handle) => {
            handle.bindAction('activate', named('mark-a'));
            throw new Error('callback failed');
          });
          setupView.watchById(
            'mark-b',
            ActionButton,
            (handle) => void handle.bindAction('activate', named('mark-b')),
          );
        },
      }),
    );

    expect(reported.map(String)).toEqual(['Error: callback failed']);
    view.press(view.button('Mark A'));
    view.press(view.button('Mark B'));
    expect(log).toEqual(['mark-b']);
  });

  it('a second attachment to the same event throws and leaves the first working, once', () => {
    const { session, view } = start({ strict: false });
    const reported: unknown[] = [];
    const first = recorder();
    function Registered(props: {
      name: string;
      seen: ReturnType<typeof recorder>;
    }): null {
      useActionSetup(
        (setupView) =>
          void setupView.watchById(
            'mark-a',
            ActionButton,
            props.seen.bind(named(props.name)),
          ),
      );
      return null;
    }
    // Hooks run per component, so two registrations share one host through one provider.
    const second = recorder();
    view.render(
      createElement(InstanceHostProvider, {
        onSetupError: (error) => reported.push(error),
        children: createElement(
          Fragment,
          null,
          createElement(Registered, { name: 'first', seen: first }),
          createElement(Registered, { name: 'second', seen: second }),
          createElement(A2uiSurface, { surface: session.surface }),
        ),
      }),
    );

    expect(reported).toHaveLength(1);
    expect(String(reported[0])).toContain('already has a live binding');
    expect(second.bindings).toHaveLength(0);
    view.press(view.button('Mark A'));
    expect(log).toEqual(['first']);
  });

  it('dispose is idempotent, detaches only its own installation, and the same live handle can bind again', () => {
    const { session, view } = start({ strict: false });
    const seen = recorder();
    view.render(
      surfaceView({
        surface: session.surface,
        setup: (setupView) =>
          void setupView.watchById(
            'mark-a',
            ActionButton,
            seen.bind(named('one')),
          ),
      }),
    );
    const [handle] = seen.delivered;
    const [one] = seen.bindings;

    view.press(view.button('Mark A'));
    one!.dispose();
    view.press(view.button('Mark A'));
    expect(log).toEqual(['one']);

    const two = handle!.bindAction('activate', named('two'));
    one!.dispose(); // late and repeated: it must not detach the newer installation
    view.press(view.button('Mark A'));
    expect(log).toEqual(['one', 'two']);
    expect([one!.state.phase, two.state.phase]).toEqual(['disposed', 'idle']);
  });

  it('changing the definition re-registers: the old binding is disposed, one binding remains, and the next press runs the new definition', () => {
    const { session, view } = start({ strict: false });
    const seen = recorder();
    const setupFor = (name: string) => (setupView: InstanceView) =>
      void setupView.watchById('mark-a', ActionButton, seen.bind(named(name)));
    const setupA = setupFor('A');
    const setupB = setupFor('B');

    view.render(surfaceView({ surface: session.surface, setup: setupA }));
    view.render(surfaceView({ surface: session.surface, setup: setupB }));

    expect(seen.bindings.map((binding) => binding.state.phase)).toEqual([
      'disposed',
      'idle',
    ]);
    view.press(view.button('Mark A'));
    expect(log).toEqual(['B']);
  });
});

describe('an unrelated host is not an instance host', () => {
  it('discovery needs a provider; a surface rendered without one leaves every control inert', () => {
    const { session, view } = start();
    view.render(createElement(A2uiSurface, { surface: session.surface }));
    view.press(view.button('Mark A'));
    expect(log).toEqual([]);
  });

  it('two providers make two scopes over the same surface model', () => {
    const { session, view } = start({ strict: false });
    const hosts: InstanceHost[] = [];
    void hosts;
    const oneSeen = recorder();
    const twoSeen = recorder();
    const scoped = (seen: ReturnType<typeof recorder>, name: string) =>
      surfaceView({
        surface: session.surface,
        setup: (setupView) =>
          void setupView.watchById(
            'mark-a',
            ActionButton,
            seen.bind(named(name)),
          ),
      });
    view.render(
      createElement(
        Fragment,
        null,
        createElement('section', { key: 'one' }, scoped(oneSeen, 'one')),
        createElement('section', { key: 'two' }, scoped(twoSeen, 'two')),
      ),
    );

    const [first, second] = view.buttons('Mark A');
    view.press(second!);
    view.press(first!);
    expect(log).toEqual(['two', 'one']);
  });
});
