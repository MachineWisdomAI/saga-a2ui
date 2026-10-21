import { basicCatalog, type LitComponentApi } from '@a2ui/lit/v0_9';
import {
  Catalog,
  createFunctionImplementation,
  type Subscription,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {
  Action,
  prerequisite,
  proceed,
  refuse,
  type ActionBinding,
  type ActionDefinition,
  type InstanceHandle,
  type InstanceView,
  type PrerequisiteContext,
} from '@saga-a2ui/core/actions';
import {
  a2uiV0_9Decoder,
  createMessageSession,
  type IngestResult,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import {
  createA2uiAppElement,
  defineElements,
  type A2uiSession,
} from '@saga-a2ui/lit';
import {
  ActionButton,
  actionButtonEntry,
  createLitActions,
  type ActionButtonActivation,
  type ActionButtonEvents,
} from '@saga-a2ui/lit/actions';
import { archiveNoteWith, requireNoteId } from '../archive-fixture/archive.js';
import {
  createArchiveLab,
  wording,
  type ArchiveLab,
} from '../archive-fixture/lab.js';

// Test-only page: a synthetic application with its own catalog (upstream Column, Row, List, Text
// and Button, plus the opt-in ActionButton), two app elements so that two mounts can be compared,
// and a trace the browser spec reads. It uses only the public exports of the SDK packages.

export const CATALOG_ID = 'https://saga-a2ui.local/catalogs/action-consumer/v1';
export const SURFACE_ID = 'actions';

/** A function the layout must never be able to reach through an ActionButton. */
const spy = createFunctionImplementation(
  { name: 'spy', returnType: 'boolean', schema: z.object({}).strict() },
  () => {
    consumer.spyCalls += 1;
    return true;
  },
);

const upstream = (name: string): LitComponentApi => {
  const component = basicCatalog.components.get(name);
  if (!component) throw new Error(`the basic catalog has no ${name}`);
  return component;
};
const components: LitComponentApi[] = [
  upstream('Text'),
  upstream('Column'),
  upstream('Row'),
  upstream('List'),
  upstream('Button'),
  actionButtonEntry,
];
const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', components, [
  ...basicCatalog.functions.values(),
  spy,
]);

export interface TracedBinding {
  readonly app: string;
  readonly componentId: string;
  readonly dataPath: string;
  readonly handle: InstanceHandle<ActionButtonEvents>;
  readonly binding: ActionBinding;
}

export interface ActionConsumer {
  /** What the application's actions did, in order. */
  readonly log: { app: string; action: string; [detail: string]: unknown }[];
  /** `app|component|dataPath|bindingId|phase` for every state change of every traced binding. */
  readonly phases: string[];
  /** Upstream protocol actions the surface dispatched, with the app that presented it. */
  readonly upstream: unknown[];
  spyCalls: number;
  readonly setupErrors: string[];
  readonly attachCalls: Record<string, number>;
  readonly bindings: TracedBinding[];
  readonly views: Record<string, InstanceView>;
  readonly surfaces: Record<string, SurfaceModel<LitComponentApi>>;
  /** Makes the next `attach` of this app throw. */
  failSetupFor: string | undefined;
  /** In the default scenario, makes the discovery callback of the row at this data path throw once its binding is made. */
  throwOnDiscoveryAt: string | undefined;
  /**
   * What each app element did with the sessions it created: how many, how many were disposed, and
   * how many of the element's own listeners on the current session are still attached.
   */
  readonly sessions: Record<
    string,
    { created: number; disposed: number; listeners: number }
  >;
  /** Every session an app element created, oldest first, kept so a test can deliver late input to a retired one. */
  readonly sessionHistory: Record<string, A2uiSession[]>;
  stopDiscovery(app: string): void;
  send(app: string, input: unknown): IngestResult;
  /** `getById` on the app's setup view: 'ok', or the message of the error it threw. */
  getById(app: string, id: string): string;
  /** Binds a probe action through the handle of a traced binding: 'ok', or the error message. */
  bindAgain(index: number): string;
  /** The messages that create the surface with the consumer's layout and data. */
  layout(): unknown[];
  /**
   * Scenario `async` only: the session prerequisite and the row work wait for the test. Each entry
   * is one pending request; answering it is the test's choice and ordering.
   */
  readonly pendingSessions: ((answer: 'signed-in' | 'signed-out') => void)[];
  readonly pendingRows: { app: string; noteId: string; release: () => void }[];
  /** Scenario `resource` only: the application's own owner of a single shared player. */
  readonly player: PlayerOwner;
  /** Scenario `server` only: each app's test-controlled environment for the Archive server action. */
  readonly archive: Record<string, ArchiveLab>;
}

