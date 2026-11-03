import { requestLinkOpen } from '@saga-a2ui/components/faithful-card';
import {
  describeLinkOutcome,
  type LinkOpenOutcome,
} from '@saga-a2ui/core/host-links';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { requestContentView, type ContentView } from './content-view.js';

/** What the host answered for a link, with the sentence a reader sees (empty when it opened). */
export interface HostLinkOutcome {
  readonly kind: LinkOpenOutcome;
  readonly message: string;
}

export interface HostLinkBinding {
  /** Whether the enclosing view's policy lets this link be activated. False outside a view. */
  readonly allowed: boolean;
  /**
   * Asks the host to open the link, if the policy still allows it: exactly one host request per
   * call, and none when it does not. Resolves once the answer has been shown or dropped.
   */
  open(): Promise<void>;
  /** The host's answer to the latest activation, until the binding is released or the view's selection is replaced. */
  readonly outcome: HostLinkOutcome | undefined;
  /** Ends the binding: a late answer is dropped and the element no longer updates for it. Idempotent. */
  release(): void;
}

/** The binding as a Lit controller: it follows its element's connection and asks it to re-render. */
class HostLinkController implements HostLinkBinding, ReactiveController {
  private generation = 0;
  private answer: HostLinkOutcome | undefined;
  private watching: { unsubscribe(): void } | undefined;
  private released = false;

  constructor(
    private readonly element: ReactiveControllerHost & HTMLElement,
    private readonly url: string,
  ) {
    element.addController(this);
    this.watch();
  }

  get allowed(): boolean {
    return this.view()?.policy.decideLink(this.url).allowed === true;
  }

  get outcome(): HostLinkOutcome | undefined {
    return this.answer;
  }

  hostConnected(): void {
    this.watch();
  }

  hostDisconnected(): void {
    this.retire();
    this.watching?.unsubscribe();
    this.watching = undefined;
  }

  async open(): Promise<void> {
    const view = this.view();
    if (view === undefined) return;
    const decision = view.policy.decideLink(this.url);
    if (!decision.allowed) return;
    const asked = this.generation;
    const kind = await requestLinkOpen(view.hostLinks, decision.url);
    // The answer is for the link as it stood when asked: not after release, removal or a new selection.
    if (this.generation !== asked) return;
    this.answer = { kind, message: describeLinkOutcome(kind, decision.url) };
    this.element.requestUpdate();
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.hostDisconnected();
    this.element.removeController(this);
  }

  /** The view of the element's place in the document, or none while it is detached or released. */
  private view(): ContentView | undefined {
    return this.released || !this.element.isConnected
      ? undefined
      : requestContentView(this.element);
  }

  /** A new selection in the view (it ended its image consent) replaces whatever this link said. */
  private watch(): void {
    if (this.watching !== undefined) return;
    this.watching = this.view()?.consent.subscribe(() => {
      this.retire();
      this.element.requestUpdate();
    });
  }

  private retire(): void {
    this.generation += 1;
    this.answer = undefined;
  }
}

/**
 * The card's own link rules for a link an application renders itself, for example in its chrome.
 * `element` is the Lit element that renders the link; it must be inside the element that provides
 * the card's view (`provideContentView`). The view's policy decides, at activation; its host links
 * are asked; the outcome is worded by `describeLinkOutcome` and `element` re-renders when it
 * arrives. An answer is shown only while the link it was asked about stands: `release()`, the
 * element's removal and a new selection (the view ending its consent) each drop it. Outside a view
 * nothing is allowed and nothing throws. Create a new binding for a different `url`.
 */
export function bindHostLink(
  element: ReactiveControllerHost & HTMLElement,
  url: string,
): HostLinkBinding {
  return new HostLinkController(element, url);
}
