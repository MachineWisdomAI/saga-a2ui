import { NO_HOST_LINKS } from './content/host-links.js';
import { a2uiV0_9Decoder } from './protocols/a2ui/v0_9/decoder.js';
import { createMessageSession } from './protocols/a2ui/v0_9/session.js';
import { contentViewFromDocument } from './lit/content-view.js';
import { registerLitElements, sagaCatalog } from './lit/integration.js';
import { createSagaAppElement } from './lit/saga-app.js';
import { initialFixture, SURFACE_ID } from './saga-panel/fixture.js';

// Composition root: choose the implementations and connect them explicitly. This page has no
// host, so links cannot be opened and the default content policy (no image host) applies.
const content = contentViewFromDocument(document, NO_HOST_LINKS);
if (!content.ok) throw new Error(content.message);
registerLitElements();
customElements.define(
  'saga-app',
  createSagaAppElement({
    createSession: () => createMessageSession({ catalogs: [sagaCatalog], decoder: a2uiV0_9Decoder }),
    initialInput: initialFixture,
    surfaceId: SURFACE_ID,
    content: content.view,
  }),
);
