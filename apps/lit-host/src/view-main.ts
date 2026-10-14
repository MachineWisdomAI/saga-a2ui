import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { registerLitElements, sagaCatalog } from './lit/integration.js';
import { createSagaAppElement } from './lit/saga-app.js';
import { connectEpisodeView } from './mcp/view.js';
import { a2uiV0_9Decoder } from './protocols/a2ui/v0_9/decoder.js';
import { createMessageSession } from './protocols/a2ui/v0_9/session.js';
import { panelSurface, SURFACE_ID } from './saga-panel/fixture.js';

// Composition root of the MCP Apps view (built into one HTML resource by vite.view.config.ts).
// It contains no server code: data arrives only through the host's bridge.
registerLitElements();
customElements.define(
  'saga-app',
  createSagaAppElement({
    createSession: () => createMessageSession({ catalogs: [sagaCatalog], decoder: a2uiV0_9Decoder }),
    initialInput: panelSurface,
    surfaceId: SURFACE_ID,
  }),
);

const problem = document.querySelector<HTMLElement>('[data-testid="view-problem"]');
if (!problem) throw new Error('view.html has no problem element');

await connectEpisodeView({
  app: new App({ name: 'saga-a2ui-episode-view', version: '0.0.0' }),
  // The host window is the only permitted peer; the transport checks `event.source`.
  transport: new PostMessageTransport(window.parent, window.parent),
  deliver: (input) =>
    window.sagaSend?.(input) ?? {
      ok: false,
      failure: { kind: 'rejected', message: 'The app is not connected.' },
    },
  showProblem: (message) => {
    problem.textContent = message ?? '';
    problem.hidden = message === undefined;
  },
});
