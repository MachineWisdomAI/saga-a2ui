import { A2uiSurface, createComponentImplementation, type ReactCatalogComponent } from '@a2ui/react/v0_9';
import { Catalog, type SurfaceModel } from '@a2ui/web_core/v0_9';
import { basicCatalog, ColumnApi, TextApi } from '@a2ui/web_core/v0_9/basic_catalog';
import {
  createContentPolicy,
  createFaithfulCardReader,
  createImageConsentScope,
  establishImageEnforcement,
  type ContentPolicy,
  type HostLinks,
  type ImageConsentScope,
  type LinkOpenOutcome,
} from '@saga-a2ui/components/faithful-card';
import { a2uiV0_9Decoder, createMessageSession, type IngestResult, type MessageSession } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { faithfulCardEntry, FaithfulCardProvider, type FaithfulCardView } from '@saga-a2ui/react/faithful-card';
import '@saga-a2ui/react/faithful-card.css';
import { createElement, StrictMode, version as reactVersion, type ReactNode } from 'react';
import { version as reactDomVersion } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

// Test-only page: a synthetic React application over the published `@a2ui/react` with its own
// catalog (Column and Text from the upstream contracts, plus the optional FaithfulCard entry) and a
// trace the browser spec reads. It uses only the public exports of the SDK packages, including the
// explicitly imported stylesheet. The bundle is React's development build under Strict Mode, as in
// an application under development. `?level=strict` and `?host=denied|unavailable|failed|pending`
// choose among this application's own compiled-in settings; nothing in an answer can.
//
// Images. The page does what an application does for its content policy: it puts the policy's
// derived Content-Security-Policy in the document before anything is rendered, establishes image
// enforcement from the policy values the document actually carries, and owns one consent scope per
// view. `?csp=absent` leaves the document without the policy, so every image stays inert.
// `?second=1` mounts a second, independent view (its own session, provider and consent scope) in
// `#root-b`, for the cases that interleave views.

export const CATALOG_ID = 'https://saga-a2ui.local/catalogs/react-faithful-card/v1';
export const SURFACE_ID = 'cards';
export const SECOND_SURFACE_ID = 'cards-b';

declare const __REACT_FAITHFUL_CARD_IDENTITIES__: Record<string, string>;

type ChildReference = string | { readonly id: string; readonly basePath: string };

function childrenOf(buildChild: (id: string, basePath?: string) => ReactNode, value: unknown): ReactNode[] {
  const list = Array.isArray(value) ? (value as ChildReference[]) : [];
  return list.map((child) => (typeof child === 'string' ? buildChild(child) : buildChild(child.id, child.basePath)));
}

const Text = createComponentImplementation(TextApi, ({ props }) => createElement('p', { 'data-testid': 'app-text' }, String(props.text ?? '')));
const Column = createComponentImplementation(ColumnApi, ({ props, buildChild }) =>
  createElement('div', { 'data-layout': 'column' }, ...childrenOf(buildChild, props.children)),
);
const catalog = new Catalog<ReactCatalogComponent>(CATALOG_ID, 'v0.9', [Text, Column, faithfulCardEntry], [...basicCatalog.functions.values()]);

const FIRST = [
  '# Reading the evidence',
  '',
  'This paragraph carries **strong** and *emphasised* text, `inline code`, and a [guide](https://docs.example.com/guide?a=1) that the host may open.',
  '',
  'مرحبا بالعالم — هذه فقرة عربية تُقرأ من اليمين إلى اليسار.',
  '',
  '> A quotation that keeps its own rule.',
  '',
  '| Source | Year | Identifier |',
  '| :--- | ---: | --- |',
  `| First | 1999 | ${'IDENTIFIER'.repeat(7)} |`,
  '',
  'An unbroken identifier: ' + 'abcdefghij'.repeat(12),
  '',
  'An image ![chart](https://images.example.com/chart.png) appears where the policy permits it.',
  '',
  '```',
  'code block line',
  '```',
].join('\n');

/** The second card: another permitted image, and the references that must stay inert text. */
const SECOND =
  'Second card with [another](https://docs.example.com/second) and ![other](https://images.example.com/other.png). ' +
  'Inert: ![inline](data:image/png;base64,iVBORw0KGgo=) ![object](blob:https://images.example.com/0f8fad5b) ' +
  '![elsewhere](https://elsewhere.example.net/x.png) ![plain](http://images.example.com/plain.png) ' +
  '![redirected](https://images.example.com/redirect.png).';

const layout = (): unknown[] => [
  { version: 'v0.9', createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: SURFACE_ID,
      components: [
        { id: 'root', component: 'Column', children: ['first', 'second'] },
        { id: 'first', component: 'FaithfulCard', contractVersion: { path: '/first/version' }, markdown: { path: '/first/markdown' } },
        { id: 'second', component: 'FaithfulCard', contractVersion: 1, markdown: { path: '/second' } },
      ],
    },
  },
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: SURFACE_ID,
      value: { first: { version: 1, markdown: FIRST }, second: SECOND },
    },
  },
];

const secondLayout = (): unknown[] => [
  { version: 'v0.9', createSurface: { surfaceId: SECOND_SURFACE_ID, catalogId: CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: SECOND_SURFACE_ID,
      components: [
        { id: 'root', component: 'Column', children: ['only'] },
        { id: 'only', component: 'FaithfulCard', contractVersion: 1, markdown: { path: '/only' } },
      ],
    },
  },
  {
    version: 'v0.9',
    updateDataModel: { surfaceId: SECOND_SURFACE_ID, value: { only: 'The other view ![third](https://images.example.com/third.png) and [a link](https://docs.example.com/third).' } },
  },
];

