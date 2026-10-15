import { z } from 'zod';

// Contract shared by the playback MCP server and the view. It imports only `zod`, so the
// browser bundle can use it without pulling in any server code.

export const PLAY_TOOL_NAME = 'play_episode';
export const PLAYBACK_VIEW_URI = 'ui://saga-a2ui/playback-view.html';

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

/** Tool failure: the account is not entitled to this episode (or the episode does not exist). */
export const PLAYBACK_DENIED_TEXT = 'Playback denied: this account does not have access to this episode.';

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
  d: z.undefined(),
});

/** Finite bounds for the Play request. Enforced before the handler or any backend is reached. */
export const PLAYBACK_LIMITS = {
  maxRequestBytes: 8_192,
  maxArgumentString: 64,
  maxArgumentElements: 4,
} as const;

/**
 * The only business input Play accepts. Strict, so a forged `accountId` (or any other field)
 * is rejected as invalid input instead of being silently dropped: the caller is the verified
 * principal, never a value in the arguments.
 */
export const PlayRequestSchema = z
  .object({
    episodeId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'episodeId must be 1-64 lowercase letters, digits or hyphens'),
  })
  .strict();
