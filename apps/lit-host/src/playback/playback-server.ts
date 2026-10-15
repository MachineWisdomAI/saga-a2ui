import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { PLAY_TOOL_NAME, PLAYBACK_VIEW_URI, PlayRequestSchema } from './playback.js';

/**
 * What the application's backend knows about an episode. Only `id`, `title` and `description`
 * may ever be published; any extra field on a record stays on the server.
 */
export interface EpisodeRecord {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export type EntitlementDecision = 'entitled' | 'denied';

/** The application's data seam. Entitlement is decided from the verified account, never from arguments. */
export interface PlaybackBackend {
  findEpisode(episodeId: string): EpisodeRecord | undefined;
  checkEntitlement(accountId: string, episodeId: string): Promise<EntitlementDecision>;
}

export interface PlaybackServerOptions {
  /** The built, immutable view document. Served verbatim; never combined with request data. */
  readonly viewHtml: string;
}

const VIEW_CSP = { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } as const;

/**
 * One app-only Play operation. `visibility: ['app']` makes the host offer it to the embedded
 * view and withhold it from the model's tool list.
 */
export function createPlaybackServer(options: PlaybackServerOptions): McpServer {
  const server = new McpServer({ name: 'saga-a2ui-playback-demo', version: '0.0.0' });

  // `registerAppTool` types its input as a raw shape, which strips unknown keys. Play needs a
  // strict object so a forged `accountId` is rejected, so this registers through the SDK's
  // `registerTool` and writes the same two `_meta` keys upstream's helper writes: `ui` and the
  // legacy flat `ui/resourceUri` that older hosts read.
  server.registerTool(
    PLAY_TOOL_NAME,
    {
      title: 'Play episode',
      description: 'Starts foreground playback of one episode for the signed-in listener.',
      inputSchema: PlayRequestSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: PLAYBACK_VIEW_URI, visibility: ['app'] }, 'ui/resourceUri': PLAYBACK_VIEW_URI },
    },
    async () => ({ isError: true, content: [{ type: 'text', text: 'Playback is not available.' }] }),
  );

  registerAppResource(server, 'Playback view', PLAYBACK_VIEW_URI, {}, async () => ({
    contents: [{ uri: PLAYBACK_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: options.viewHtml, _meta: { ui: { csp: VIEW_CSP } } }],
  }));

  return server;
}
