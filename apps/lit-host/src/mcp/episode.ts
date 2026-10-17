import { z } from 'zod';

// Contract shared by the MCP server and the view. It imports only `zod`, so the browser
// bundle can use it without pulling in any server code.

export const EPISODE_TOOL_NAME = 'get_episode';
export const EPISODE_VIEW_URI = 'ui://saga-a2ui/episode-view.html';

/** Caller input: a short slug. Anything else is rejected before the catalog is consulted. */
export const EpisodeRequestSchema = z.object({
  episodeId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'episodeId must be 1-64 lowercase letters, digits or hyphens'),
});

/**
 * The only data this prototype publishes about an episode. Bounded so a result cannot grow
 * without limit; `description` is plain text and is never interpreted as markup or Markdown.
 */
export const PublicEpisodeSchema = z
  .object({
    episodeId: z.string().min(1).max(64),
    title: z.string().min(1).max(120),
    description: z.string().max(500),
  })
  .strict();

export type PublicEpisode = z.infer<typeof PublicEpisodeSchema>;
