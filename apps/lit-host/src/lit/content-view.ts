import type { HostLinks } from '../content/host-links.js';
import { CONTENT_POLICY_ELEMENT_ID, policyFromEmbedded } from '../content/embedded-policy.js';
import { createImageConsentScope, type ImageConsentScope } from '../content/image-consent.js';
import { establishImageEnforcement, type ContentPolicy, type ImageEnforcement } from '../content/policy.js';

/**
 * Everything a description needs from its view, passed explicitly when the view is created: the
 * immutable trusted policy, the one way to ask the host to open a link, whether the image
 * restrictions the policy relies on are demonstrably in force, and this view's own scope for the
 * reader's revocable image consent. Nothing here is module-wide state, so two views never share
 * or change each other's effects or consent. The scope is separate from the policy: whoever
 * observes a retirement signal for the view (a new selection, teardown) calls `consent.revokeAll()`.
 */
export interface ContentView {
  readonly policy: ContentPolicy;
  readonly hostLinks: HostLinks;
  readonly imageEnforcement: ImageEnforcement;
  readonly consent: ImageConsentScope;
}

export const CONTENT_VIEW_REQUEST = 'saga-content-view-request';

/**
 * Sent upward by a description when it connects. The nearest view answers with its own
 * {@link ContentView}. A description nobody answers renders as inert plain text.
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

export type DocumentContentView =
  | { readonly ok: true; readonly view: ContentView }
  | { readonly ok: false; readonly message: string };

/**
 * Builds a view's content settings from the document the host mounted: the policy embedded in the
 * resource, and whether the document carries exactly the restrictions that policy derives. An
 * embedded policy that does not validate is a failure; the caller must not mount content on it.
 */
export function contentViewFromDocument(doc: Document, hostLinks: HostLinks): DocumentContentView {
  const created = policyFromEmbedded(doc.getElementById(CONTENT_POLICY_ELEMENT_ID)?.textContent ?? null);
  if (!created.ok) return { ok: false, message: created.failure.message };
  const applied = Array.from(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]'), (meta) =>
    meta.getAttribute('content') ?? '',
  );
  return {
    ok: true,
    view: {
      policy: created.policy,
      hostLinks,
      imageEnforcement: establishImageEnforcement(created.policy, applied),
      consent: createImageConsentScope(),
    },
  };
}

/** Asks the nearest enclosing view for its content settings. */
export function requestContentView(from: EventTarget): ContentView | undefined {
  const request = new ContentViewRequest();
  from.dispatchEvent(request);
  return request.view;
}
