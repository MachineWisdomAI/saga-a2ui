import {
  FaithfulCardApp,
  readingProfile,
  startFaithfulCardApp,
  type CardChromeProps,
} from '@saga-a2ui/react-mcp-stack/faithful-card';
import '@saga-a2ui/react-mcp-stack/faithful-card.css';
import { createElement } from 'react';
import { runProbe } from './probe.js';

// The React stack's probe. The application's chrome is a component: the status line or the heading,
// then the card.
function Chrome({ card, state }: CardChromeProps) {
  return createElement(
    'main',
    null,
    state.kind === 'answer'
      ? state.heading === undefined
        ? null
        : createElement('h2', { 'data-testid': 'heading' }, state.heading)
      : createElement(
          'p',
          { role: 'status', 'data-testid': 'status' },
          state.text,
        ),
    card,
  );
}

runProbe({
  FaithfulCardApp,
  readingProfile,
  // The React card renders into the page, so the page's own stylesheet reaches it.
  stylesVia: 'page',
  start: (definition, { styles: _page, ...options }) =>
    startFaithfulCardApp(definition, { ...options, chrome: Chrome }),
});
