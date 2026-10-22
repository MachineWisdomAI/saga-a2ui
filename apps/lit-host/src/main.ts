import { NO_HOST_LINKS } from '@saga-a2ui/core/host-links';
import {
  a2uiV0_9Decoder,
  createMessageSession,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { contentViewFromDocument } from './lit/content-view.js';
import { registerLitElements, sagaCatalog } from './lit/integration.js';
import { createSagaAppElement } from './lit/saga-app.js';
import { initialFixture } from './saga-panel/fixture.js';

// Composition root: choose the implementations and connect them explicitly. This page has no
// host, so links cannot be opened and the default content policy (no image host) applies.
const content = contentViewFromDocument(document, NO_HOST_LINKS);
if (!content.ok) throw new Error(content.message);
registerLitElements();
customElements.define(
  'saga-app',
  createSagaAppElement({
    createSession: () =>
      createMessageSession({
        catalogs: [sagaCatalog],
        decoder: a2uiV0_9Decoder,
      }),
    layout: initialFixture,
    content: content.view,
  }),
);
