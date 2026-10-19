import { A2uiSurface, createComponentImplementation, type ReactCatalogComponent } from '@a2ui/react/v0_9';
import { Catalog, type SurfaceModel } from '@a2ui/web_core/v0_9';
import { basicCatalog, ColumnApi, TextApi } from '@a2ui/web_core/v0_9/basic_catalog';
import {
  createContentPolicy,
  createFaithfulCardReader,
  createImageConsentScope,
  type HostLinks,
  type ImageConsentScope,
  type ImageEnforcement,
  type LinkOpenOutcome,
} from '@saga-a2ui/components/faithful-card';
import { a2uiV0_9Decoder, createMessageSession, type MessageSession } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { faithfulCardEntry } from './catalog.js';
import { FaithfulCardProvider, type FaithfulCardView } from './view.js';

// Test-only. A synthetic application over the published `@a2ui/react` runtime: its own catalog
// (Column and Text, built from the upstream contracts the way an application builds its own, plus
// the opt-in `faithfulCardEntry`), a real message session, and a trusted view whose host-link
// adapter records what it was asked and answers as the test decides.

export const CATALOG_ID = 'https://saga-a2ui.local/catalogs/react-faithful-card/v1';
export const SURFACE_ID = 'cards';

type ChildReference = string | { readonly id: string; readonly basePath: string };

function childrenOf(buildChild: (id: string, basePath?: string) => ReactNode, value: unknown): ReactNode[] {
  const list = Array.isArray(value) ? (value as ChildReference[]) : [];
  return list.map((child) => (typeof child === 'string' ? buildChild(child) : buildChild(child.id, child.basePath)));
}

const Text = createComponentImplementation(TextApi, ({ props }) => createElement('span', null, String(props.text ?? '')));
const Column = createComponentImplementation(ColumnApi, ({ props, buildChild }) =>
  createElement('div', { 'data-layout': 'column' }, ...childrenOf(buildChild, props.children)),
);

export const catalog = new Catalog<ReactCatalogComponent>(CATALOG_ID, 'v0.9', [Text, Column, faithfulCardEntry], [
  ...basicCatalog.functions.values(),
]);

/** One card of a layout: its id and the two supplied values, each a literal or a data-model binding. */
export interface CardSpec {
  readonly id: string;
  readonly markdown: unknown;
  readonly contractVersion?: unknown;
}

/** The messages that create a surface whose root column holds the given cards. */
export function layout(cards: readonly CardSpec[], surfaceId = SURFACE_ID): unknown[] {
  return [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: CATALOG_ID } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: cards.map((card) => card.id) },
          ...cards.map((card) => ({
            id: card.id,
            component: 'FaithfulCard',
            contractVersion: card.contractVersion ?? 1,
            markdown: card.markdown,
          })),
        ],
      },
    },
  ];
}

export function dataUpdate(value: unknown, surfaceId = SURFACE_ID): unknown[] {
  return [{ version: 'v0.9', updateDataModel: { surfaceId, value } }];
}

export interface Session {
  readonly surface: SurfaceModel<ReactCatalogComponent>;
  ingest(input: unknown): void;
  /** The result of ingesting, for tests of what the session refuses. */
  tryIngest(input: unknown): { readonly ok: boolean };
  dispose(): void;
}

/** A real message session over the application's catalog, with the layout already ingested. */
export function openSession(messages: unknown[]): Session {
  const session: MessageSession<ReactCatalogComponent> = createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder });
  let surface: SurfaceModel<ReactCatalogComponent> | undefined;
  session.onSurfaceCreated((created) => {
    surface = created;
  });
  const ingest = (input: unknown): void => {
    const result = session.ingest(input);
    if (!result.ok) throw new Error(`ingest failed: ${result.failure.message}`);
  };
  ingest(messages);
  if (!surface) throw new Error('the layout created no surface');
  return { surface, ingest, tryIngest: (input) => session.ingest(input), dispose: () => session.dispose() };
}

export interface TrustedOptions {
  readonly level?: 'standard' | 'strict';
  readonly blockedPresentation?: 'placeholder' | 'inert-text';
  readonly imageHosts?: readonly string[];
  readonly dialect?: 'commonmark' | 'commonmark-tables-strikethrough';
  readonly maxLength?: number;
  /** Whether the document demonstrably carries the policy's image restrictions. Default: established. */
  readonly enforcement?: ImageEnforcement;
  /** What the host answers when asked to open a link. A function is called for each request. */
  readonly answer?: LinkOpenOutcome | 'pending' | 'reject' | ((url: string) => Promise<LinkOpenOutcome>);
}

export interface Trusted {
  readonly view: FaithfulCardView;
  /** Every URL the host was asked to open, in order. */
  readonly requests: string[];
  /** Answers for each request made while the host's answer was `pending`, in order. */
  readonly pending: Array<(outcome: LinkOpenOutcome) => void>;
  /** The view's consent scope, which the application owns: tests revoke and retire it as an application does. */
  readonly consent: ImageConsentScope;
}

/** Trusted settings as an application builds them once. */
export function trusted(options: TrustedOptions = {}): Trusted {
  const reader = createFaithfulCardReader({ dialect: options.dialect ?? 'commonmark-tables-strikethrough', maxLength: options.maxLength ?? 5000 });
  if (!reader.ok) throw new Error(`unexpected reader failure: ${reader.failure.kind}`);
  const policy = createContentPolicy({
    level: options.level ?? 'standard',
    ...(options.imageHosts === undefined ? {} : { imageHosts: [...options.imageHosts] }),
    ...(options.blockedPresentation === undefined ? {} : { blockedPresentation: options.blockedPresentation }),
  });
  if (!policy.ok) throw new Error(`unexpected policy failure: ${policy.failure.kind}`);
  const requests: string[] = [];
  const pending: Array<(outcome: LinkOpenOutcome) => void> = [];
  const answer = options.answer ?? 'opened';
  const hostLinks: HostLinks = {
    open(url) {
      requests.push(url);
      if (answer === 'pending') return new Promise<LinkOpenOutcome>((resolve) => void pending.push(resolve));
      if (answer === 'reject') return Promise.reject(new Error('the host adapter failed'));
      if (typeof answer === 'function') return answer(url);
      return Promise.resolve(answer);
    },
  };
  const consent = createImageConsentScope();
  return {
    view: { reader: reader.reader, policy: policy.policy, hostLinks, imageEnforcement: options.enforcement ?? 'established', consent },
    consent,
    requests,
    pending,
  };
}

/** A surface under a provider, as an application mounts it. */
export function surfaceUnder(view: FaithfulCardView, surface: SurfaceModel<ReactCatalogComponent>): ReactElement {
  return createElement(FaithfulCardProvider, { view, children: createElement(A2uiSurface, { surface }) });
}
