import {
  createContentPolicy,
  createFaithfulCardReader,
  createImageConsentScope,
  establishImageEnforcement,
} from '@saga-a2ui/components/faithful-card';
import { documentContentSecurityPolicies, registerFaithfulCard, type ContentView, type LinkOpenOutcome } from '@saga-a2ui/lit/faithful-card';
import { createAnswerAppElement } from './answer-app.js';
import { briefAnswers, fixtureAnswers } from './answer-function.js';
import { brandings, type BrandName } from './branding.js';

// Composition root. The query string only selects among this application's own compiled-in
// choices so one build can show them side by side; nothing in an answer can change any of them.
const params = new URLSearchParams(location.search);
const brand: BrandName = params.get('brand') === 'harbor' ? 'harbor' : 'nur';
const answer = params.get('answers') === 'brief' ? briefAnswers : fixtureAnswers;
const level = params.get('level') === 'strict' ? 'strict' : 'standard';

// Trusted settings, created once by the application: the Markdown dialect and a finite bound for
// its long answers, the content policy with the one host images may come from, and the link callback.
const reader = createFaithfulCardReader({ dialect: 'commonmark-tables-strikethrough', maxLength: 50_000 });
const policy = createContentPolicy({ level, imageHosts: ['images.example.com'] });
if (!reader.ok) throw new Error(reader.failure.message);
if (!policy.ok) throw new Error(policy.failure.message);

const content: ContentView = {
  reader: reader.reader,
  policy: policy.policy,
  // The only way a link leaves the page: a new window without the opener, and only for a link the policy
  // allowed. A page cannot learn whether the browser opened it (`noopener` makes window.open return null
  // either way), so the outcome reports only that the request was made.
  hostLinks: {
    open: (url): Promise<LinkOpenOutcome> => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return Promise.resolve('opened');
    },
  },
  // Images load only if this document declares exactly the restrictions the policy derives (see the
  // Content-Security-Policy meta element in index.html).
  imageEnforcement: establishImageEnforcement(policy.policy, documentContentSecurityPolicies(document)),
  consent: createImageConsentScope(),
};

registerFaithfulCard();
customElements.define('answer-consumer', createAnswerAppElement({ answer, branding: brandings[brand], content }));
