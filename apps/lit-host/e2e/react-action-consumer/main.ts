import {
  A2uiSurface,
  createComponentImplementation,
  type ReactCatalogComponent,
} from '@a2ui/react/v0_9';
import { Catalog, type SurfaceModel } from '@a2ui/web_core/v0_9';
import {
  basicCatalog,
  ButtonApi,
  ColumnApi,
  ListApi,
  RowApi,
  TextApi,
} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  Action,
  prerequisite,
  proceed,
  refuse,
  type ActionBinding,
  type ActionDefinition,
  type InstanceHandle,
  type InstanceView,
} from '@saga-a2ui/core/actions';
import {
  a2uiV0_9Decoder,
  createMessageSession,
  type IngestResult,
  type MessageSession,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import {
  ActionButton,
  ActionButtonEntry,
  InstanceHostProvider,
  useActionSetup,
  type ActionButtonActivation,
  type ActionButtonEvents,
} from '@saga-a2ui/react/actions';
import {
  Component,
  createElement,
  Fragment,
  StrictMode,
  version as reactVersion,
  type ReactNode,
} from 'react';
import { version as reactDomVersion } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

// Test-only page: a synthetic React application over the published `@a2ui/react` with its own
// catalog (upstream Column, Row, List, Text and Button contracts, plus the opt-in ActionButton)
// and a trace the browser spec reads. It uses only the public exports of the SDK packages. The
// bundle is React's development build under Strict Mode, as in an application under development.

export const CATALOG_ID =
  'https://saga-a2ui.local/catalogs/react-action-consumer/v1';
export const SURFACE_ID = 'actions';

declare const __REACT_ACTION_CONSUMER_IDENTITIES__: Record<string, string>;

type ChildReference =
  string | { readonly id: string; readonly basePath: string };

// The generated view hands a child list over as tokens, or `{ id, basePath }` for a template item.
function childrenOf(
  buildChild: (id: string, basePath?: string) => ReactNode,
  value: unknown,
): ReactNode[] {
  const list = Array.isArray(value) ? (value as ChildReference[]) : [];
  return list.map((child) =>
    typeof child === 'string'
      ? buildChild(child)
      : buildChild(child.id, child.basePath),
  );
}

// `@a2ui/react` 0.13.0 ships no basic catalog, so an application builds its layout components from
// the upstream component contracts. The Button's behavior is the upstream one: pressing it calls
// the resolved `action`, which dispatches on the surface (the protocol path).
const Text = createComponentImplementation(TextApi, ({ props }) =>
  createElement('span', null, String(props.text ?? '')),
);
const Column = createComponentImplementation(
  ColumnApi,
  ({ props, buildChild }) =>
    createElement('div', null, ...childrenOf(buildChild, props.children)),
);
const Row = createComponentImplementation(RowApi, ({ props, buildChild }) =>
  createElement('div', null, ...childrenOf(buildChild, props.children)),
);
const List = createComponentImplementation(ListApi, ({ props, buildChild }) =>
  createElement('div', null, ...childrenOf(buildChild, props.children)),
);
const Button = createComponentImplementation(
  ButtonApi,
  ({ props, buildChild }) =>
    createElement(
      'button',
      {
        type: 'button',
        onClick: () => (props.action as (() => void) | undefined)?.(),
      },
      typeof props.child === 'string' ? buildChild(props.child) : null,
    ),
);
const catalog = new Catalog<ReactCatalogComponent>(
  CATALOG_ID,
  'v0.9',
  [Text, Column, Row, List, Button, ActionButtonEntry],
  [...basicCatalog.functions.values()],
);

const layout = (): unknown[] => [
  {
    version: 'v0.9',
    createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: SURFACE_ID,
      components: [
        {
          id: 'root',
          component: 'Column',
          children: [
            'save',
            'mark-a',
            'mark-b',
            'orphan',
            'upstream-button',
            'rows',
          ],
        },
        { id: 'save', component: 'ActionButton', child: 'save-label' },
        { id: 'save-label', component: 'Text', text: 'Save' },
        { id: 'mark-a', component: 'ActionButton', child: 'mark-a-label' },
        { id: 'mark-a-label', component: 'Text', text: 'Mark A' },
        { id: 'mark-b', component: 'ActionButton', child: 'mark-b-label' },
        { id: 'mark-b-label', component: 'Text', text: 'Mark B' },
        // Deliberately not watched: a control with no attached action must stay inert.
        { id: 'orphan', component: 'ActionButton', child: 'orphan-label' },
        { id: 'orphan-label', component: 'Text', text: 'Unbound' },
        {
          id: 'upstream-button',
          component: 'Button',
          child: 'upstream-label',
          action: { event: { name: 'upstream-press' } },
        },
        { id: 'upstream-label', component: 'Text', text: 'Upstream' },
        {
          id: 'rows',
          component: 'List',
          children: { componentId: 'row', path: '/rows' },
        },
        { id: 'row', component: 'Row', children: ['row-title', 'row-archive'] },
        { id: 'row-title', component: 'Text', text: { path: 'title' } },
        {
          id: 'row-archive',
          component: 'ActionButton',
          child: 'row-archive-label',
        },
        { id: 'row-archive-label', component: 'Text', text: 'Archive' },
      ],
    },
  },
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: SURFACE_ID,
      value: {
        rows: [
          { id: 'n-1', title: 'Alpha' },
          { id: 'n-2', title: 'Beta' },
        ],
      },
    },
  },
];

