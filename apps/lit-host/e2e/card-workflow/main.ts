import { basicCatalog, type LitComponentApi } from '@a2ui/lit/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import {
  createContentPolicy,
  createFaithfulCardReader,
  createImageConsentScope,
  type LinkOpenOutcome,
} from '@saga-a2ui/components/faithful-card';
import { a2uiV0_9Decoder, createMessageSession, type IngestResult } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { createA2uiAppElement, defineElements } from '@saga-a2ui/lit';
import { ActionButton, actionButtonEntry, createLitActions, type ActionButtonActivation } from '@saga-a2ui/lit/actions';
import { faithfulCardEntry, provideContentView, registerFaithfulCard, type ContentView } from '@saga-a2ui/lit/faithful-card';
import { archiveNoteWith, requireNoteId } from '../archive-fixture/archive.js';
import { createArchiveLab, wording, type ArchiveLab } from '../archive-fixture/lab.js';

// Test-only page: the optional FaithfulCard and an application-authored protected control in one
// A2UI surface (CARD1). Each row of a list renders a title, a FaithfulCard that shows the row's
// description, and an ActionButton the application bound to the Archive server action through
// the completed adapter contract. The card and the control are separate catalog components with
// separate owners: the card only shows Markdown under the view's trusted settings; the control's
// only way to act is the definition the application bound to its own rendered instance. The page
// uses only the public exports of the SDK packages and is never part of an app or view bundle.
//
// The page's first instance (`window.cardWorkflow`, Strict, in #one) is the CARD1 composition. CARD2
// adds `window.cardInstances.add`, which mounts further instances in the same document: each has its
// own element, view (trusted policy, host callback, consent scope), Archive environment and binding,
// so interleaved instances can be observed without sharing anything but the catalog.

const CATALOG_ID = 'https://saga-a2ui.local/catalogs/card-workflow/v1';
const SURFACE_ID = 'episodes';
const IMAGE_HOST = 'images.example.com';

const upstream = (name: string): LitComponentApi => {
  const component = basicCatalog.components.get(name);
  if (!component) throw new Error(`the basic catalog has no ${name}`);
  return component;
};
const components: LitComponentApi[] = [upstream('Text'), upstream('Column'), upstream('List'), faithfulCardEntry, actionButtonEntry];
const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', components, [...basicCatalog.functions.values()]);

export interface CardWorkflow {
  /** The test-controlled environment of the Archive server action: prerequisites, transport and presentation. */
  readonly archive: ArchiveLab;
  /** Every URL the view's host callback received. */
  readonly linkCalls: string[];
  /** Protocol actions the surface dispatched. Neither card content nor the bound control may add one. */
  readonly upstream: unknown[];
  /** How many times application setup ran for a presented surface, and the errors it reported. */
  readonly setup: { attached: number; errors: string[] };
  /** The trusted settings the one view gives its cards; the page that observes a retirement signal calls its consent scope. */
  readonly view: ContentView;
  send(input: unknown): IngestResult;
}

/** The trusted policy one instance gives its cards. */
export interface InstanceOptions {
  readonly level: 'standard' | 'strict';
  readonly imageHosts: readonly string[];
}

export interface CardInstances {
  /** Mounts another instance, `<section id="inst-NAME">` holding its own `<episodes-app-NAME>`. */
  add(name: string, options: InstanceOptions): CardWorkflow;
  /** The instance added under `name`, or the page's first instance for "one". */
  get(name: string): CardWorkflow | undefined;
}

declare global {
  interface Window {
    cardWorkflow: CardWorkflow;
    cardInstances: CardInstances;
  }
}

