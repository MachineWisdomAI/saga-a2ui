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
 * another policy's variant: the default policy keeps the base URI, and every different
 * configuration gets its own. That includes a Strict policy whose declared domains equal a
 * Standard policy's: the host metadata is the same but the embedded configuration, and so the
 * view's behavior, is not. Image origins are the only declared domains; the host's broad
 * `resourceDomains` permission is narrowed to images by the restrictions in the document.
 */
export function contentResource(viewHtml: string, policy: ContentPolicy): ContentResource {
  const origins = policy.resource.imageOrigins;
  const isDefault = policy.level === 'standard' && origins.length === 0;
  const uri = isDefault
    ? EPISODE_VIEW_URI
    : EPISODE_VIEW_URI.replace(
        /\.html$/,
        `-${createHash('sha256').update(JSON.stringify(policy.configuration)).digest('hex').slice(0, 12)}.html`,
      );
  return {
    uri,
    html: embedPolicy(viewHtml, policy),
    csp: { connectDomains: [], resourceDomains: origins, frameDomains: [], baseUriDomains: [] },
  };
}
