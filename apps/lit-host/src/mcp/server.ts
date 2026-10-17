import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { ContentPolicy } from '../content/policy.js';
import { contentResource } from './content-resource.js';
import {
  EPISODE_TOOL_NAME,
  EpisodeRequestShape,
  PublicEpisodeSchema,
  type PublicEpisode,
} from './episode.js';

/**
 * What the application's backend knows about an episode. Only `id`, `title` and `description`
 * are ever published; any extra fields on a record stay on the server.
 */
export interface EpisodeRecord {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

/** The application's data seam. A real application would call its backend here. */
export interface EpisodeCatalog {
  find(episodeId: string): EpisodeRecord | undefined;
}

export interface EpisodeServerOptions {
  /** The built, immutable view document. Combined only with the trusted policy, never request data. */
  readonly viewHtml: string;
  readonly catalog: EpisodeCatalog;
  /**
   * The trusted content policy for this server's view. It fixes the resource's identity, its
   * declared image origins and the restrictions inside the document. Nothing in a tool result
   * or description can change it.
   */
  readonly contentPolicy: ContentPolicy;
}

/** Copy only the public fields; the explicit projection is what keeps other fields private. */
function toPublicEpisode(record: EpisodeRecord): PublicEpisode {
  return PublicEpisodeSchema.parse({
    episodeId: record.id,
    title: record.title,
    description: record.description,
  });
}

/**
 * Builds an MCP server with one read-only public tool and the HTML resource it links to.
 * No authentication, playback or other tools exist here: the data is public and synthetic.
 */
export function createEpisodeServer(options: EpisodeServerOptions): McpServer {
  const server = new McpServer({ name: 'saga-a2ui-episode-demo', version: '0.0.0' });
  const view = contentResource(options.viewHtml, options.contentPolicy);

  registerAppTool(
    server,
    EPISODE_TOOL_NAME,
    {
      title: 'Get episode',
      description: 'Returns the public title and description of one synthetic episode.',
      inputSchema: EpisodeRequestShape,
      outputSchema: PublicEpisodeSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: view.uri } },
    },
    async ({ episodeId }) => {
      const record = options.catalog.find(episodeId);
      if (!record) {
        return { isError: true, content: [{ type: 'text', text: 'No public episode has that id.' }] };
      }
      const episode = toPublicEpisode(record);
      return {
        content: [{ type: 'text', text: `${episode.title} (${episode.episodeId})` }],
        structuredContent: episode,
      };
    },
  );

  registerAppResource(server, 'Episode view', view.uri, {}, async () => ({
    contents: [
      {
        uri: view.uri,
        mimeType: RESOURCE_MIME_TYPE,
        text: view.html,
        _meta: { ui: { csp: view.csp } },
      },
    ],
  }));

  return server;
}
