import {
  FaithfulCardApp,
  readingProfile,
  startFaithfulCardApp,
  type CardChromeParts,
} from '@saga-a2ui/lit-mcp-stack/faithful-card';
import { html } from 'lit';
import { runProbe } from './probe.js';

// The Lit stack's probe. The application's chrome is a render function: the status line or the
// heading, then the card.
const chrome = ({ card, state }: CardChromeParts) =>
  html`<main>
    ${
      state.kind === 'answer'
        ? state.heading === undefined
          ? ''
          : html`<h2 data-testid="heading">${state.heading}</h2>`
        : html`<p role="status" data-testid="status">${state.text}</p>`
    }
    ${card}
  </main>`;

runProbe({
  FaithfulCardApp,
  readingProfile,
  start: (definition, options) =>
    startFaithfulCardApp(definition, { ...options, chrome }),
});
