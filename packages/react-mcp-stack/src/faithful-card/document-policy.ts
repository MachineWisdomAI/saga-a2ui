import {
  CONTENT_POLICY_ELEMENT_ID,
  contentPolicyFromEmbedded,
  type CreatePolicyResult,
} from '@saga-a2ui/components/faithful-card';

// Where a view finds what its server embedded in the document it served. The format belongs to
// `@saga-a2ui/components` (`embedContentPolicy`, `contentPolicyFromEmbedded`); reading the
// document is the stack’s, because components and the renderers take no document.

/**
 * The content policy embedded in `doc`, validated again: no embedded policy means the Standard
 * policy with empty lists, and anything that does not validate is a failure, so a view is never
 * mounted on a guessed policy.
 */
export function contentPolicyFromDocument(doc: Document): CreatePolicyResult {
  return contentPolicyFromEmbedded(
    doc.getElementById(CONTENT_POLICY_ELEMENT_ID)?.textContent ?? null,
  );
}

/**
 * The Content-Security-Policy values `doc` carries in `<meta http-equiv>` elements: the restrictions
 * image loading relies on. They are passed to `createFaithfulCardView` with the policy; images
 * load only when the document carries exactly what that policy derives.
 */
export function documentContentSecurityPolicies(doc: Document): string[] {
  return Array.from(
    doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]'),
    (meta) => meta.getAttribute('content') ?? '',
  );
}
