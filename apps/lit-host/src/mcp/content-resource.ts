import { createHash } from 'node:crypto';
import type { ViewCsp } from '@saga-a2ui/mcp/policy';
import { embedPolicy } from '../content/embedded-policy.js';
import type { ContentPolicy } from '@saga-a2ui/components/faithful-card';
import { EPISODE_VIEW_URI } from './episode.js';

/** What the MCP server registers: the identity, the document and the host metadata. */
export interface ContentResource {
  readonly uri: string;
  readonly html: string;
  /** The `_meta.ui.csp` the host reads before mounting. */
  readonly csp: ViewCsp;
}

/**
 * Derives the episode view resource from one policy. The identity, the declared origins and the
 * restrictions inside the document all come from that policy, so a cached resource cannot supply
 * another policy's variant: the default policy keeps the base URI, and every different
 * configuration gets its own. That includes a Strict policy whose declared domains equal a
 * Standard policy's: the host metadata is the same but the embedded configuration, and so the
 * view's behavior, is not. The image origins and the font origins are the only declared domains;
 * the host's broad `resourceDomains` permission is narrowed to each origin's own resource type
 * by the restrictions in the document. The embedded `data:` and `blob:` baseline needs no
 * declaration. The URI follows the policy configuration; an application whose bundle also carries
 * its own artwork, CSS and fonts derives its identity from the final document bytes instead (see
 * `viewUriForHtml` in `@saga-a2ui/mcp/server`).
 */
export function contentResource(viewHtml: string, policy: ContentPolicy): ContentResource {
  const isDefault =
    policy.level === 'standard' && policy.imageHosts.length === 0 && policy.fontOrigins.length === 0;
  const uri = isDefault
    ? EPISODE_VIEW_URI
    : EPISODE_VIEW_URI.replace(
        /\.html$/,
        `-${createHash('sha256').update(JSON.stringify(policy.configuration)).digest('hex').slice(0, 12)}.html`,
      );
  return {
    uri,
    html: embedPolicy(viewHtml, policy),
    csp: { connectDomains: [], resourceDomains: policy.resource.resourceDomains, frameDomains: [], baseUriDomains: [] },
  };
}
