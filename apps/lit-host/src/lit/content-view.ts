import { type HostLinks } from '@saga-a2ui/core/host-links';
import {
  createFaithfulCardView,
  type ContentView,
} from '@saga-a2ui/lit/faithful-card';
import {
  contentPolicyFromDocument,
  documentContentSecurityPolicies,
} from '@saga-a2ui/lit-mcp-stack/faithful-card';

/**
 * The episode consumer's trusted card settings: CommonMark, and a description bound of 2,000
 * UTF-16 code units. A card in another application chooses its own; this bound belongs to the
 * episode view and is not the component's.
 */
export const EPISODE_CARD_SETTINGS = {
  dialect: 'commonmark',
  maxLength: 2000,
} as const;

export type DocumentContentView =
  | { readonly ok: true; readonly view: ContentView }
  | { readonly ok: false; readonly message: string };

/**
 * Builds a view's content settings from the document the host mounted: the policy embedded in the
 * resource, and whether the document carries exactly the restrictions that policy derives. An
 * embedded policy that does not validate is a failure; the caller must not mount content on it.
 */
export function contentViewFromDocument(
  doc: Document,
  hostLinks: HostLinks,
): DocumentContentView {
  const created = contentPolicyFromDocument(doc);
  if (!created.ok) return { ok: false, message: created.failure.message };
  return {
    ok: true,
    view: createFaithfulCardView({
      ...EPISODE_CARD_SETTINGS,
      policy: created.policy,
      contentSecurityPolicies: documentContentSecurityPolicies(doc),
      hostLinks,
    }),
  };
}