export interface ReactFaithfulCardConsumer {
  /** Every URL the host was asked to open, in order. */
  readonly requests: string[];
  /** Answers for each request made while the host's answer is `pending`, in order. */
  readonly pending: ((outcome: LinkOpenOutcome) => void)[];
  readonly identities: Record<string, string>;
  /** The first view's consent scope, which the application (this page) owns and the spec revokes as an application would. */
  readonly consent: ImageConsentScope;
  /** The second view's, present only with `?second=1`. */
  readonly secondConsent: ImageConsentScope | undefined;
  /** Every Content-Security-Policy value the document carries. */
  readonly documentPolicies: string[];
  /** The policy value the content policy derives, which the document must carry exactly. */
  readonly derivedPolicy: string;
  send(input: unknown): IngestResult;
  sendSecond(input: unknown): IngestResult;
  unmount(): void;
  mount(): void;
}

declare global {
  interface Window {
    reactFaithfulCard: ReactFaithfulCardConsumer;
  }
}

const params = new URLSearchParams(location.search);
const level = params.get('level') === 'strict' ? 'strict' : 'standard';
const hostAnswer = params.get('host') ?? 'opened';

const requests: string[] = [];
const pending: ((outcome: LinkOpenOutcome) => void)[] = [];
const hostLinks: HostLinks = {
  open(url) {
    requests.push(url);
    if (hostAnswer === 'pending') return new Promise<LinkOpenOutcome>((resolve) => void pending.push(resolve));
    if (hostAnswer === 'denied' || hostAnswer === 'unavailable' || hostAnswer === 'failed') return Promise.resolve(hostAnswer);
    return Promise.resolve<LinkOpenOutcome>('opened');
  },
};

// The application's trusted settings, built once.
const readerResult = createFaithfulCardReader({ dialect: 'commonmark-tables-strikethrough', maxLength: 20_000 });
const policyResult = createContentPolicy({ level, imageHosts: ['images.example.com'] });
if (!readerResult.ok || !policyResult.ok) throw new Error('the page settings are invalid');
const reader = readerResult.reader;
const policy = policyResult.policy;

/** The restrictions go into the document before any card is rendered, as an application's own page would carry them. */
function carryPolicy(derived: ContentPolicy): void {
  if (params.get('csp') === 'absent') return;
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = derived.resource.contentSecurityPolicy;
  document.head.append(meta);
}
carryPolicy(policy);
const documentPolicies = Array.from(document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]'), (meta) => meta.getAttribute('content') ?? '');

/** One view: the trusted settings, with the enforcement the document demonstrates and its own consent scope. */
function viewWithScope(): { readonly view: FaithfulCardView; readonly consent: ImageConsentScope } {
  const consent = createImageConsentScope();
  return {
    consent,
    view: {
      reader,
      policy,
      hostLinks,
      imageEnforcement: establishImageEnforcement(policy, documentPolicies),
      consent,
    },
  };
}
const first = viewWithScope();
const second = params.get('second') === '1' ? viewWithScope() : undefined;

interface OpenSession {
  readonly session: MessageSession<ReactCatalogComponent>;
  readonly surface: SurfaceModel<ReactCatalogComponent>;
}

function openSession(messages: unknown[]): OpenSession {
  const session = createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder });
  let surface: SurfaceModel<ReactCatalogComponent> | undefined;
  session.onSurfaceCreated((created) => {
    surface = created;
  });
  const result = session.ingest(messages);
  if (!result.ok || !surface) throw new Error('the layout was not accepted');
  return { session, surface };
}

const currentFirst = openSession(layout());
const currentSecond = second === undefined ? undefined : openSession(secondLayout());
const roots = new Map<string, Root>();

function container(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`no ${id} element`);
  return element;
}

function render(id: string, view: FaithfulCardView, surface: SurfaceModel<ReactCatalogComponent>): void {
  roots
    .get(id)
    ?.render(createElement(StrictMode, null, createElement(FaithfulCardProvider, { view, children: createElement(A2uiSurface, { surface }) })));
}

const consumer: ReactFaithfulCardConsumer = {
  requests,
  pending,
  identities: { ...__REACT_FAITHFUL_CARD_IDENTITIES__, runtimeReact: reactVersion, runtimeReactDom: reactDomVersion },
  consent: first.consent,
  secondConsent: second?.consent,
  documentPolicies,
  derivedPolicy: policy.resource.contentSecurityPolicy,
  send: (input) => currentFirst.session.ingest(input),
  sendSecond: (input) => {
    if (currentSecond === undefined) throw new Error('the second view is not mounted; use ?second=1');
    return currentSecond.session.ingest(input);
  },
  unmount: () => {
    for (const root of roots.values()) root.unmount();
    roots.clear();
  },
  mount: () => {
    roots.set('root', createRoot(container('root')));
    render('root', first.view, currentFirst.surface);
    if (second !== undefined && currentSecond !== undefined) {
      roots.set('root-b', createRoot(container('root-b')));
      render('root-b', second.view, currentSecond.surface);
    }
  },
};
window.reactFaithfulCard = consumer;
consumer.mount();
