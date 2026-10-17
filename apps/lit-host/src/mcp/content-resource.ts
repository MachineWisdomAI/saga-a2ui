import { createHash } from 'node:crypto';
import { embedPolicy } from '../content/embedded-policy.js';
import type { ContentPolicy } from '../content/policy.js';
import { EPISODE_VIEW_URI } from './episode.js';

/** What the MCP server registers: the identity, the document and the host metadata. */
export interface ContentResource {
  readonly uri: string;
  readonly html: string;
  /** The `_meta.ui.csp` the host reads before mounting. */
  readonly csp: {
    readonly connectDomains: readonly string[];
    readonly resourceDomains: readonly string[];
    readonly frameDomains: readonly string[];
    readonly baseUriDomains: readonly string[];
  };
}

/**
 * Derives the episode view resource from one policy. The identity, the declared origins and the
 * restrictions inside the document all come from that policy, so a cached resource cannot supply
 * another policy's variant: the default policy keeps the base URI, and every different set of
 * image origins gets its own. Image origins are the only declared domains; the host's broad
 * `resourceDomains` permission is narrowed to images by the restrictions in the document.
 */
export function contentResource(viewHtml: string, policy: ContentPolicy): ContentResource {
  const origins = policy.resource.imageOrigins;
  const uri =
    origins.length === 0
      ? EPISODE_VIEW_URI
      : EPISODE_VIEW_URI.replace(
          /\.html$/,
          `-${createHash('sha256').update(origins.join('\n')).digest('hex').slice(0, 12)}.html`,
        );
  return {
    uri,
    html: embedPolicy(viewHtml, policy),
    csp: { connectDomains: [], resourceDomains: origins, frameDomains: [], baseUriDomains: [] },
  };
}
