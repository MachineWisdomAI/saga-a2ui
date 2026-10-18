import { createFaithfulCardReader, createImageConsentScope, establishImageEnforcement } from '@saga-a2ui/components/faithful-card';
import { documentContentSecurityPolicies, type ContentView, type HostLinks } from '@saga-a2ui/lit/faithful-card';
import { CONTENT_POLICY_ELEMENT_ID, policyFromEmbedded } from '../content/embedded-policy.js';

/**
 * The episode consumer's trusted card settings: CommonMark, and a description bound of 2,000
 * UTF-16 code units. A card in another application chooses its own; this bound belongs to the
 * episode view and is not the component's.
 */
export const EPISODE_CARD_SETTINGS = { dialect: 'commonmark', maxLength: 2000 } as const;

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
  const reader = createFaithfulCardReader(EPISODE_CARD_SETTINGS);
  if (!reader.ok) return { ok: false, message: reader.failure.message };
  return {
    ok: true,
    view: {
      reader: reader.reader,
      policy: created.policy,
      hostLinks,
      imageEnforcement: establishImageEnforcement(created.policy, documentContentSecurityPolicies(doc)),
      consent: createImageConsentScope(),
    },
  };
}
