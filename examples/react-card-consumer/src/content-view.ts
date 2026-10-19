import {
  createFaithfulCardReader,
  establishImageEnforcement,
  createImageConsentScope,
  type ContentPolicy,
  type HostLinks,
} from '@saga-a2ui/components/faithful-card';
import type { FaithfulCardView } from '@saga-a2ui/react/faithful-card';

/** Every Content-Security-Policy value the document carries: the restrictions image loading relies on. */
function documentContentSecurityPolicies(document: Document): string[] {
  return Array.from(document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]'), (meta) => meta.getAttribute('content') ?? '');
}

/**
 * The trusted settings of the card, created once by the application: the Markdown dialect and a finite
 * bound for its long answers, the content policy it was served with, how a link leaves the page, and the
 * image restrictions the document actually carries. Nothing in an answer can change any of them.
 */
export function createContentView(settings: { readonly policy: ContentPolicy; readonly hostLinks: HostLinks; readonly document: Document }): FaithfulCardView {
  const reader = createFaithfulCardReader({ dialect: 'commonmark-tables-strikethrough', maxLength: 50_000 });
  if (!reader.ok) throw new Error(reader.failure.message);
  return {
    reader: reader.reader,
    policy: settings.policy,
    hostLinks: settings.hostLinks,
    // Images load only if the document declares exactly the restrictions the policy derives; otherwise they stay inert.
    imageEnforcement: establishImageEnforcement(settings.policy, documentContentSecurityPolicies(settings.document)),
    // This view's own consent scope. The application ends it when the view ends.
    consent: createImageConsentScope(),
  };
}
