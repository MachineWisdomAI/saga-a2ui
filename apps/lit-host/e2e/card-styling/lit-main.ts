import { NO_HOST_LINKS } from '@saga-a2ui/core/host-links';
import { createContentPolicy } from '@saga-a2ui/components/faithful-card';
import {
  createFaithfulCardView,
  openFaithfulCardSurface,
  provideContentView,
  registerFaithfulCard,
} from '@saga-a2ui/lit/faithful-card';
import { BRANDED_CSS, classifyAttribution } from './branded.js';

// Test-only. The branded Lit card, mounted the way an application mounts it: a view from the public
// factory carrying the application's stylesheet, a card surface opened once, content given with
// `present`. `?unbranded` leaves the stylesheet out, to show the assertions can tell a branded card
// from the SDK's own presentation.

const policy = createContentPolicy({ level: 'standard', imageHosts: [] });
if (!policy.ok) throw new Error(policy.failure.message);

const styles: CSSStyleSheet[] = [];
if (!new URLSearchParams(location.search).has('unbranded')) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(BRANDED_CSS);
  styles.push(sheet);
}
const view = createFaithfulCardView({
  dialect: 'commonmark-tables-strikethrough',
  maxLength: 20_000,
  policy: policy.policy,
  contentSecurityPolicies: [],
  hostLinks: NO_HOST_LINKS,
  styles,
});

registerFaithfulCard();
const surface = openFaithfulCardSurface();
const container = document.getElementById('root');
if (!container) throw new Error('the page has no #root');
provideContentView(container, view);
container.append(surface.element);

window.cardPage = {
  async present(markdown) {
    if (!surface.present({ markdown }).ok)
      throw new Error('the card surface refused the content');
    // Lit renders the nested surfaces asynchronously; the application classifies the closing
    // paragraph after they have.
    for (let turn = 0; turn < 4; turn += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    classifyAttribution(document);
  },
};