/** The surface: one list; each row repeats the same component ids with its own data scope. */
const surface = [
  { version: 'v0.9', createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: SURFACE_ID,
      components: [
        { id: 'root', component: 'List', children: { componentId: 'row', path: '/rows' } },
        { id: 'row', component: 'Column', children: ['row-title', 'row-card', 'row-archive'] },
        { id: 'row-title', component: 'Text', text: { path: 'title' } },
        {
          id: 'row-card',
          component: 'FaithfulCard',
          contractVersion: { path: 'contractVersion' },
          markdown: { path: 'description' },
        },
        { id: 'row-archive', component: 'ActionButton', child: 'row-archive-label' },
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
          { id: 'n-1', title: 'Alpha', contractVersion: 1, description: 'Alpha description.' },
          { id: 'n-2', title: 'Beta', contractVersion: 1, description: 'Beta description.' },
        ],
      },
    },
  },
];

defineElements(components);
registerFaithfulCard();

/** Builds one instance: its element definition, view, Archive environment and binding, mounted in `container`. */
function createInstance(tag: string, container: HTMLElement, options: InstanceOptions): CardWorkflow {
  const linkCalls: string[] = [];
  const reader = createFaithfulCardReader({ dialect: 'commonmark-tables-strikethrough', maxLength: 20_000 });
  const policy = createContentPolicy({ level: options.level, imageHosts: options.imageHosts });
  if (!reader.ok) throw new Error(reader.failure.message);
  if (!policy.ok) throw new Error(policy.failure.message);
  const view: ContentView = {
    reader: reader.reader,
    policy: policy.policy,
    hostLinks: {
      open: (url) => {
        linkCalls.push(url);
        return Promise.resolve<LinkOpenOutcome>('opened');
      },
    },
    imageEnforcement: 'established',
    consent: createImageConsentScope(),
  };

  const { lab, environment } = createArchiveLab((noteId, message) => {
    const key = noteId ?? 'input';
    let line = container.querySelector(`[data-note="${key}"]`);
    if (!line) {
      line = document.createElement('p');
      line.setAttribute('data-note', key);
      container.append(line);
    }
    line.textContent = wording(message);
  });
  const archive = archiveNoteWith((event: ActionButtonActivation) => requireNoteId(event.read('id')), environment);

  const workflow: CardWorkflow = {
    archive: lab,
    linkCalls,
    upstream: [],
    setup: { attached: 0, errors: [] },
    view,
    send: (input) => {
      const element = container.querySelector<HTMLElement & { ingest(input: unknown): IngestResult }>(tag);
      if (!element) throw new Error('the app is not mounted');
      return element.ingest(input);
    },
  };

  class EpisodesApp extends createA2uiAppElement({
    createSession: () => {
      const session = createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder });
      session.onSurfaceCreated((created) => created.onAction.subscribe((action) => void workflow.upstream.push(action)));
      return session;
    },
    initialInput: surface,
    surfaceId: SURFACE_ID,
    actions: createLitActions({
      attach: (actions) => {
        workflow.setup.attached += 1;
        actions.watchById('row-archive', ActionButton, (handle) => {
          handle.bindAction('activate', archive, { subject: () => handle.read('id') });
        });
      },
      onSetupError: (error) => workflow.setup.errors.push(String(error)),
    }),
  }) {
    #endView?: () => void;
    override connectedCallback() {
      this.#endView = provideContentView(this, view);
      super.connectedCallback();
    }
    override disconnectedCallback() {
      super.disconnectedCallback();
      this.#endView?.();
      this.#endView = undefined;
    }
  }
  customElements.define(tag, EpisodesApp);
  container.prepend(document.createElement(tag));
  return workflow;
}

const first = document.querySelector<HTMLElement>('#one');
if (!first) throw new Error('the fixture page has no #one');
window.cardWorkflow = createInstance('episodes-app', first, { level: 'strict', imageHosts: [IMAGE_HOST] });

const added = new Map<string, CardWorkflow>();
window.cardInstances = {
  add(name, options) {
    const section = document.createElement('section');
    section.id = `inst-${name}`;
    document.body.append(section);
    const workflow = createInstance(`episodes-app-${name}`, section, options);
    added.set(name, workflow);
    return workflow;
  },
  get: (name) => (name === 'one' ? window.cardWorkflow : added.get(name)),
};
