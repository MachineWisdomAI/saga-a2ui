import { McpServer } from '@modelcontextprotocol/server';
import {
  registerPublicOperation,
  type OperationOutcome,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
import type { ContentPolicy } from '@saga-a2ui/components/faithful-card';
import { contentResource } from './content-resource.js';
import {
  EPISODE_TOOL_NAME,
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
  readonly viewFilename?: string;
  /** The built, immutable view document. Combined only with the trusted policy, never request data. */
  readonly viewHtml: string;
  readonly catalog: EpisodeCatalog;
  /**
   * The trusted content policy for this server's view. It fixes the resource's identity, its
   * declared image origins and the restrictions inside the document. Nothing in a tool result
   * or description can change it.
   */
  readonly contentPolicy: ContentPolicy;
  /** The request this server was built for, started by the listener at admission. */
  readonly lifetime: RequestLifetime;
}

/** Copy only the public fields; the explicit projection is what keeps other fields private. */
function toPublicEpisode(record: EpisodeRecord): PublicEpisode {
  return {
    episodeId: record.id,
    title: record.title,
    description: record.description,
  };
}

/**
 * Builds an MCP server with one explicitly public, read-only operation and the HTML resource it
 * links to. No authentication, playback or other tools exist here: the data is public and synthetic.
 */
export function createEpisodeServer(options: EpisodeServerOptions): McpServer {
  const server = new McpServer({
    name: 'saga-a2ui-episode-demo',
    version: '0.0.0',
  });
  const view = contentResource(
    options.viewHtml,
    options.contentPolicy,
    options.viewFilename,
  );

  registerPublicOperation(
    server,
    {
      name: EPISODE_TOOL_NAME,
      title: 'Get episode',
      description:
        'Returns the public title and description of one synthetic episode.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      input: EpisodeRequestSchema,
      output: PublicEpisodeSchema,
      view,
      failures: {
        absent: 'No public episode has that id.',
        unavailable: 'The episode is unavailable.',
        invalidOutput: 'The episode could not be shown.',
      },
      handle: ({ episodeId }): OperationOutcome<EpisodeRecord> => {
        const record = options.catalog.find(episodeId);
        return record ? { kind: 'record', record } : { kind: 'absent' };
      },
      project: (record) => {
        const episode = toPublicEpisode(record);
        return {
          text: `${episode.title} (${episode.episodeId})`,
          data: episode,
        };
      },
    },
    { lifetime: options.lifetime },
  );

  return server;
}
