import type { HostLinks, LinkOpenOutcome } from '@saga-a2ui/core/host-links';
import { SagaAttribution } from '@saga-a2ui/react/attribution';
import '@saga-a2ui/react/attribution.css';
import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Test-only. An own-catalog application's footer, the way an application places the credit: its own
// text above it, the credit in a footer, no card and no Markdown. The query string selects what the
// host answers (`?host=opened|denied|unavailable|failed|none`) and whether the page reads right to
// left (`?rtl`). Every request the host receives is recorded on `window.asked`.

declare global {
  interface Window {
    asked: string[];
  }
}
window.asked = [];

const params = new URLSearchParams(location.search);
if (params.has('rtl')) document.documentElement.dir = 'rtl';
const mode = params.get('host') ?? 'opened';

const links: HostLinks | undefined =
  mode === 'none'
    ? undefined
    : {
        open(url) {
          window.asked.push(url);
          return Promise.resolve<LinkOpenOutcome>(mode as LinkOpenOutcome);
        },
      };

const container = document.getElementById('root');
if (!container) throw new Error('the page has no #root');
createRoot(container).render(
  createElement(
    StrictMode,
    null,
    createElement('main', null, [
      createElement('h1', { key: 'title' }, 'Tic Tac Toe'),
      createElement('p', { key: 'status' }, 'Your move.'),
      createElement(
        'footer',
        { key: 'footer' },
        createElement(SagaAttribution, links === undefined ? {} : { links }),
      ),
    ]),
  ),
);
