import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { contentViewFromDocument } from './lit/content-view.js';
import { registerLitElements, sagaCatalog } from './lit/integration.js';
import { createSagaAppElement } from './lit/saga-app.js';
import { hostLinksFromApp } from '@saga-a2ui/mcp/view';
import { connectEpisodeView } from './mcp/view.js';
import {
  a2uiV0_9Decoder,
  createMessageSession,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { emptyPanel } from './saga-panel/fixture.js';

// Composition root of the MCP Apps view (built into one HTML resource by vite.view.config.ts).
// It contains no server code: data arrives only through the host's bridge.
const problem = document.querySelector<HTMLElement>(
  '[data-testid="view-problem"]',
);
if (!problem) throw new Error('view.html has no problem element');

const app = new App({ name: 'saga-a2ui-episode-view', version: '0.0.0' });
// The policy comes from the resource the host mounted, never from content. If it does not
// validate, nothing is mounted: the view stays empty and says why.
const content = contentViewFromDocument(document, hostLinksFromApp(app));
if (!content.ok) {
  problem.textContent = `This view cannot start: ${content.message}`;
  problem.hidden = false;
} else {
  registerLitElements();
  customElements.define(
    'saga-app',
    createSagaAppElement({
      createSession: () =>
        createMessageSession({
          catalogs: [sagaCatalog],
          decoder: a2uiV0_9Decoder,
        }),
      layout: emptyPanel,
      content: content.view,
    }),
  );

  await connectEpisodeView({
    app,
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
    revokeImageConsent: () => content.view.consent.revokeAll(),
    retireImageConsent: () => content.view.consent.retire(),
  });
}
