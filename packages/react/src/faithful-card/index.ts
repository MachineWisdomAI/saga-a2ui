// Optional React rendering of the FaithfulCard: the card, its A2UI catalog entry and the provider of
// its trusted settings. An application with its own catalog that lists none of this carries none of
// it, including the Markdown parser. Import `@saga-a2ui/react/faithful-card.css` for the presentation.
export { faithfulCardEntry } from './catalog.js';
export { FaithfulCard, type FaithfulCardProps } from './card.js';
export {
  FaithfulCardSurface,
  openFaithfulCardSurface,
  type CardSurface,
} from './card-surface.js';
export {
  useHostLink,
  type HostLink,
  type HostLinkOutcome,
} from './host-link.js';
export {
  createFaithfulCardView,
  FaithfulCardProvider,
  type FaithfulCardView,
} from './view.js';
