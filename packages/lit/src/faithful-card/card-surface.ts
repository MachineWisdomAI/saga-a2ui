import type { LitComponentApi } from '@a2ui/lit/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import {
  cardData,
  cardLayout,
  FAITHFUL_CARD_CATALOG_ID,
  type CardContent,
  type ImageConsentScope,
} from '@saga-a2ui/components/faithful-card';
import { html, nothing } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import {
  createA2uiAppElement,
  type A2uiUpdateResult,
} from '../a2ui/app-element.js';
import { faithfulCardEntry } from './catalog.js';
import { requestContentView } from './content-view.js';

// The card's surface for Lit: layer A's layout presented by layer B's app element over the card's
// own catalog, with the one operation that chooses what the card shows. Selection is not a data
// update. `present` ends the previous presentation (its image consent, its late link and image
// answers, its source toggles) and starts a new one even when the text is equal, so a reader's
// earlier choices never carry over to a new answer. An ordinary update of an own-catalog surface
// stays in place and is the app element's `updateData`; it is not this operation.

/** The tag of the card surface element. `registerFaithfulCard` defines it. */
export const CARD_SURFACE_TAG = 'saga-faithful-card-surface';

/**
 * What an application does with the card. Place `element` in the document beneath the element that
 * provides the card's view (`provideContentView`).
 */
export interface CardSurface {
  /** The element that shows the card: an empty card until the first `present`. */
  readonly element: HTMLElement;
  /**
   * Shows `content` as a new presentation. Never throws. Content the surface refuses (for example
   * markdown that is not text) returns the failure and leaves the shown presentation untouched,
   * consent included. Content the view's reader refuses is not refused here: the card shows its
   * own failure for it, in place of the content. Content presented before `element` is in the
   * document is shown once it is.
   */
  present(content: CardContent): A2uiUpdateResult;
  /** Ends the presentation and empties the card. The next `present` shows again. */
  clear(): void;
  /** Ends the surface. Idempotent. Afterwards `present` fails and the card shows nothing. */
  dispose(): void;
}

const layout = cardLayout();
const catalog = new Catalog<LitComponentApi>(FAITHFUL_CARD_CATALOG_ID, 'v0.9', [
  faithfulCardEntry,
]);

/** What the element shows: set by the surface that owns it, never by the application. */
interface Shown {
  readonly content: CardContent | undefined;
  /** Advances with every presentation, so the previous one is replaced even by equal text. */
  readonly presentation: number;
  /** True once the surface is disposed: nothing is shown. An empty or cleared card is still shown, empty. */
  readonly ended: boolean;
}

/** The state of one card surface. Only this module can make one. */
class OpenedCardSurface implements CardSurface {
  readonly element: FaithfulCardSurfaceElement;
  private readonly listeners = new Set<() => void>();
  private consent: ImageConsentScope | undefined;
  private ended = false;
  private current: Shown = {
    content: undefined,
    presentation: 0,
    ended: false,
  };

  constructor() {
    this.element = new FaithfulCardSurfaceElement();
    this.element.owner = this;
  }

  get shown(): Shown {
    return this.current;
  }

  /** The mounted element tells this surface which consent scope its view owns; it takes it back on removal. */
  attach(
    consent: ImageConsentScope | undefined,
    listener: () => void,
  ): () => void {
    this.consent = consent;
    this.listeners.add(listener);
    return () => {
      if (this.consent === consent) this.consent = undefined;
      this.listeners.delete(listener);
    };
  }

  present(content: CardContent): A2uiUpdateResult {
    if (this.ended)
      return {
        ok: false,
        failure: { kind: 'rejected', message: 'The surface was disposed.' },
      };
    // Checked against the layout first, so content it refuses changes nothing: not the shown
    // presentation, and not the consent given for it.
    const checked = layout.update(cardData(content));
    if (!checked.ok) return { ok: false, failure: checked.failure };
    this.replace(content);
    return { ok: true };
  }

  clear(): void {
    if (!this.ended) this.replace(undefined);
  }

  dispose(): void {
    if (this.ended) return;
    this.ended = true;
    this.replace(undefined);
  }

  private replace(content: CardContent | undefined): void {
    this.consent?.revokeAll();
    this.current = {
      content,
      presentation: this.current.presentation + 1,
      ended: this.ended,
    };
    for (const listener of [...this.listeners]) listener();
  }
}

/** The element behind {@link CardSurface}: an app element over the card's layout and catalog. */
export class FaithfulCardSurfaceElement extends createA2uiAppElement({
  catalog,
  layout,
}) {
  /** Set once by the surface that created this element. */
  owner?: OpenedCardSurface;
  private detach?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.detach = this.owner?.attach(requestContentView(this)?.consent, () => {
      this.apply();
      this.requestUpdate();
    });
    this.apply();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.detach?.();
    this.detach = undefined;
  }

  override render() {
    const shown = this.owner?.shown;
    if (shown === undefined || shown.ended) return nothing;
    // The key is the presentation: a new one mounts a fresh card, which carries nothing of the old.
    return html`${keyed(shown.presentation, super.render())}`;
  }

  /** Brings the connected session's data to what the card should show: the content, or nothing. */
  private apply(): void {
    if (!this.isConnected) return;
    this.updateData(cardData(this.owner?.shown.content ?? { markdown: '' }));
  }
}

/**
 * Opens a card surface, empty until the first `present`. Needs `registerFaithfulCard()` to have
 * run, since the surface is a custom element; throws naming that when it has not.
 */
export function openFaithfulCardSurface(): CardSurface {
  if (customElements.get(CARD_SURFACE_TAG) !== FaithfulCardSurfaceElement)
    throw new Error(
      `<${CARD_SURFACE_TAG}> is not defined: call registerFaithfulCard() before opening a card surface.`,
    );
  return new OpenedCardSurface();
}
