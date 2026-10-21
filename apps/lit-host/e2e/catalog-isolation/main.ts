import {
  a2uiV0_9Decoder,
  createMessageSession,
  type IngestResult,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import {
  createA2uiAppElement,
  defineElements,
  ElementConflictError,
} from '@saga-a2ui/lit';
import {
  answerCardData,
  answerSurface,
  ANSWER_SURFACE_ID,
} from '../../src/answer-card/presentation.js';
import { NO_HOST_LINKS } from '@saga-a2ui/components/faithful-card';
import {
  AnswerCardElement,
  answerCatalog,
  registerAnswerElements,
} from '../../src/lit/answer-card.js';
import { contentViewFromDocument } from '../../src/lit/content-view.js';
import {
  registerLitElements,
  SagaPanelElement,
  sagaCatalog,
} from '../../src/lit/integration.js';
import { createSagaAppElement } from '../../src/lit/saga-app.js';
import { initialFixture, SURFACE_ID } from '../../src/saga-panel/fixture.js';

// Test-only page: the panel application and the answer application, each with its own catalog,
// session and Lit element, mounted side by side in one document and one custom-element registry.

interface AnswerAppElement extends HTMLElement {
  ingest(input: unknown): IngestResult;
}

declare global {
  interface Window {
    answerApp?: () => AnswerAppElement | null;
    /** Tries to bind a tag another catalog already owns to a different constructor. */
    defineConflicting?: (tagName: string) => string;
    /** Repeats the panel catalog's own setup. */
    repeatSetup?: () => void;
    /** Whether each catalog's tag is still bound to the constructor that first defined it. */
    firstDefinitionsKept?: () => boolean;
  }
}

const content = contentViewFromDocument(document, NO_HOST_LINKS);
if (!content.ok) throw new Error(content.message);

registerLitElements();
registerAnswerElements();
customElements.define(
  'saga-app',
  createSagaAppElement({
    createSession: () =>
      createMessageSession({
        catalogs: [sagaCatalog],
        decoder: a2uiV0_9Decoder,
      }),
    initialInput: initialFixture,
    surfaceId: SURFACE_ID,
    content: content.view,
  }),
);
customElements.define(
  'answer-app',
  createA2uiAppElement({
    createSession: () =>
      createMessageSession({
        catalogs: [answerCatalog],
        decoder: a2uiV0_9Decoder,
      }),
    initialInput: [...answerSurface, ...answerCardData({ kind: 'waiting' })],
    surfaceId: ANSWER_SURFACE_ID,
  }),
);

window.answerApp = () => document.querySelector<AnswerAppElement>('answer-app');
window.repeatSetup = registerLitElements;
window.defineConflicting = (tagName) => {
  try {
    defineElements([
      { tagName, element: class OtherImplementation extends HTMLElement {} },
    ]);
    return 'defined';
  } catch (error) {
    return error instanceof ElementConflictError ? 'conflict' : String(error);
  }
};
window.firstDefinitionsKept = () =>
  customElements.get('saga-panel') === SagaPanelElement &&
  customElements.get('answer-card') === AnswerCardElement;