export interface TracedBinding {
  readonly componentId: string;
  readonly dataPath: string;
  readonly handle: InstanceHandle<ActionButtonEvents>;
  readonly binding: ActionBinding;
}

export interface ReactActionConsumer {
  /** What the application's actions did, in order. */
  readonly log: { action: string; [detail: string]: unknown }[];
  /** `component|dataPath|bindingId|phase` for every state change of every traced binding. */
  readonly phases: string[];
  /** Upstream protocol actions the surface dispatched. */
  readonly upstream: unknown[];
  /** What reached the provider's `onSetupError` sink. */
  readonly setupErrors: string[];
  /** What reached the application's error boundary. */
  readonly caught: string[];
  readonly bindings: TracedBinding[];
  readonly identities: Record<string, string>;
  /** Makes the next mount's setup bind `save` and then throw. */
  failSetup: boolean;
  /** Makes the discovery callback of this component throw after binding. */
  failDiscovery: string | undefined;
  send(input: unknown): IngestResult;
  /** `getById` on the latest setup view: 'ok', or the message of the error it threw. */
  getById(id: string): string;
  /** Binds a probe action through the handle of a traced binding: 'ok', or the error message. */
  bindAgain(index: number): string;
  /** Shows a second surface model (a new session with the same layout) in place of the first. */
  newSurface(): void;
  unmount(): void;
  mount(): void;
  /**
   * Scenario `async` only: the session prerequisite and the row work wait for the test. Each entry
   * is one pending request; answering it is the test's choice and ordering.
   */
  readonly pendingSessions: ((answer: 'signed-in' | 'signed-out') => void)[];
  readonly pendingRows: { noteId: string; release: () => void }[];
}

declare global {
  interface Window {
    reactActionConsumer: ReactActionConsumer;
  }
}

