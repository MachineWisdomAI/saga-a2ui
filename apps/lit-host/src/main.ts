import { a2uiV0_9Decoder } from './protocols/a2ui/v0_9/decoder.js';
import { createMessageSession } from './protocols/a2ui/v0_9/session.js';
import { registerLitElements, sagaCatalog } from './lit/integration.js';
import { createSagaAppElement } from './lit/saga-app.js';
import { initialFixture, SURFACE_ID } from './saga-panel/fixture.js';

// Composition root: choose the implementations and connect them explicitly.
registerLitElements();
customElements.define(
  'saga-app',
  createSagaAppElement({
    createSession: () => createMessageSession({ catalogs: [sagaCatalog], decoder: a2uiV0_9Decoder }),
    initialInput: initialFixture,
    surfaceId: SURFACE_ID,
  }),
);
