import { Catalog } from '@a2ui/web_core/v0_9';
import {
  cardData,
  cardLayout,
  FAITHFUL_CARD_CATALOG_ID,
  type CardContent,
  type ImageConsentScope,
} from '@saga-a2ui/components/faithful-card';
import {
  createElement,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import {
  openSurface,
  Surface,
  type BoundSurface,
  type ReactCatalogComponent,
  type UpdateResult,
} from '../a2ui.js';
import { faithfulCardEntry } from './catalog.js';
import { FaithfulCardViewContext } from './view.js';

// The card's surface for React: layer A's layout opened by layer B's bound surface over the
// card's own catalog, with the one operation that chooses what the card shows. Selection is not a
// data update. `present` ends the previous presentation (its image consent, its late link and
// image answers, its source toggles) and starts a new one even when the text is equal, so a
// reader's earlier choices never carry over to a new answer. An ordinary update of an own-catalog
// surface stays in place and is `BoundSurface.update`; it is not this operation.

/**
 * What an application does with the card. Mount it with {@link FaithfulCardSurface} under a
 * `FaithfulCardProvider`.
 */
export interface CardSurface {
  /**
   * Shows `content` as a new presentation. Never throws. Content the surface refuses (for example
   * markdown that is not text) returns the failure and leaves the shown presentation untouched,
   * consent included. Content the view's reader refuses is not refused here: the card shows its
   * own failure for it, in place of the content.
   */
  present(content: CardContent): UpdateResult;
  /** Ends the presentation and empties the card. The next `present` shows again. */
  clear(): void;
  /** Ends the surface. Idempotent. Afterwards `present` fails and the card shows nothing. */
  dispose(): void;
}

interface Shown {
  /** Advances with every presentation, so the previous one is replaced even by equal text. */
  readonly presentation: number;
  /** False once the surface is disposed; an empty or cleared card is still shown, empty. */
  readonly showing: boolean;
}

/** The card surface `openFaithfulCardSurface` hands out. Only this module can make one. */
class OpenedCardSurface implements CardSurface {
  private readonly bound: BoundSurface<ReturnType<typeof cardData>> =
    openSurface(
      cardLayout(),
      new Catalog<ReactCatalogComponent>(FAITHFUL_CARD_CATALOG_ID, 'v0.9', [
        faithfulCardEntry,
      ]),
    );
  private readonly listeners = new Set<() => void>();
  private consent: ImageConsentScope | undefined;
  private ended = false;
  private current: Shown = { presentation: 0, showing: true };

  get handle() {
    return this.bound.handle;
  }

  get state(): Shown {
    return this.current;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** The mounted surface tells this one which consent scope its view owns, and takes it back on unmount. */
  attach(consent: ImageConsentScope | undefined): () => void {
    this.consent = consent;
    return () => {
      if (this.consent === consent) this.consent = undefined;
    };
  }

  present(content: CardContent): UpdateResult {
    if (this.ended)
      return {
        ok: false,
        failure: { kind: 'rejected', message: 'The surface was disposed.' },
      };
    const applied = this.bound.update(cardData(content));
    if (!applied.ok) return applied;
    this.replace();
    return applied;
  }

  clear(): void {
    if (this.ended) return;
    this.bound.update(cardData({ markdown: '' }));
    this.replace();
  }

  dispose(): void {
    if (this.ended) return;
    this.ended = true;
    this.consent?.revokeAll();
    this.bound.dispose();
    this.current = {
      presentation: this.current.presentation + 1,
      showing: false,
    };
    this.notify();
  }

  private replace(): void {
    this.consent?.revokeAll();
    this.current = {
      presentation: this.current.presentation + 1,
      showing: true,
    };
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * Opens a card surface, empty until the first `present`. Throws only if the card's own catalog or
 * layout were inconsistent, which is a defect in this package, not in the caller.
 */
export function openFaithfulCardSurface(): CardSurface {
  return new OpenedCardSurface();
}

const neverChanges = (): (() => void) => () => undefined;
const NOTHING: Shown = { presentation: 0, showing: false };

/**
 * Renders a card surface: the card of the current presentation under the enclosing
 * `FaithfulCardProvider`, or nothing while empty, cleared or disposed. The provider's view owns the
 * image consent that `present` and `clear` end. Never disposes the surface: whoever opened it does.
 */
export function FaithfulCardSurface(props: {
  readonly of: CardSurface;
}): ReactElement | null {
  const opened = props.of instanceof OpenedCardSurface ? props.of : undefined;
  const state = useSyncExternalStore(
    opened?.subscribe ?? neverChanges,
    () => opened?.state ?? NOTHING,
  );
  const consent = useContext(FaithfulCardViewContext)?.consent;
  useLayoutEffect(() => opened?.attach(consent), [opened, consent]);
  return opened && state.showing
    ? // The key is the presentation: a new one mounts a fresh card, which carries nothing of the old.
      createElement(Surface, { key: state.presentation, of: opened.handle })
    : null;
}
