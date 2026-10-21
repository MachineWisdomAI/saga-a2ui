import { z } from 'zod';
import { PublicEpisodeSchema } from '../mcp/episode.js';
import { ViewSessionLabelSchema } from '../mcp/subscriptions.js';

// Contract shared by the playback MCP server and the view. It imports only `zod` (and the
// sibling contract module that does the same), so the browser bundle can use it without
// pulling in any server code.

export const PLAY_TOOL_NAME = 'play_episode';
/** The model-visible tool whose result mounts the player view. It never grants playback. */
export const OPEN_TOOL_NAME = 'get_playable_episode';
export const PLAYBACK_VIEW_URI = 'ui://saga-a2ui/playback-view.html';

/** Path prefix of the synthetic media service: `<prefix><episodeId>`. The listener serves it; the view fetches it. */
export const MEDIA_PATH_PREFIX = '/playback/media/';

/**
 * `_meta` key on the view's `tools/call` that carries the view's public recipient key (a JWK).
 * The arguments stay `{ episodeId }`; the key is request metadata, not business input.
 */
export const RECIPIENT_KEY_META = 'saga-a2ui/recipient-key';

/**
 * `_meta` key on the Play result that carries the view-only projection. MCP Apps documents
 * `_meta` as data "not intended for model context"; `content` and `structuredContent` are the
 * model-visible channels and never carry anything from here.
 */
export const PLAYBACK_RESULT_META = 'saga-a2ui/playback';

/**
 * The longest one host call may be waited for by the transport itself. The MCP Apps client's own
 * request timeout is 60,000 ms; this mirrors it so the call's timeout is never wider than that
 * narrower safeguard even when more of the attempt remains.
 */
export const HOST_CALL_SAFEGUARD_MS = 60_000;

/** Tool failure: the account is not entitled to this episode (or the episode does not exist). */
export const PLAYBACK_DENIED_TEXT =
  'Playback denied: this account does not have access to this episode.';

/** Tool failure: the host cannot route the private result to the view, so nothing was fetched. */
export const PLAYBACK_UNSUPPORTED_TEXT = 'Playback is not supported here.';

/** Model-visible outcome of an authorized Play. It carries no capability and no private field. */
export const PLAYBACK_AUTHORIZED_TEXT = 'Playback authorized.';

/**
 * The view's public recipient key: an ECDSA P-256 public JWK. The private component `d` must
 * never arrive; unknown members such as `ext` and `key_ops` (which WebCrypto adds on export) are
 * ignored, so only the four members that identify the key are read.
 */
export const RecipientKeySchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  d: z.undefined().optional(),
});

/** Finite bounds for the Play request. Enforced before the handler or any backend is reached. */
export const PLAYBACK_LIMITS = {
  maxRequestBytes: 8_192,
  maxArgumentString: 64,
  maxArgumentElements: 4,
} as const;

/** Tool failure: the known tool was called with input it does not accept. Never echoes the input. */
export const PLAYBACK_UNREADABLE_REQUEST_TEXT =
  'That play request could not be read.';

/** Tool failure: a backend or dependency failed. Safe to retry. Carries no backend detail. */
export const PLAYBACK_UNAVAILABLE_TEXT = 'Playback is unavailable.';

/** Tool failure: the result broke its own contract, so nothing was sent. Carries no field values. */
export const PLAYBACK_INVALID_RESULT_TEXT =
  'The playback result could not be shown.';

/** The one rule for an episode id: a short lowercase slug. Requests and projections both use it. */
const EPISODE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The only business input Play accepts. Strict, so a forged `accountId` (or any other field)
 * is rejected as invalid input instead of being silently dropped: the caller is the verified
 * principal, never a value in the arguments. Every issue carries the same fixed sentence, because
 * the MCP SDK copies zod's issue text into the tool failure it returns.
 */
export const PlayRequestSchema = z.strictObject(
  {
    episodeId: z
      .string({ error: PLAYBACK_UNREADABLE_REQUEST_TEXT })
      .regex(EPISODE_SLUG, PLAYBACK_UNREADABLE_REQUEST_TEXT),
  },
  { error: PLAYBACK_UNREADABLE_REQUEST_TEXT },
);

/**
 * Model projection: the only thing the model is ever told about a Play. Fixed text, no fields
 * from the request, the account, the episode record or the capability.
 */
export const ModelPlaybackSchema = z
  .object({ text: z.literal(PLAYBACK_AUTHORIZED_TEXT) })
  .strict();

/** The public part of the view projection: what the listener may see about the episode. */
export const ViewEpisodeSchema = z
  .object({
    episodeId: z.string().regex(EPISODE_SLUG),
    title: z.string().min(1).max(120),
  })
  .strict();

/**
 * View projection: the only place a capability may appear. Strict and bounded, so an unknown or
 * oversized field fails before the result is serialized. It is validated again by the view
 * before any media is mounted.
 */
export const ViewPlaybackSchema = ViewEpisodeSchema.extend({
  /** Which sign-in was granted playback. Freshness only; it never authorizes anything. */
  viewSession: ViewSessionLabelSchema,
  mediaUrl: z.string().max(300),
  capability: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.number().int().positive(),
}).strict();

export type ViewPlayback = z.infer<typeof ViewPlaybackSchema>;

/** Tool failure: the opener found no episode with that id. */
export const PLAYBACK_NO_EPISODE_TEXT = 'No playable episode has that id.';

/**
 * What mounting the player view may carry: the public episode and the sign-in label, nothing
 * else. It is deliberately not entitlement-aware: browsing an episode is not permission to play it.
 */
export const OpenedEpisodeSchema = PublicEpisodeSchema.extend({
  viewSession: ViewSessionLabelSchema,
}).strict();

export type OpenedEpisode = z.infer<typeof OpenedEpisodeSchema>;
