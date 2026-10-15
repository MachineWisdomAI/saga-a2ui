import { z } from 'zod';

// Contract shared by the playback MCP server and the view. It imports only `zod`, so the
// browser bundle can use it without pulling in any server code.

export const PLAY_TOOL_NAME = 'play_episode';
export const PLAYBACK_VIEW_URI = 'ui://saga-a2ui/playback-view.html';

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
