import { A2uiSurface, createComponentImplementation, type ReactCatalogComponent } from '@a2ui/react/v0_9';
import { Catalog, type SurfaceModel } from '@a2ui/web_core/v0_9';
import { basicCatalog, ColumnApi, TextApi } from '@a2ui/web_core/v0_9/basic_catalog';
import {
  createContentPolicy,
  createFaithfulCardReader,
  type HostLinks,
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

export const CATALOG_ID = 'https://saga-a2ui.local/catalogs/react-faithful-card/v1';
export const SURFACE_ID = 'cards';

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
  'An image reference ![chart](https://images.example.com/chart.png) stays inert.',
  '',
  '```',
  'code block line',
  '```',
].join('\n');

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
      value: { first: { version: 1, markdown: FIRST }, second: 'Second card with [another](https://docs.example.com/second).' },
    },
  },
];

export interface ReactFaithfulCardConsumer {
  /** Every URL the host was asked to open, in order. */
  readonly requests: string[];
  /** Answers for each request made while the host's answer is `pending`, in order. */
  readonly pending: ((outcome: LinkOpenOutcome) => void)[];
  readonly identities: Record<string, string>;
  send(input: unknown): IngestResult;
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
const reader = createFaithfulCardReader({ dialect: 'commonmark-tables-strikethrough', maxLength: 20_000 });
const policy = createContentPolicy({ level, imageHosts: ['images.example.com'] });
if (!reader.ok || !policy.ok) throw new Error('the page settings are invalid');
const view: FaithfulCardView = { reader: reader.reader, policy: policy.policy, hostLinks };

interface OpenSession {
  readonly session: MessageSession<ReactCatalogComponent>;
  readonly surface: SurfaceModel<ReactCatalogComponent>;
}

function openSession(): OpenSession {
  const session = createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder });
  let surface: SurfaceModel<ReactCatalogComponent> | undefined;
  session.onSurfaceCreated((created) => {
    surface = created;
  });
  const result = session.ingest(layout());
  if (!result.ok || !surface) throw new Error('the layout was not accepted');
  return { session, surface };
}

let current = openSession();
let root: Root | undefined;

function container(): HTMLElement {
  const element = document.getElementById('root');
  if (!element) throw new Error('no root element');
  return element;
}

function render(): void {
  root?.render(
    createElement(
      StrictMode,
      null,
      createElement(FaithfulCardProvider, { view, children: createElement(A2uiSurface, { surface: current.surface }) }),
    ),
  );
}

const consumer: ReactFaithfulCardConsumer = {
  requests,
  pending,
  identities: { ...__REACT_FAITHFUL_CARD_IDENTITIES__, runtimeReact: reactVersion, runtimeReactDom: reactDomVersion },
  send: (input) => current.session.ingest(input),
  unmount: () => {
    root?.unmount();
    root = undefined;
  },
  mount: () => {
    root = createRoot(container());
    render();
  },
};
window.reactFaithfulCard = consumer;
consumer.mount();