const consumer: ReactActionConsumer = {
  log: [],
  phases: [],
  upstream: [],
  setupErrors: [],
  caught: [],
  bindings: [],
  identities: {
    ...__REACT_ACTION_CONSUMER_IDENTITIES__,
    runtimeReact: reactVersion,
    runtimeReactDom: reactDomVersion,
  },
  failSetup: false,
  failDiscovery: undefined,
  pendingSessions: [],
  pendingRows: [],
  send: (input) => current.session.ingest(input),
  getById: (id) => {
    try {
      latestView?.getById(id, ActionButton);
      return 'ok';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  bindAgain: (index) => {
    const entry = consumer.bindings[index];
    if (!entry) return 'no such traced binding';
    try {
      trace(entry.handle, entry.handle.bindAction('activate', probe));
      return 'ok';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  newSurface: () => {
    current = openSession();
    render();
  },
  unmount: () => {
    root?.unmount();
    root = undefined;
  },
  mount: () => {
    root = createRoot(container());
    setup = makeSetup();
    render();
  },
};
window.reactActionConsumer = consumer;

// App code: the definitions are built once and shared by every binding that uses them.
const save = Action.local<ActionButtonActivation>('save')
  .run(() => void consumer.log.push({ action: 'save' }))
  .build();
const mark = Action.local<ActionButtonActivation>('mark')
  .input((event) => event.componentId)
  .run(
    ({ params }) =>
      void consumer.log.push({ action: 'mark', componentId: params }),
  )
  .build();
const archive = Action.local<ActionButtonActivation>('archive-note')
  .input((event) => {
    const noteId = event.read('id');
    if (typeof noteId !== 'string' || noteId === '')
      throw new Error('this row shows no note');
    return { noteId, at: event.dataPath };
  })
  .run(
    ({ params }) =>
      void consumer.log.push({
        action: 'archive-note',
        noteId: params.noteId,
        at: params.at,
      }),
  )
  .build();
const probe = Action.local<ActionButtonActivation>('probe')
  .run(() => void consumer.log.push({ action: 'probe' }))
  .build();

// ---------------------------------------------------------------------------------------------
// Scenario `async` (ACT4), chosen with `?scenario=async` so that the synchronous scenario keeps its
// exact layout and bindings: a Save-style action whose session prerequisite waits for the test,
// and a row action with a subject that waits for the test too.
// ---------------------------------------------------------------------------------------------

const scenario = new URLSearchParams(location.search).get('scenario');

/** The binding state and the last message a hook presented, outside the React root. */
function present(kind: 'phase' | 'message', text: string): void {
  const element = document.querySelector(`[data-${kind}]`);
  if (element) element.textContent = text;
}

const asyncLayout = (): unknown[] => [
  {
    version: 'v0.9',
    createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: SURFACE_ID,
      components: [
        { id: 'root', component: 'Column', children: ['save-draft', 'rows'] },
        {
          id: 'save-draft',
          component: 'ActionButton',
          child: 'save-draft-label',
        },
        { id: 'save-draft-label', component: 'Text', text: 'Save draft' },
        {
          id: 'rows',
          component: 'List',
          children: { componentId: 'row', path: '/rows' },
        },
        { id: 'row', component: 'Row', children: ['row-title', 'row-stage'] },
        { id: 'row-title', component: 'Text', text: { path: 'title' } },
        {
          id: 'row-stage',
          component: 'ActionButton',
          child: 'row-stage-label',
        },
        { id: 'row-stage-label', component: 'Text', text: 'Stage' },
      ],
    },
  },
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: SURFACE_ID,
      value: {
        draft: 'hello',
        rows: [
          { id: 'n-1', title: 'Alpha' },
          { id: 'n-2', title: 'Beta' },
        ],
      },
    },
  },
];

const requireSession = prerequisite(
  'session',
  () =>
    new Promise<
      | ReturnType<typeof proceed<{ readonly user: string }>>
      | ReturnType<typeof refuse>
    >((resolve) => {
      consumer.pendingSessions.push((answer) =>
        resolve(
          answer === 'signed-in'
            ? proceed({ user: 'u-1' })
            : refuse('sign-in-required'),
        ),
      );
    }),
);

const saveDraft = Action.local<ActionButtonActivation>('save-draft')
  .input((event) => ({ text: String(event.read('/draft') ?? '') }))
  .before(requireSession)
  .run(({ params, provided }) => {
    consumer.log.push({
      action: 'save-draft',
      user: provided.user,
      length: params.text.length,
    });
    return { user: provided.user };
  })
  .onSuccess(({ result, current }) => {
    if (current()) present('message', `saved by ${result.user}`);
  })
  .onFailure((context) => {
    if (context.current())
      present(
        'message',
        context.failure.kind === 'refused'
          ? `refused: ${context.failure.reason}`
          : `failed: ${context.failure.kind}`,
      );
  })
  .onCanceled(
    ({ cause, stage }) =>
      void consumer.log.push({ action: 'save-draft-canceled', cause, stage }),
  )
  .build();

const stage = Action.local<ActionButtonActivation>('stage-note')
  .input((event) => {
    const noteId = event.read('id');
    if (typeof noteId !== 'string' || noteId === '')
      throw new Error('this row shows no note');
    return { noteId };
  })
  .run(
    ({ params }) =>
      new Promise<void>((resolve) => {
        consumer.log.push({ action: 'stage-started', noteId: params.noteId });
        consumer.pendingRows.push({ noteId: params.noteId, release: resolve });
      }),
  )
  .onSuccess(({ params, current }) => {
    if (current()) present('message', `staged ${params.noteId}`);
  })
  .onCanceled(({ params, cause }) =>
    present('message', `canceled ${params.noteId}: ${cause}`),
  )
  .build();

function trace(
  handle: InstanceHandle<ActionButtonEvents>,
  binding: ActionBinding,
): void {
  consumer.bindings.push({
    componentId: handle.id,
    dataPath: handle.dataPath,
    handle,
    binding,
  });
  binding.subscribe(() =>
    consumer.phases.push(
      `${handle.id}|${handle.dataPath}|${binding.id}|${binding.state.phase}`,
    ),
  );
}

interface Session {
  readonly session: MessageSession<ReactCatalogComponent>;
  readonly surface: SurfaceModel<ReactCatalogComponent>;
}

/** A real message session over the application's catalog, with the layout already ingested. */
function openSession(): Session {
  const session = createMessageSession<ReactCatalogComponent>({
    catalogs: [catalog],
    decoder: a2uiV0_9Decoder,
  });
  let surface: SurfaceModel<ReactCatalogComponent> | undefined;
  session.onSurfaceCreated((created) => {
    surface = created;
    created.onAction.subscribe((action) => {
      consumer.upstream.push(action);
    });
  });
  const result = session.ingest(
    scenario === 'async' ? asyncLayout() : layout(),
  );
  if (!result.ok || !surface)
    throw new Error('the layout did not create a surface');
  return { session, surface };
}

let latestView: InstanceView | undefined;

/** One mount's setup. It must be stable for that mount: a new function would end the registration and start another. */
function makeSetup(): (view: InstanceView) => void {
  const fail = consumer.failSetup;
  consumer.failSetup = false;
  return (view) => {
    latestView = view;
    if (scenario === 'async') {
      view.watchById('save-draft', ActionButton, (handle) => {
        const binding = handle.bindAction('activate', saveDraft);
        binding.subscribe(() => present('phase', binding.state.phase));
        trace(handle, binding);
      });
      view.watchById('row-stage', ActionButton, (handle) => {
        trace(
          handle,
          handle.bindAction('activate', stage, {
            subject: () => handle.read('id'),
          }),
        );
      });
      return;
    }
    const bind = (
      id: string,
      action: ActionDefinition<ActionButtonActivation>,
    ) =>
      view.watchById(id, ActionButton, (handle) => {
        trace(handle, handle.bindAction('activate', action));
        if (consumer.failDiscovery === id) throw new Error('callback failed');
      });
    bind('save', save);
    bind('mark-a', mark);
    bind('mark-b', mark);
    bind('row-archive', archive);
    if (fail) throw new Error('setup failed on purpose');
  };
}

function Setup(props: { readonly setup: (view: InstanceView) => void }): null {
  useActionSetup(props.setup);
  return null;
}

/** The application's error boundary: a setup that throws ends up here, and the page shows a safe fallback. */
class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    consumer.caught.push(String(error));
  }
  override render(): ReactNode {
    return this.state.failed
      ? createElement(
          'p',
          { role: 'alert', 'data-testid': 'failure' },
          'Actions could not be attached',
        )
      : this.props.children;
  }
}

let current: Session = openSession();
let setup = makeSetup();
let root: Root | undefined;

const container = (): HTMLElement => {
  const element = document.getElementById('root');
  if (!element) throw new Error('the page has no #root');
  return element;
};

function render(): void {
  // A fresh root per mount means a fresh error boundary, so a failed mount never poisons the next one.
  root?.render(
    createElement(
      StrictMode,
      null,
      createElement(
        Guard,
        null,
        createElement(InstanceHostProvider, {
          onSetupError: (error) =>
            void consumer.setupErrors.push(String(error)),
          children: createElement(
            Fragment,
            null,
            createElement(Setup, { setup }),
            createElement(A2uiSurface, { surface: current.surface }),
          ),
        }),
      ),
    ),
  );
}

if (scenario === 'async') {
  // Outside the React root, so unmounting the application cannot remove what the hooks last showed.
  for (const kind of ['phase', 'message']) {
    const line = document.createElement('p');
    line.dataset[kind] = '';
    document.body.append(line);
  }
}

consumer.mount();