// ---------------------------------------------------------------------------------------------
// Scenario `resource` (ACT5): the application-owned token fixture. One shared player, one lease
// per acquisition. `end(lease)` is token-scoped and idempotent, `begin()` supersedes the previous
// lease, and `endCurrent()` is the owner's own teardown, which SAGA never calls. The test decides
// when a start answers, so it chooses the order in which things settle.
// ---------------------------------------------------------------------------------------------

export interface Lease {
  readonly id: number;
}

export class PlayerOwner {
  private count = 0;
  private current: Lease | undefined;
  private readonly calls: string[] = [];
  private readonly audible = new Set<number>();
  private readonly kept = new Set<number>();
  private readonly ended = new Set<number>();
  /** Each pending `start`; the test answers it. */
  readonly pendingStarts: ((answer: 'started' | 'blocked') => void)[] = [];
  /** Each pending acquisition of a lease after the event turn; the test lets it arrive. */
  readonly pendingAcquires: (() => void)[] = [];
  /** Each handler held after it transferred, before it returns its answer to the runtime. */
  readonly pendingAnswers: (() => void)[] = [];
  /** Makes the next handler wait after the transfer, so a cancellation can arrive before its answer is observed. */
  holdAfterTransfer = false;
  /** Makes the next success presentation throw. */
  failNextPresentation = false;

  begin(): Lease {
    const lease = { id: ++this.count };
    if (this.current !== undefined) this.audible.delete(this.current.id);
    this.current = lease;
    this.calls.push(`begin:${lease.id}`);
    return lease;
  }

  start(lease: Lease): Promise<'started' | 'blocked'> {
    this.calls.push(`start:${lease.id}`);
    if (this.current !== lease)
      return Promise.reject(new Error(`lease ${lease.id} was superseded`));
    return new Promise((resolve) => {
      this.pendingStarts.push((answer) => {
        // A lease that ended meanwhile never starts: the owner tests the exact acquisition.
        if (
          answer === 'started' &&
          this.current === lease &&
          !this.ended.has(lease.id)
        )
          this.audible.add(lease.id);
        resolve(answer);
      });
    });
  }

  keep(lease: Lease): void {
    this.calls.push(`keep:${lease.id}`);
    this.kept.add(lease.id);
  }

  end(lease: Lease): void {
    this.calls.push(`end:${lease.id}`);
    this.ended.add(lease.id);
    if (this.current === lease) {
      this.audible.delete(lease.id);
      this.kept.delete(lease.id);
    }
  }

  /** The owner's own teardown. */
  endCurrent(): void {
    this.calls.push('endCurrent');
    if (this.current !== undefined) this.end(this.current);
  }

  /** Another part of the application takes the single player. Returns the new lease's id. */
  takeOver(): number {
    const lease = this.begin();
    this.audible.add(lease.id);
    return lease.id;
  }

  snapshot(): { calls: string[]; audible: number[]; kept: number[] } {
    return {
      calls: [...this.calls],
      audible: [...this.audible],
      kept: [...this.kept],
    };
  }
}

declare global {
  interface Window {
    actionConsumer: ActionConsumer;
  }
}

