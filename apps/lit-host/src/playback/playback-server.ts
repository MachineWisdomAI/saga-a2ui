import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { calculateJwkThumbprint } from 'jose';
import { identityFromAuthInfo } from '../mcp/request-auth.js';
import type { ViewSessionLabeler } from '../mcp/subscriptions-server.js';
import type { MediaService } from './media-service.js';
import { ZodError } from 'zod';
import {
  MEDIA_PATH_PREFIX,
  ModelPlaybackSchema,
  OPEN_TOOL_NAME,
  OpenedEpisodeSchema,
  PLAY_TOOL_NAME,
  PLAYBACK_NO_EPISODE_TEXT,
  PLAYBACK_AUTHORIZED_TEXT,
  PLAYBACK_DENIED_TEXT,
  PLAYBACK_INVALID_RESULT_TEXT,
  PLAYBACK_RESULT_META,
  PLAYBACK_UNAVAILABLE_TEXT,
  PLAYBACK_UNSUPPORTED_TEXT,
  PLAYBACK_VIEW_URI,
  PlayRequestSchema,
  RECIPIENT_KEY_META,
  RecipientKeySchema,
  ViewEpisodeSchema,
  ViewPlaybackSchema,
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
  /** Mints the opaque sign-in label the view uses to notice a changed sign-in. */
  readonly labelViewSession: ViewSessionLabeler;
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

      // The pinned SDK copies a thrown message into the tool failure, so nothing escapes this
      // handler as an exception: a backend failure is a fixed sentence, and so is a contract fault.
      try {
        const decision = await options.backend.checkEntitlement(identity.accountId, episodeId);
        const episode = options.backend.findEpisode(episodeId);
        if (decision !== 'entitled' || !episode) return failure(PLAYBACK_DENIED_TEXT);

        // The public fields are validated before a capability exists, so a record that breaks the
        // contract leaves no issued-but-undelivered grant behind.
        const shown = ViewEpisodeSchema.parse({ episodeId: episode.id, title: episode.title });
        const { kty, crv, x, y } = recipient.data;
        const recipientThumbprint = await calculateJwkThumbprint({ kty, crv, x, y });
        const issued = options.mediaService.issue({ accountId: identity.accountId, episodeId, recipientThumbprint });

        // Two projections, each built field by field and validated before serialization. Only
        // the view's, in `_meta`, carries the capability.
        const forModel = ModelPlaybackSchema.parse({ text: PLAYBACK_AUTHORIZED_TEXT });
        const forView = ViewPlaybackSchema.parse({
          episodeId: shown.episodeId,
          title: shown.title,
          viewSession: options.labelViewSession(identity.signInId),
          mediaUrl: `${options.mediaOrigin}${MEDIA_PATH_PREFIX}${shown.episodeId}`,
          capability: issued.capability,
          expiresAt: issued.expiresAt,
        });
        return { content: [{ type: 'text', text: forModel.text }], _meta: { [PLAYBACK_RESULT_META]: forView } };
      } catch (error) {
        return failure(error instanceof ZodError ? PLAYBACK_INVALID_RESULT_TEXT : PLAYBACK_UNAVAILABLE_TEXT);
      }
    },
  );

  // The only model-visible tool. A host renders a view when a tool that links it is called, and
  // the model cannot call Play, so this is what mounts the player. It checks no entitlement and
  // issues nothing: it publishes the same public fields `get_episode` does, plus the sign-in label.
  server.registerTool(
    OPEN_TOOL_NAME,
    {
      title: 'Open playable episode',
      description: 'Shows one episode with a Play control. Playing it needs a signed-in listener with access.',
      inputSchema: PlayRequestSchema,
      outputSchema: OpenedEpisodeSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: PLAYBACK_VIEW_URI }, 'ui/resourceUri': PLAYBACK_VIEW_URI },
    },
    async ({ episodeId }, extra) => {
      const identity = identityFromAuthInfo(extra.authInfo);
      if (!identity) return failure(PLAYBACK_UNSUPPORTED_TEXT);
      try {
        const episode = options.backend.findEpisode(episodeId);
        if (!episode) return failure(PLAYBACK_NO_EPISODE_TEXT);
        const opened = OpenedEpisodeSchema.parse({
          episodeId: episode.id,
          title: episode.title,
          description: episode.description,
          viewSession: options.labelViewSession(identity.signInId),
        });
        return { content: [{ type: 'text', text: `${opened.title} (${opened.episodeId})` }], structuredContent: opened };
      } catch (error) {
        return failure(error instanceof ZodError ? PLAYBACK_INVALID_RESULT_TEXT : PLAYBACK_UNAVAILABLE_TEXT);
      }
    },
  );

  registerAppResource(server, 'Playback view', PLAYBACK_VIEW_URI, {}, async () => ({
    contents: [{ uri: PLAYBACK_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: options.viewHtml, _meta: { ui: { csp: VIEW_CSP } } }],
  }));

  return server;
}
