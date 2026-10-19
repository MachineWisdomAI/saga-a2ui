import { Catalog } from '@a2ui/web_core/v0_9';
import type { LitComponentApi } from '@a2ui/lit/v0_9';
import {
  createContentPolicy,
  createFaithfulCardReader,
  createImageConsentScope,
  type ImageEnforcement,
  type LinkOpenOutcome,
} from '@saga-a2ui/components/faithful-card';
import { a2uiV0_9Decoder, createMessageSession, type IngestResult } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { createA2uiAppElement, defineElements, ElementConflictError } from '@saga-a2ui/lit';
import {
  FaithfulCardContentElement,
  FaithfulCardElement,
  faithfulCardEntry,
  provideContentView,
  registerFaithfulCard,
  type ContentView,
} from '@saga-a2ui/lit/faithful-card';

// Test-only page. It mounts FaithfulCards the way an application would, but several in one
// document, each in its own view with its own reader, policy, host callback and consent scope, so
// interleaving, replacement, disposal and revocation can be observed at the network and callback
// boundary. Nothing here is part of an application or view bundle.

export interface CardOptions {
  readonly dialect?: 'commonmark' | 'commonmark-tables-strikethrough';
  readonly maxLength?: number;
  readonly level?: 'standard' | 'strict';
  readonly imageHosts?: readonly string[];
  /** Whether the document demonstrably carries the policy's image restrictions. */
  readonly enforcement?: ImageEnforcement;
  /** How this card's host answers a request to open a link; 'pending' holds each answer until the page calls `settle`. */
  readonly links?: 'opened' | 'denied' | 'unavailable' | 'pending';
  readonly markdown?: string;
}

interface CardHandle {
  readonly element: FaithfulCardContentElement;
  readonly view: ContentView;
  /** Every URL this card's host callback received. */
  readonly linkCalls: string[];
  /** Answers every link request held by a 'pending' host. */
  settle(outcome: LinkOpenOutcome): void;
  /** Replaces the card's content, as an application does when a new answer arrives. */
  set(markdown: unknown, contractVersion?: unknown): void;
  /** Removes the card from the page. */
  remove(): void;
  /** Puts the removed card back. */
  reattach(): void;
}

interface CardAppElement extends HTMLElement {
  ingest(input: unknown): IngestResult;
}

declare global {
  interface Window {
    mountCard?: (id: string, options?: CardOptions) => void;
    cards?: Record<string, CardHandle>;
    cardApp?: () => CardAppElement | null;
    registerAgain?: () => string;
    defineConflicting?: (tagName: string) => string;
    firstDefinitionsKept?: () => boolean;
  }
}

function viewFor(options: CardOptions, linkCalls: string[], held: Array<(outcome: LinkOpenOutcome) => void> = []): ContentView {
  const policy = createContentPolicy({
    level: options.level ?? 'standard',
    imageHosts: options.imageHosts ?? [],
  });
  const reader = createFaithfulCardReader({
    dialect: options.dialect ?? 'commonmark',
    maxLength: options.maxLength ?? 2000,
  });
  if (!policy.ok) throw new Error(policy.failure.message);
  if (!reader.ok) throw new Error(reader.failure.message);
  const links = options.links ?? 'opened';
  return {
    reader: reader.reader,
    policy: policy.policy,
    hostLinks: {
      open: (url) => {
        linkCalls.push(url);
        if (links !== 'pending') return Promise.resolve<LinkOpenOutcome>(links);
        return new Promise<LinkOpenOutcome>((resolve) => held.push(resolve));
      },
    },
    imageEnforcement: options.enforcement ?? 'established',
    consent: createImageConsentScope(),
  };
}

registerFaithfulCard();

const stage = document.querySelector<HTMLElement>('#stage');
if (!stage) throw new Error('the fixture page has no stage');
const cards: Record<string, CardHandle> = {};
window.cards = cards;

window.mountCard = (id, options = {}) => {
  const host = document.createElement('section');
  host.dataset.cardId = id;
  host.setAttribute('aria-label', `Card ${id}`);
  const linkCalls: string[] = [];
  const held: Array<(outcome: LinkOpenOutcome) => void> = [];
  const view = viewFor(options, linkCalls, held);
  // The view answers the cards inside its host. The host is the view's owner: it ends the view on removal.
  let endView = provideContentView(host, view);
  const element = document.createElement('saga-faithful-card-content') as FaithfulCardContentElement;
  host.append(element);
  element.contractVersion = 1;
  element.markdown = options.markdown ?? '';
  stage.append(host);
  cards[id] = {
    element,
    view,
    linkCalls,
    settle(outcome) {
      for (const resolve of held.splice(0)) resolve(outcome);
    },
    set(markdown, contractVersion = 1) {
      element.contractVersion = contractVersion;
      element.markdown = markdown;
    },
    remove() {
      endView();
      host.remove();
    },
    reattach() {
      endView = provideContentView(host, view);
      stage.append(host);
    },
  };
};

// The same component through a real A2UI catalog: the application's own catalog lists the optional
// entry, a session binds the card's two values to the data model, and the app element is the view.
const CATALOG_ID = 'https://fixture.test/catalogs/faithful-card/v1';
const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', [faithfulCardEntry]);
const catalogView = viewFor({ dialect: 'commonmark-tables-strikethrough', maxLength: 20_000, level: 'strict' }, []);
class CardApp extends createA2uiAppElement({
  createSession: () => createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder }),
  initialInput: [
    { version: 'v0.9', createSurface: { surfaceId: 'card', catalogId: CATALOG_ID } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card',
        components: [
          { id: 'root', component: 'FaithfulCard', contractVersion: { path: '/contractVersion' }, markdown: { path: '/markdown' } },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId: 'card', value: { contractVersion: 1, markdown: 'Waiting.' } } },
  ],
  surfaceId: 'card',
}) {
  #endView?: () => void;
  override connectedCallback() {
    this.#endView = provideContentView(this, catalogView);
    super.connectedCallback();
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#endView?.();
  }
}
customElements.define('card-app', CardApp);
window.cardApp = () => document.querySelector<CardAppElement>('card-app');

window.registerAgain = () => {
  registerFaithfulCard();
  return 'repeated';
};
window.defineConflicting = (tagName) => {
  try {
    defineElements([{ tagName, element: class OtherImplementation extends HTMLElement {} }]);
    return 'defined';
  } catch (error) {
    return error instanceof ElementConflictError ? 'conflict' : String(error);
  }
};
window.firstDefinitionsKept = () =>
  customElements.get('saga-faithful-card') === FaithfulCardElement &&
  customElements.get('saga-faithful-card-content') === FaithfulCardContentElement;