const stoppers: Record<string, (() => void)[]> = {};
const consumer: ActionConsumer = {
  log: [],
  phases: [],
  upstream: [],
  spyCalls: 0,
  setupErrors: [],
  attachCalls: {},
  bindings: [],
  views: {},
  surfaces: {},
  failSetupFor: undefined,
  throwOnDiscoveryAt: undefined,
  sessions: {},
  sessionHistory: {},
  pendingSessions: [],
  pendingRows: [],
  player: new PlayerOwner(),
  archive: {},
  stopDiscovery: (app) => (stoppers[app] ?? []).forEach((stop) => stop()),
  send: (app, input) => {
    const element = document.querySelector<
      HTMLElement & { ingest(input: unknown): IngestResult }
    >(`[data-app="${app}"]`);
    if (!element) throw new Error(`${app} is not mounted`);
    return element.ingest(input);
  },
  bindAgain: () => 'unset',
  layout: () => [],
  getById: (app, id) => {
    try {
      consumer.views[app]?.getById(id, ActionButton);
      return 'ok';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
};
consumer.bindAgain = (index) => {
  const entry = consumer.bindings[index];
  if (!entry) return 'no such traced binding';
  try {
    const probe = Action.local<ActionButtonActivation>('probe')
      .run(
        () =>
          void consumer.log.push({
            app: entry.app,
            action: 'probe',
            componentId: entry.componentId,
          }),
      )
      .build();
    trace(entry.app, entry.handle, entry.handle.bindAction('activate', probe));
    return 'ok';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
consumer.layout = () => layout(SURFACE_ID);
window.actionConsumer = consumer;

// App code: the definitions are built once and shared by every binding that uses them.
const makeToggle = (app: string): ActionDefinition<ActionButtonActivation> =>
  Action.local<ActionButtonActivation>('toggle-details')
    .run(() => void consumer.log.push({ app, action: 'toggle-details' }))
    .build();

const makeMark = (app: string): ActionDefinition<ActionButtonActivation> =>
  Action.local<ActionButtonActivation>('mark')
    .input((event) => event.componentId)
    .run(
      ({ params }) =>
        void consumer.log.push({ app, action: 'mark', componentId: params }),
    )
    .build();

const makeArchive = (app: string): ActionDefinition<ActionButtonActivation> =>
  Action.local<ActionButtonActivation>('archive-note')
    .input((event) => ({
      noteId: requireNoteId(event.read('id')),
      at: event.dataPath,
    }))
    .run(
      ({ params }) =>
        void consumer.log.push({
          app,
          action: 'archive-note',
          noteId: params.noteId,
          at: params.at,
        }),
    )
    .build();

const makeSave = (app: string): ActionDefinition<ActionButtonActivation> =>
  Action.local<ActionButtonActivation>('save')
    .run(() => void consumer.log.push({ app, action: 'save' }))
    .build();

function trace(
  app: string,
  handle: InstanceHandle<ActionButtonEvents>,
  binding: ActionBinding,
): void {
  consumer.bindings.push({
    app,
    componentId: handle.id,
    dataPath: handle.dataPath,
    handle,
    binding,
  });
  binding.subscribe(() =>
    consumer.phases.push(
      `${app}|${handle.id}|${handle.dataPath}|${binding.id}|${binding.state.phase}`,
    ),
  );
}

/** One application's setup for one presented surface. It runs once per surface instance. */
function attachFor(app: string) {
  const toggle = makeToggle(app);
  const mark = makeMark(app);
  const archive = makeArchive(app);
  const save = makeSave(app);
  return (view: InstanceView): void => {
    consumer.attachCalls[app] = (consumer.attachCalls[app] ?? 0) + 1;
    if (consumer.failSetupFor === app) {
      consumer.failSetupFor = undefined;
      view.watchById('save', ActionButton, (handle) =>
        trace(app, handle, handle.bindAction('activate', save)),
      );
      throw new Error('setup failed on purpose');
    }
    consumer.views[app] = view;
    const bind = (
      id: string,
      action: ActionDefinition<ActionButtonActivation>,
    ) =>
      view.watchById(id, ActionButton, (handle) => {
        trace(app, handle, handle.bindAction('activate', action));
        if (consumer.throwOnDiscoveryAt === handle.dataPath)
          throw new Error(`discovery failed at ${handle.dataPath}`);
      });
    // 'orphan' is deliberately not watched: a control with no attached action must stay inert.
    stoppers[app] = [
      bind('details-toggle', toggle),
      bind('mark-a', mark),
      bind('mark-b', mark),
      bind('save', save),
      bind('row-archive', archive),
    ];
  };
}

const layout = (surfaceId: string) => [
  { version: 'v0.9', createSurface: { surfaceId, catalogId: CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        {
          id: 'root',
          component: 'Column',
          children: [
            'details-toggle',
            'mark-a',
            'mark-b',
            'save',
            'orphan',
            'upstream-button',
            'rows',
          ],
        },
        {
          id: 'details-toggle',
          component: 'ActionButton',
          child: 'details-label',
        },
        { id: 'details-label', component: 'Text', text: 'Toggle details' },
        { id: 'mark-a', component: 'ActionButton', child: 'mark-a-label' },
        { id: 'mark-a-label', component: 'Text', text: 'Mark A' },
        { id: 'mark-b', component: 'ActionButton', child: 'mark-b-label' },
        { id: 'mark-b-label', component: 'Text', text: 'Mark B' },
        { id: 'save', component: 'ActionButton', child: 'save-label' },
        { id: 'save-label', component: 'Text', text: 'Save' },
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
      surfaceId,
      value: {
        rows: [
          { id: 'n-1', title: 'Alpha' },
          { id: 'n-2', title: 'Beta' },
        ],
      },
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Scenario `async` (ACT4): a Save-style action with ordered prerequisites, and a row action that
// carries a subject. The page is chosen with `?scenario=async` so that the synchronous scenario
// above keeps its exact layout and bindings.
// ---------------------------------------------------------------------------------------------

const scenario = new URLSearchParams(location.search).get('scenario');

/** The binding state and the last message a hook presented, as the user would see them. */
function present(app: string, kind: 'phase' | 'message', text: string): void {
  const element = document.querySelector(`[data-${kind}="${app}"]`);
  if (element) element.textContent = text;
}

const asyncLayout = (surfaceId: string) => [
  { version: 'v0.9', createSurface: { surfaceId, catalogId: CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
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
      surfaceId,
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

/** Waits for the test to answer: the session is either valid or absent. */
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

/** Needs the extracted text, so it can only be declared after `input`. */
const requireText = prerequisite(
  'text',
  ({ params }: PrerequisiteContext<unknown, { readonly text: string }>) =>
    params.text === ''
      ? refuse('empty-draft')
      : proceed({ length: params.text.length }),
);

const makeSaveDraft = (app: string) =>
  Action.local<ActionButtonActivation>('save-draft')
    .input((event) => ({ text: String(event.read('/draft') ?? '') }))
    .before(requireSession)
    .before(requireText)
    .run(({ provided }) => {
      consumer.log.push({
        app,
        action: 'save-draft',
        user: provided.user,
        length: provided.length,
      });
      return { user: provided.user, length: provided.length };
    })
    .onSuccess(({ result, current }) => {
      if (current())
        present(app, 'message', `saved by ${result.user} (${result.length})`);
    })
    .onFailure((context) => {
      if (!context.current()) return;
      present(
        app,
        'message',
        context.failure.kind === 'refused'
          ? `refused: ${context.failure.reason}`
          : `failed: ${context.failure.kind}`,
      );
    })
    .onCanceled(
      ({ cause, stage }) =>
        void consumer.log.push({
          app,
          action: 'save-draft-canceled',
          cause,
          stage,
        }),
    )
    .build();

/** Work on one row that waits for the test; the subject is the row's own item. */
const makeStage = (app: string) =>
  Action.local<ActionButtonActivation>('stage-note')
    .input((event) => ({ noteId: requireNoteId(event.read('id')) }))
    .run(
      ({ params }) =>
        new Promise<void>((resolve) => {
          consumer.log.push({
            app,
            action: 'stage-started',
            noteId: params.noteId,
          });
          consumer.pendingRows.push({
            app,
            noteId: params.noteId,
            release: resolve,
          });
        }),
    )
    .onSuccess(({ params, current }) => {
      if (current()) present(app, 'message', `staged ${params.noteId}`);
    })
    .onCanceled(({ params, cause }) =>
      present(app, 'message', `canceled ${params.noteId}: ${cause}`),
    )
    .build();

function asyncAttachFor(app: string) {
  const saveDraft = makeSaveDraft(app);
  const stage = makeStage(app);
  return (view: InstanceView): void => {
    consumer.attachCalls[app] = (consumer.attachCalls[app] ?? 0) + 1;
    consumer.views[app] = view;
    view.watchById('save-draft', ActionButton, (handle) => {
      const binding = handle.bindAction('activate', saveDraft);
      binding.subscribe(() => present(app, 'phase', binding.state.phase));
      trace(app, handle, binding);
    });
    view.watchById('row-stage', ActionButton, (handle) => {
      trace(
        app,
        handle,
        handle.bindAction('activate', stage, {
          subject: () => handle.read('id'),
        }),
      );
    });
  };
}

// ---------------------------------------------------------------------------------------------
// Scenario `resource` (ACT5): a Play-style action that takes a lease in the event's own call
// stack, starts after an asynchronous wait, and hands a started lease to its owner; and a Lookup
// action that acquires a lease after the event turn. The Play definition follows the Blueprint's
// chosen policy, narrowing the returned result before it presents or recovers.
// ---------------------------------------------------------------------------------------------

const resourceLayout = (surfaceId: string) => [
  { version: 'v0.9', createSurface: { surfaceId, catalogId: CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Column', children: ['play', 'lookup'] },
        { id: 'play', component: 'ActionButton', child: 'play-label' },
        { id: 'play-label', component: 'Text', text: 'Play' },
        { id: 'lookup', component: 'ActionButton', child: 'lookup-label' },
        { id: 'lookup-label', component: 'Text', text: 'Lookup' },
      ],
    },
  },
];

const makePlay = (app: string) => {
  const { player } = consumer;
  return Action.local<ActionButtonActivation>('play')
    .atActivation(({ scope }) =>
      scope.own(player.begin(), (lease) => player.end(lease)),
    )
    .run(async ({ activation }) => {
      const started = await player.start(activation.token);
      // Not started: the scope still owns the lease and gives it back. Started: hand it to the owner, no await between.
      if (started === 'blocked') return { state: 'gesture-needed' } as const;
      if (!activation.transfer((lease) => player.keep(lease)))
        return { state: 'gesture-needed' } as const;
      if (player.holdAfterTransfer) {
        player.holdAfterTransfer = false;
        await new Promise<void>((resolve) =>
          player.pendingAnswers.push(resolve),
        );
      }
      return { state: 'playing', lease: activation.token } as const;
    })
    .onSuccess(({ result }) => {
      if (player.failNextPresentation) {
        player.failNextPresentation = false;
        throw new Error('the view update failed');
      }
      present(
        app,
        'message',
        result.state === 'playing' ? 'playing' : 'gesture needed',
      );
    })
    .onCanceled(({ activation, stage }) => {
      // Every stage carries the token: end exactly this lease, whether or not it was transferred.
      player.end(activation.token);
      consumer.log.push({
        app,
        action: 'play-canceled',
        stage,
        lease: activation.token.id,
      });
    })
    .onFailure((context) => {
      if (context.stage === 'running') {
        const { failure } = context;
        if (
          failure.kind === 'success-hook-error' ||
          failure.kind === 'success-hook-timeout'
        ) {
          // Chosen policy: only a result that records a started, transferred lease stays owner-held.
          if (failure.result.state === 'playing')
            return present(app, 'message', 'playing, but the view failed');
        }
        player.end(context.activation.token);
      } else if (context.stage === 'prerequisites') {
        player.end(context.activation.token);
      }
      present(app, 'message', 'failed');
    })
    .build();
};

const makeLookup = (app: string) => {
  const { player } = consumer;
  return Action.local<ActionButtonActivation>('lookup')
    .run(async ({ scope }) => {
      // The event turn is over: the lease arrives whenever the test lets it.
      const held = await scope.acquire(
        () =>
          new Promise<Lease>((resolve) =>
            player.pendingAcquires.push(() => resolve(player.begin())),
          ),
        (lease) => player.end(lease),
      );
      consumer.log.push({ app, action: 'lookup-held', lease: held.token.id });
      return held.token.id;
    })
    .onSuccess(({ result }) =>
      present(app, 'message', `looked up with lease ${result}`),
    )
    .build();
};

function resourceAttachFor(app: string) {
  const play = makePlay(app);
  const lookup = makeLookup(app);
  return (view: InstanceView): void => {
    consumer.attachCalls[app] = (consumer.attachCalls[app] ?? 0) + 1;
    consumer.views[app] = view;
    view.watchById('play', ActionButton, (handle) => {
      const binding = handle.bindAction('activate', play);
      binding.subscribe(() => present(app, 'phase', binding.state.phase));
      trace(app, handle, binding);
    });
    view.watchById('lookup', ActionButton, (handle) =>
      trace(app, handle, handle.bindAction('activate', lookup)),
    );
  };
}

// ---------------------------------------------------------------------------------------------
// Scenario `server` (ACT6): the non-playback Archive server action over a test-controlled
// transport. Two rows render one component id with different notes, an upstream Button sits beside
// them in the same surface, and the spec answers every prerequisite and protected request.
// ---------------------------------------------------------------------------------------------

const serverLayout = (surfaceId: string) => [
  { version: 'v0.9', createSurface: { surfaceId, catalogId: CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        {
          id: 'root',
          component: 'Column',
          children: ['upstream-button', 'rows'],
        },
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
      surfaceId,
      value: {
        rows: [
          { id: 'n-1', title: 'Alpha' },
          { id: 'n-2', title: 'Beta' },
        ],
      },
    },
  },
];

function serverAttachFor(app: string) {
  const { lab, environment } = createArchiveLab((noteId, message) => {
    const key = noteId ?? 'input';
    let line = document.querySelector(`[data-note="${app}:${key}"]`);
    if (!line) {
      line = document.createElement('p');
      line.setAttribute('data-note', `${app}:${key}`);
      document.querySelector(`#${app}`)?.append(line);
    }
    line.textContent = wording(message);
    consumer.log.push({
      app,
      action: 'archive-shown',
      noteId: key,
      kind: message.kind,
    });
  });
  consumer.archive[app] = lab;
  const archive = archiveNoteWith(
    (event: ActionButtonActivation) => requireNoteId(event.read('id')),
    environment,
  );
  return (view: InstanceView): void => {
    consumer.attachCalls[app] = (consumer.attachCalls[app] ?? 0) + 1;
    consumer.views[app] = view;
    view.watchById('row-archive', ActionButton, (handle) => {
      const binding = handle.bindAction('activate', archive, {
        subject: () => handle.read('id'),
      });
      trace(app, handle, binding);
    });
  };
}

const layoutFor = (surfaceId: string) =>
  scenario === 'server'
    ? serverLayout(surfaceId)
    : scenario === 'resource'
      ? resourceLayout(surfaceId)
      : scenario === 'async'
        ? asyncLayout(surfaceId)
        : layout(surfaceId);
const attachForScenario = (app: string) =>
  scenario === 'server'
    ? serverAttachFor(app)
    : scenario === 'resource'
      ? resourceAttachFor(app)
      : scenario === 'async'
        ? asyncAttachFor(app)
        : attachFor(app);

function defineApp(app: string): void {
  customElements.define(
    `${app}-app`,
    createA2uiAppElement({
      createSession: () => {
        const session = createMessageSession({
          catalogs: [catalog],
          decoder: a2uiV0_9Decoder,
        });
        session.onSurfaceCreated((surface) => {
          consumer.surfaces[app] = surface;
          surface.onAction.subscribe((action) => {
            consumer.upstream.push({ app, action });
          });
        });
        // Observation only, added after the fixture's own subscription above so that it counts just
        // the element's listeners: wrapping changes nothing the element can see.
        const record = (consumer.sessions[app] ??= {
          created: 0,
          disposed: 0,
          listeners: 0,
        });
        record.created += 1;
        record.listeners = 0;
        (consumer.sessionHistory[app] ??= []).push(session);
        const counted = <T extends (listener: never) => Subscription>(
          subscribe: T,
        ): T =>
          ((listener: never) => {
            record.listeners += 1;
            const subscription = subscribe(listener);
            return {
              // Every call counts, so a second release shows as a negative balance.
              unsubscribe: () => {
                record.listeners -= 1;
                subscription.unsubscribe();
              },
            };
          }) as T;
        session.onSurfaceCreated = counted(
          session.onSurfaceCreated.bind(session),
        );
        session.onSurfaceDeleted = counted(
          session.onSurfaceDeleted.bind(session),
        );
        const dispose = session.dispose.bind(session);
        session.dispose = () => {
          record.disposed += 1;
          dispose();
        };
        return session;
      },
      initialInput: layoutFor(SURFACE_ID),
      surfaceId: SURFACE_ID,
      actions: createLitActions({
        attach: attachForScenario(app),
        onSetupError: (error) => consumer.setupErrors.push(String(error)),
      }),
    }),
  );
}

defineElements(components);
defineApp('one');
defineApp('two');

for (const app of ['one', 'two']) {
  const section = document.querySelector(`#${app}`);
  if (scenario === 'async' || scenario === 'resource') {
    for (const kind of ['phase', 'message']) {
      const line = document.createElement('p');
      line.dataset[kind] = app;
      section?.append(line);
    }
  }
  const element = document.createElement(`${app}-app`);
  element.dataset.app = app;
  section?.append(element);
}
