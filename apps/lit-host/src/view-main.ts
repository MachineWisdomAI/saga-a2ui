import type { HostLinks } from '@saga-a2ui/core/host-links';
import { startA2uiView } from '@saga-a2ui/lit-mcp-stack';
import { provideContentView } from '@saga-a2ui/lit/faithful-card';
import { contentViewFromDocument } from './lit/content-view.js';
import { registerLitElements, sagaCatalog } from './lit/integration.js';
import { createEpisodeView } from './mcp/view.js';
import { emptyPanel, type PanelData } from './saga-panel/fixture.js';

declare global {
  interface Window {
    /**
     * Browser-test entry point: replaces the panel's data through the running view's typed
     * surface, which validates it like any other update. Present while the view is running.
     */
    sagaUpdatePanel?: (data: PanelData) => unknown;
  }
}

// Composition root of the MCP Apps view (built into one HTML resource by vite.view.config.ts).
// It contains no server code: data arrives only through the host's bridge. The stack connects to
// the host, holds a result that arrives early and ends the view; this page decides what a result
// means (mcp/view.ts) and which content policy the descriptions inside it run under.
const problem = document.querySelector<HTMLElement>(
  '[data-testid="view-problem"]',
);
if (!problem) throw new Error('view.html has no problem element');
const container = document.querySelector('saga-app');
if (!container) throw new Error('view.html has no saga-app element');

// The host's link opener exists once the view starts; a description asks for it only when a link
// is activated.
let links: HostLinks | undefined;
const hostLinks: HostLinks = {
  open: (url) => links?.open(url) ?? Promise.resolve('unavailable'),
};

// The policy comes from the resource the host mounted, never from content. If it does not
// validate, nothing is mounted: the view stays empty and says why.
const content = contentViewFromDocument(document, hostLinks);
if (!content.ok) {
  problem.textContent = `This view cannot start: ${content.message}`;
  problem.hidden = false;
} else {
  // The panel's description is shown by the optional card element, which the stack does not know.
  registerLitElements();
  provideContentView(container, content.view);
  const episode = createEpisodeView({
    update: (data) => view.surface.update(data),
    showProblem: (message) => {
      problem.textContent = message ?? '';
      problem.hidden = message === undefined;
    },
    revokeImageConsent: () => content.view.consent.revokeAll(),
  });
  const view = startA2uiView({
    container,
    layout: emptyPanel,
    catalog: sagaCatalog,
    identity: { name: 'saga-a2ui-episode-view', version: '0.0.0' },
    actions: (host) => {
      links = host.links;
      return undefined;
    },
    onToolResult: (result) => episode.onToolResult(result),
    // Nothing still on screen may grant image consent once the view has ended.
    onTeardown: () => {
      delete window.sagaUpdatePanel;
      content.view.consent.retire();
    },
  });
  window.sagaUpdatePanel = (data) => view.surface.update(data);
  await view.ready;
}
