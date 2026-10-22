import {
  createContentPolicy,
  NO_HOST_LINKS,
} from '@saga-a2ui/components/faithful-card';
import {
  createFaithfulCardView,
  FaithfulCardProvider,
  FaithfulCardSurface,
  openFaithfulCardSurface,
} from '@saga-a2ui/react/faithful-card';
import '@saga-a2ui/react/faithful-card.css';
import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BRANDED_CSS, classifyAttribution } from './branded.js';

// Test-only. The branded React card, mounted the way an application mounts it: a view from the
// public factory, a card surface opened once, content given with `present`. The application's
// stylesheet is a plain document rule set; `?unbranded` leaves it out, to show the assertions can
// tell a branded card from the SDK's own presentation.

if (!new URLSearchParams(location.search).has('unbranded')) {
  const style = document.createElement('style');
  style.textContent = BRANDED_CSS;
  document.head.append(style);
}

const policy = createContentPolicy({ level: 'standard', imageHosts: [] });
if (!policy.ok) throw new Error(policy.failure.message);
const view = createFaithfulCardView({
  dialect: 'commonmark-tables-strikethrough',
  maxLength: 20_000,
  policy: policy.policy,
  contentSecurityPolicies: [],
  hostLinks: NO_HOST_LINKS,
});
const surface = openFaithfulCardSurface();

const container = document.getElementById('root');
if (!container) throw new Error('the page has no #root');
createRoot(container).render(
  createElement(
    StrictMode,
    null,
    createElement(
      FaithfulCardProvider,
      { view },
      createElement(FaithfulCardSurface, { of: surface }),
    ),
  ),
);

window.cardPage = {
  async present(markdown) {
    if (!surface.present({ markdown }).ok)
      throw new Error('the card surface refused the content');
    // React commits asynchronously; the application classifies the closing paragraph after it has.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
    classifyAttribution(document);
  },
};
