import {
  defineElements,
  type ElementRegistry,
} from '../element-registration.js';
import {
  CARD_SURFACE_TAG,
  FaithfulCardSurfaceElement,
} from './card-surface.js';
import { faithfulCardEntry } from './catalog.js';
import { FaithfulCardContentElement } from './faithful-card-element.js';

/**
 * Explicit setup: defines the catalog element, the card element it renders and the card surface
 * element. Call it once at startup. Repeating it is harmless; a tag already bound to a different
 * constructor fails with `ElementConflictError` and nothing from the failing call is defined.
 * Importing this module registers nothing.
 */
export function registerFaithfulCard(registry?: ElementRegistry): void {
  defineElements(
    [
      faithfulCardEntry,
      {
        tagName: 'saga-faithful-card-content',
        element: FaithfulCardContentElement,
      },
      { tagName: CARD_SURFACE_TAG, element: FaithfulCardSurfaceElement },
    ],
    registry,
  );
}
