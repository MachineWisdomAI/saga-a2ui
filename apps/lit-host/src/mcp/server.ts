import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/server';
import {
  EPISODE_TOOL_NAME,
  EPISODE_VIEW_URI,
  EpisodeRequestSchema,
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
  /** The built, immutable view document. Served verbatim; never combined with request data. */
  readonly viewHtml: string;
  readonly catalog: EpisodeCatalog;
}

/**
 * The view loads no network resources and makes no requests: the host delivers data over the
 * MCP Apps bridge. Empty domain lists make that explicit in the resource metadata.
 */
const VIEW_CSP = {
  connectDomains: [],
  resourceDomains: [],
  frameDomains: [],
  baseUriDomains: [],
} as const;

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

  registerAppTool(
    server,
    EPISODE_TOOL_NAME,
    {
      title: 'Get episode',
      description: 'Returns the public title and description of one synthetic episode.',
      inputSchema: EpisodeRequestSchema,
      outputSchema: PublicEpisodeSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: EPISODE_VIEW_URI } },
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

  registerAppResource(server, 'Episode view', EPISODE_VIEW_URI, {}, async () => ({
    contents: [
      {
        uri: EPISODE_VIEW_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: options.viewHtml,
        _meta: { ui: { csp: VIEW_CSP } },
      },
    ],
  }));

  return server;
}
