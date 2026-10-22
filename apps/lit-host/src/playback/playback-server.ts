import {
  McpServer,
  type CallToolResult,
  type ServerContext,
} from '@modelcontextprotocol/server';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'; // saga-boundary: integration-import backend registration of the Play and Open tools and the player view resource with the MCP Apps server API; this server module is the backend side and never touches the view bridge
import { calculateJwkThumbprint } from 'jose';
import {
  throwIfEnded,
  valueOrThrow,
  type BoundedScope,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
import { identityFromAuthInfo } from '../mcp/request-auth.js';
import type { ViewSessionLabeler } from '../mcp/subscriptions-server.js';
import type { EntitlementDecision, MediaService } from './media-service.js';
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

/** The application's data seam. Entitlement is decided from the verified account, never from arguments. */
export interface PlaybackBackend {
  findEpisode(episodeId: string): EpisodeRecord | undefined;
  /** `signal` aborts when the lookup is abandoned (its budget, the request's deadline or the caller). */
  checkEntitlement(
    accountId: string,
    episodeId: string,
    signal: AbortSignal,
  ): Promise<EntitlementDecision>;
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
  /** The request this server was built for. Each tool call is one bounded handler operation inside it. */
  readonly lifetime: RequestLifetime;
}

/**
 * The player fetches bytes with `fetch` and decodes them with Web Audio, so it needs `connect-src`
 * for the media origin and nothing else: no script, style, image, media element or frame origin.
 */
const viewCsp = (mediaOrigin: string) =>
  ({
    connectDomains: [mediaOrigin],
    resourceDomains: [],
    frameDomains: [],
    baseUriDomains: [],
  }) as const;

const failure = (text: string) => ({
  isError: true as const,
  content: [{ type: 'text' as const, text }],
});

/**
 * Runs one tool's whole handler as a bounded operation of the request. Expiry, the caller's
 * cancellation and a call that arrives after the request ended all answer with the fixed unavailable
 * sentence, and a handler that is still running afterwards finds its scope ended. Each stage that
 * could start an effect checks that first (`throwIfEnded`), because the race stops the waiting but
 * cannot stop the code.
 */
async function boundedHandler(
  options: PlaybackServerOptions,
  ctx: ServerContext,
  work: (scope: BoundedScope) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const { lifetime } = options;
  const outcome = await lifetime.run('handler', work, {
    upstream: ctx.mcpReq.signal,
  });
  if (outcome.ok) return outcome.value;
  lifetime.record(outcome.cause);
  return failure(PLAYBACK_UNAVAILABLE_TEXT);
}

/**
 * One app-only Play operation. `visibility: ['app']` makes the host offer it to the embedded
 * view and withhold it from the model's tool list.
 */
export function createPlaybackServer(
  options: PlaybackServerOptions,
): McpServer {
  const server = new McpServer({
    name: 'saga-a2ui-playback-demo',
    version: '0.0.0',
  });

  // The input is a strict object, so a forged `accountId` is rejected instead of dropped.
  // `registerAppTool` also writes the legacy flat `ui/resourceUri` key that older hosts read.
  registerAppTool(
    server,
    PLAY_TOOL_NAME,
    {
      title: 'Play episode',
      description:
        'Starts foreground playback of one episode for the signed-in listener.',
      inputSchema: PlayRequestSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: PLAYBACK_VIEW_URI, visibility: ['app'] } },
    },
    async ({ episodeId }, ctx) => {
      // The principal comes only from the verified request context, never from the arguments.
      const identity = identityFromAuthInfo(ctx.http?.authInfo);
      if (!identity) return failure(PLAYBACK_UNSUPPORTED_TEXT); // the listener already refused this; fail closed anyway

      // Routing is checked before any protected work: without a usable recipient key the view
      // cannot receive a bound capability, so nothing is looked up or fetched.
      const recipient = RecipientKeySchema.safeParse(
        ctx.mcpReq._meta?.[RECIPIENT_KEY_META],
      );
      if (!recipient.success) return failure(PLAYBACK_UNSUPPORTED_TEXT);

      return boundedHandler(options, ctx, async (scope) => {
        // The pinned SDK copies a thrown message into the tool failure, so nothing escapes this
        // handler as an exception: a backend failure is a fixed sentence, and so is a contract fault.
        try {
          const decision = valueOrThrow(
            await scope.run('authorization', (stage) =>
              options.backend.checkEntitlement(
                identity.accountId,
                episodeId,
                stage.signal,
              ),
            ),
          );
          const episode = options.backend.findEpisode(episodeId);
          if (decision !== 'entitled' || !episode)
            return failure(PLAYBACK_DENIED_TEXT);

          // The public fields are validated before a capability exists, so a record that breaks the
          // contract leaves no issued-but-undelivered grant behind.
          const shown = ViewEpisodeSchema.parse({
            episodeId: episode.id,
            title: episode.title,
          });
          const { kty, crv, x, y } = recipient.data;
          const recipientThumbprint = await calculateJwkThumbprint({
            kty,
            crv,
            x,
            y,
          });
          // The lookup above may have answered after this handler was abandoned. No capability is
          // issued for a request the gate has closed.
          throwIfEnded(scope);
          const issued = options.mediaService.issue({
            accountId: identity.accountId,
            episodeId,
            recipientThumbprint,
          });

          // Two projections, each built field by field and validated before serialization. Only
          // the view's, in `_meta`, carries the capability.
          const forModel = ModelPlaybackSchema.parse({
            text: PLAYBACK_AUTHORIZED_TEXT,
          });
          const forView = ViewPlaybackSchema.parse({
            episodeId: shown.episodeId,
            title: shown.title,
            viewSession: options.labelViewSession(identity.signInId),
            mediaUrl: `${options.mediaOrigin}${MEDIA_PATH_PREFIX}${shown.episodeId}`,
            capability: issued.capability,
            expiresAt: issued.expiresAt,
          });
          return {
            content: [{ type: 'text', text: forModel.text }],
            _meta: { [PLAYBACK_RESULT_META]: forView },
          };
        } catch (error) {
          if (error instanceof ZodError)
            return failure(PLAYBACK_INVALID_RESULT_TEXT);
          throw error; // an ended scope or a failed dependency: the bounded handler records the cause and answers unavailable
        }
      });
    },
  );

  // The only model-visible tool. A host renders a view when a tool that links it is called, and
  // the model cannot call Play, so this is what mounts the player. It checks no entitlement and
  // issues nothing: it publishes the same public fields `get_episode` does, plus the sign-in label.
  registerAppTool(
    server,
    OPEN_TOOL_NAME,
    {
      title: 'Open playable episode',
      description:
        'Shows one episode with a Play control. Playing it needs a signed-in listener with access.',
      inputSchema: PlayRequestSchema,
      outputSchema: OpenedEpisodeSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: PLAYBACK_VIEW_URI } },
    },
    async ({ episodeId }, ctx) => {
      const identity = identityFromAuthInfo(ctx.http?.authInfo);
      if (!identity) return failure(PLAYBACK_UNSUPPORTED_TEXT);
      return boundedHandler(options, ctx, async () => {
        try {
          const episode = options.backend.findEpisode(episodeId);
          if (!episode) return failure(PLAYBACK_NO_EPISODE_TEXT);
          const opened = OpenedEpisodeSchema.parse({
            episodeId: episode.id,
            title: episode.title,
            description: episode.description,
            viewSession: options.labelViewSession(identity.signInId),
          });
          return {
            content: [
              { type: 'text', text: `${opened.title} (${opened.episodeId})` },
            ],
            structuredContent: opened,
          };
        } catch (error) {
          if (error instanceof ZodError)
            return failure(PLAYBACK_INVALID_RESULT_TEXT);
          throw error;
        }
      });
    },
  );

  registerAppResource(
    server,
    'Playback view',
    PLAYBACK_VIEW_URI,
    {},
    async () => ({
      contents: [
        {
          uri: PLAYBACK_VIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: options.viewHtml,
          _meta: { ui: { csp: viewCsp(options.mediaOrigin) } },
        },
      ],
    }),
  );

  return server;
}
