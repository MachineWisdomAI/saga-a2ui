import type { FaithfulCardReader, ImageConsentScope, ContentPolicy, ImageEnforcement } from '@saga-a2ui/components/faithful-card';
import type { HostLinks } from './host-links.js';

/**
 * Everything a card needs from its view, passed explicitly when the view is created: the trusted
 * reader (Markdown dialect and content bound), the immutable trusted policy, the one way to ask
 * the host to open a link, whether the image restrictions the policy relies on are demonstrably
 * in force, and this view's own scope for the reader's revocable image consent. Nothing here is
 * module-wide state, so two views never share or change each other's effects or consent. The
 * scope is separate from the policy: whoever observes a retirement signal for the view (a new
 * selection, teardown) calls `consent.revokeAll()`.
 */
export interface ContentView {
  readonly reader: FaithfulCardReader;
  readonly policy: ContentPolicy;
  readonly hostLinks: HostLinks;
  readonly imageEnforcement: ImageEnforcement;
  readonly consent: ImageConsentScope;
}

export const CONTENT_VIEW_REQUEST = 'saga-content-view-request';

/**
 * Sent upward by a card when it connects. The nearest view answers with its own
 * {@link ContentView}. A card nobody answers refuses to show anything.
 */
export class ContentViewRequest extends Event {
  private answer?: ContentView;

  constructor() {
    super(CONTENT_VIEW_REQUEST, { bubbles: true, composed: true });
  }

  get view(): ContentView | undefined {
    return this.answer;
  }

  /** The nearest view answers first; later answers are ignored. */
  provide(view: ContentView): void {
    this.answer ??= view;
    this.stopPropagation();
  }
}

/**
 * Makes `host` the view for the cards inside it: they receive `view` when they connect. Returns
 * the function that ends it. The host's own element decides when to call each; nothing is
 * registered anywhere else.
 */
export function provideContentView(host: EventTarget, view: ContentView): () => void {
  const answer = (event: Event) => {
    if (event instanceof ContentViewRequest) event.provide(view);
  };
  host.addEventListener(CONTENT_VIEW_REQUEST, answer);
  return () => host.removeEventListener(CONTENT_VIEW_REQUEST, answer);
}

/** Asks the nearest enclosing view for its content settings. */
export function requestContentView(from: EventTarget): ContentView | undefined {
  const request = new ContentViewRequest();
  from.dispatchEvent(request);
  return request.view;
}

/**
 * The Content-Security-Policy values the mounted document carries in `<meta http-equiv>` elements.
 * Pass them to `establishImageEnforcement` with the policy: images load only when the document
 * carries exactly the restrictions that policy derives.
 */
export function documentContentSecurityPolicies(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]'), (meta) => meta.getAttribute('content') ?? '');
}
