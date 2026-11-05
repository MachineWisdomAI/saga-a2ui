import { createHash } from 'node:crypto';
import {
  embedContentPolicy,
  resourcePermissionsOf,
  type ContentPolicy,
} from '@saga-a2ui/components/faithful-card';
import {
  operationViewFromHtml,
  type OperationView,
} from '@saga-a2ui/mcp/server';

/** Major version of the episode view's contract. Raise it only for an incompatible change. */
export const EPISODE_VIEW_MAJOR = 1;

/**
 * Derives the episode view resource from one policy. The declared origins and the restrictions
 * inside the document come from that policy. The address names the view's contract major and the
 * policy, not the document's bytes: a rebuild of the application code, CSS, fonts or artwork keeps
 * it, and an answer, which is never part of the document, reuses it.
 *
 * The policy is part of the filename (`view.<policy digest>.html`, then `.v1` before the
 * extension), so a cache keyed by URI never hands one policy variant another's document. That
 * includes a Strict policy whose declared domains equal a Standard policy's: the host metadata is
 * the same but the embedded configuration, and so the view's behavior, are not. The image origins
 * and the font origins are the only declared domains; the host's broad `resourceDomains`
 * permission is narrowed to each origin's own resource type by the restrictions in the document.
 * The embedded `data:` and `blob:` baseline needs no declaration. The declared CSP is served
 * beside the document.
 */
export function contentResource(
  viewHtml: string,
  policy: ContentPolicy,
  filename = 'view.html',
): OperationView {
  return operationViewFromHtml({
    html: embedContentPolicy(viewHtml, policy),
    filename: filename.replace(/\.html$/, `.${policyDigest(policy)}.html`),
    major: EPISODE_VIEW_MAJOR,
    title: 'Episode view',
    csp: resourcePermissionsOf(policy),
  });
}

/** The first 16 SHA-256 hex digits of what the policy embeds: its configuration and its restrictions. */
function policyDigest(policy: ContentPolicy): string {
  return createHash('sha256')
    .update(JSON.stringify(policy.configuration))
    .update('\n')
    .update(policy.resource.contentSecurityPolicy)
    .digest('hex')
    .slice(0, 16);
}
