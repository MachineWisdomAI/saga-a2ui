import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { calculateJwkThumbprint } from 'jose';
import { identityFromAuthInfo } from '../mcp/request-auth.js';
import type { MediaService } from './media-service.js';
import {
  MEDIA_PATH_PREFIX,
  PLAY_TOOL_NAME,
  PLAYBACK_AUTHORIZED_TEXT,
  PLAYBACK_DENIED_TEXT,
  PLAYBACK_RESULT_META,
  PLAYBACK_UNSUPPORTED_TEXT,
  PLAYBACK_VIEW_URI,
  PlayRequestSchema,
  RECIPIENT_KEY_META,
  RecipientKeySchema,
} from './playback.js';

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
  readonly backend: PlaybackBackend;
  /** Issues the capability the media service checks later. Shared across requests by the listener. */
  readonly mediaService: MediaService;
  /** Origin of the media service, e.g. `http://127.0.0.1:3001`. Built by the listener, never from a request. */
  readonly mediaOrigin: string;
}

const VIEW_CSP = { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } as const;

const failure = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });

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
    async ({ episodeId }, extra) => {
      // The principal comes only from the verified request context, never from the arguments.
      const identity = identityFromAuthInfo(extra.authInfo);
      if (!identity) return failure(PLAYBACK_UNSUPPORTED_TEXT); // the listener already refused this; fail closed anyway

      // Routing is checked before any protected work: without a usable recipient key the view
      // cannot receive a bound capability, so nothing is looked up or fetched.
      const recipient = RecipientKeySchema.safeParse(extra._meta?.[RECIPIENT_KEY_META]);
      if (!recipient.success) return failure(PLAYBACK_UNSUPPORTED_TEXT);

      const decision = await options.backend.checkEntitlement(identity.accountId, episodeId);
      const episode = options.backend.findEpisode(episodeId);
      if (decision !== 'entitled' || !episode) return failure(PLAYBACK_DENIED_TEXT);

      const { kty, crv, x, y } = recipient.data;
      const recipientThumbprint = await calculateJwkThumbprint({ kty, crv, x, y });
      const issued = options.mediaService.issue({ accountId: identity.accountId, episodeId, recipientThumbprint });

      // Two projections, each built field by field. Only `_meta` carries the capability.
      return {
        content: [{ type: 'text', text: PLAYBACK_AUTHORIZED_TEXT }],
        _meta: {
          [PLAYBACK_RESULT_META]: {
            episodeId: episode.id,
            title: episode.title,
            mediaUrl: `${options.mediaOrigin}${MEDIA_PATH_PREFIX}${episode.id}`,
            capability: issued.capability,
            expiresAt: issued.expiresAt,
          },
        },
      };
    },
  );

  registerAppResource(server, 'Playback view', PLAYBACK_VIEW_URI, {}, async () => ({
    contents: [{ uri: PLAYBACK_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: options.viewHtml, _meta: { ui: { csp: VIEW_CSP } } }],
  }));

  return server;
}
