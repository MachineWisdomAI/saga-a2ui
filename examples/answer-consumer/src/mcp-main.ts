import {
  FaithfulCardApp,
  startFaithfulCardApp,
  type CardChromeParts,
} from '@saga-a2ui/lit-mcp-stack/faithful-card';
import { html } from 'lit';
import { readAnswerResult } from './answer-result.js';
import { ANSWER_READER } from './answer-policy.js';
import { applyBranding, brandings } from './branding.js';

// Composition root of the page an MCP host mounts (mcp.html, served by server/answer-server.ts).
// No server code and no answer function: the host's bridge delivers each tool result and this page
// shows it in the shared FaithfulCard. The stack connects to the host, holds early results, reads
// the policy embedded in the document and ends the view with the page; this file states only what
// is the application's own: its reader, its words and the frame it puts around the card. The
// host's Content-Security-Policy governs the page, so it loads no image; a link leaves only as a
// request the host may refuse.

const branding = brandings.nur;

const definition = FaithfulCardApp.define({
  name: 'answer-consumer-view',
  version: '0.0.0',
})
  .reader(ANSWER_READER)
  .policy('document')
  .result(readAnswerResult)
  .texts({
    waiting: 'Waiting for the answer…',
    problem: 'The answer could not be shown.',
    connectFailure: 'This view could not connect to its host.',
    readyFailure: 'This view could not get ready.',
    policyFailure:
      'This view could not start: its content policy is not valid.',
  })
  .build();

/** The application's own frame: the brand, the status line, then the card. */
const chrome = ({ card, state }: CardChromeParts) =>
  html`<h1>${branding.name}</h1>
    <p role="status" data-testid="answer-status">
      ${state.kind === 'answer' ? 'Answer' : state.text}
    </p>
    ${card}`;

const container = document.querySelector<HTMLElement>('answer-view');
if (container === null) throw new Error('mcp.html has no answer-view element');
applyBranding(container, branding);

const view = startFaithfulCardApp(definition, {
  container,
  sizing: 'host',
  chrome,
});
await view.ready;
