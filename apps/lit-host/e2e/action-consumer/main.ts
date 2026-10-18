import { basicCatalog, type LitComponentApi } from '@a2ui/lit/v0_9';
import { Catalog, createFunctionImplementation, type SurfaceModel } from '@a2ui/web_core/v0_9';
import {
  Action,
  type ActionBinding,
  type ActionDefinition,
  type InstanceHandle,
  type InstanceView,
} from '@saga-a2ui/core/actions';
import { a2uiV0_9Decoder, createMessageSession, type IngestResult } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import { createA2uiAppElement, defineElements } from '@saga-a2ui/lit';
import {
  ActionButton,
  actionButtonEntry,
  createLitActions,
  type ActionButtonActivation,
  type ActionButtonEvents,
} from '@saga-a2ui/lit/actions';

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
const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', components, [...basicCatalog.functions.values(), spy]);

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
  stopDiscovery(app: string): void;
  send(app: string, input: unknown): IngestResult;
  /** `getById` on the app's setup view: 'ok', or the message of the error it threw. */
  getById(app: string, id: string): string;
  /** Binds a probe action through the handle of a traced binding: 'ok', or the error message. */
  bindAgain(index: number): string;
  /** The messages that create the surface with the consumer's layout and data. */
  layout(): unknown[];
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
  stopDiscovery: (app) => (stoppers[app] ?? []).forEach((stop) => stop()),
  send: (app, input) => {
    const element = document.querySelector<HTMLElement & { ingest(input: unknown): IngestResult }>(`[data-app="${app}"]`);
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
      .run(() => void consumer.log.push({ app: entry.app, action: 'probe', componentId: entry.componentId }))
      .build();
    trace(entry.app, entry.handle, entry.handle.bindAction('activate', probe));
    return 'ok';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
consumer.layout = () => layout(SURFACE_ID);
window.actionConsumer = consumer;

function requireNoteId(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new Error('this row shows no note');
  return value;
}

// App code: the definitions are built once and shared by every binding that uses them.
const makeToggle = (app: string): ActionDefinition<ActionButtonActivation> =>
  Action.local<ActionButtonActivation>('toggle-details')
    .run(() => void consumer.log.push({ app, action: 'toggle-details' }))
    .build();

const makeMark = (app: string): ActionDefinition<ActionButtonActivation> =>
  Action.local<ActionButtonActivation>('mark')
    .input((event) => event.componentId)
    .run(({ params }) => void consumer.log.push({ app, action: 'mark', componentId: params }))
    .build();

const makeArchive = (app: string): ActionDefinition<ActionButtonActivation> =>
  Action.local<ActionButtonActivation>('archive-note')
    .input((event) => ({ noteId: requireNoteId(event.read('id')), at: event.dataPath }))
    .run(({ params }) => void consumer.log.push({ app, action: 'archive-note', noteId: params.noteId, at: params.at }))
    .build();

const makeSave = (app: string): ActionDefinition<ActionButtonActivation> =>
  Action.local<ActionButtonActivation>('save')
    .run(() => void consumer.log.push({ app, action: 'save' }))
    .build();

function trace(app: string, handle: InstanceHandle<ActionButtonEvents>, binding: ActionBinding): void {
  consumer.bindings.push({ app, componentId: handle.id, dataPath: handle.dataPath, handle, binding });
  binding.subscribe(() =>
    consumer.phases.push(`${app}|${handle.id}|${handle.dataPath}|${binding.id}|${binding.state.phase}`),
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
      view.watchById('save', ActionButton, (handle) => trace(app, handle, handle.bindAction('activate', save)));
      throw new Error('setup failed on purpose');
    }
    consumer.views[app] = view;
    const bind = (id: string, action: ActionDefinition<ActionButtonActivation>) =>
      view.watchById(id, ActionButton, (handle) => trace(app, handle, handle.bindAction('activate', action)));
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
          children: ['details-toggle', 'mark-a', 'mark-b', 'save', 'orphan', 'upstream-button', 'rows'],
        },
        { id: 'details-toggle', component: 'ActionButton', child: 'details-label' },
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
        { id: 'rows', component: 'List', children: { componentId: 'row', path: '/rows' } },
        { id: 'row', component: 'Row', children: ['row-title', 'row-archive'] },
        { id: 'row-title', component: 'Text', text: { path: 'title' } },
        { id: 'row-archive', component: 'ActionButton', child: 'row-archive-label' },
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

function defineApp(app: string): void {
  customElements.define(
    `${app}-app`,
    createA2uiAppElement({
      createSession: () => {
        const session = createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder });
        session.onSurfaceCreated((surface) => {
          consumer.surfaces[app] = surface;
          surface.onAction.subscribe((action) => {
            consumer.upstream.push({ app, action });
          });
        });
        return session;
      },
      initialInput: layout(SURFACE_ID),
      surfaceId: SURFACE_ID,
      actions: createLitActions({
        attach: attachFor(app),
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
  const element = document.createElement(`${app}-app`);
  element.dataset.app = app;
  section?.append(element);
}
