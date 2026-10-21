import type { LinkOpenOutcome } from '@saga-a2ui/components/faithful-card';
import { registerFaithfulCard } from '@saga-a2ui/lit/faithful-card';
import { createAnswerAppElement } from './answer-app.js';
import { briefAnswers, fixtureAnswers } from './answer-function.js';
import { brandings, type BrandName } from './branding.js';
import { createContentView } from './content-view.js';

// Composition root of the standalone page. The query string only selects among this application's
// own compiled-in choices so one build can show them side by side; nothing in an answer can change
// any of them. (The page an MCP host mounts is mcp.html, composed in mcp-main.ts.)
const params = new URLSearchParams(location.search);
const brand: BrandName = params.get('brand') === 'harbor' ? 'harbor' : 'nur';
const answer =
  params.get('answers') === 'brief' ? briefAnswers : fixtureAnswers;
const level = params.get('level') === 'strict' ? 'strict' : 'standard';

const content = createContentView({
  level,
  // The one host images may come from. Images load only while this document's Content-Security-Policy
  // is exactly what the policy derives for it (see the meta element in index.html).
  imageHosts: ['images.example.com'],
  // The only way a link leaves the page: a new window without the opener, and only for a link the policy
  // allowed. A page cannot learn whether the browser opened it (`noopener` makes window.open return null
  // either way), so the outcome reports only that the request was made.
  hostLinks: {
    open: (url): Promise<LinkOpenOutcome> => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return Promise.resolve('opened');
    },
  },
});

registerFaithfulCard();
customElements.define(
  'answer-consumer',
  createAnswerAppElement({ answer, branding: brandings[brand], content }),
);
