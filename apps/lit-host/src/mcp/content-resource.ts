import {
  embedContentPolicy,
  resourcePermissionsOf,
  type ContentPolicy,
} from '@saga-a2ui/components/faithful-card';
import {
  operationViewFromHtml,
  type OperationView,
} from '@saga-a2ui/mcp/server';

/**
 * Derives the episode view resource from one policy. The declared origins and the restrictions
 * inside the document come from that policy, and the identity comes from the exact document that
 * is served: the URI is `viewUriForHtml` (`@saga-a2ui/mcp/server`) of the result of embedding the
 * policy. A cached resource therefore cannot supply other bytes under the same URI: any change to
 * the application code, CSS, fonts, artwork or policy is a new resource, equal bytes keep the same
 * one, and an answer, which is never part of the document, reuses it. That includes a Strict
 * policy whose declared domains equal a Standard policy's: the host metadata is the same but the
 * embedded configuration, and so the document bytes and the view's behavior, are not. The image
 * origins and the font origins are the only declared domains; the host's broad `resourceDomains`
 * permission is narrowed to each origin's own resource type by the restrictions in the document.
 * The embedded `data:` and `blob:` baseline needs no declaration. The declared CSP is served
 * beside the document and is not covered by its identity.
 */
export function contentResource(
  viewHtml: string,
  policy: ContentPolicy,
  filename = 'view.html',
): OperationView {
  return operationViewFromHtml({
    html: embedContentPolicy(viewHtml, policy),
    filename,
    title: 'Episode view',
    csp: resourcePermissionsOf(policy),
  });
}
