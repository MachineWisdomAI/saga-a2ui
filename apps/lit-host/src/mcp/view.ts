import type { BoundSurface, ToolResult } from '@saga-a2ui/lit-mcp-stack';
import type { PanelData } from '../saga-panel/fixture.js';
import { PublicEpisodeSchema } from './episode.js';

/** The panel with no episode in it: what is shown while a problem is. The panel draws nothing for it. */
export const NO_EPISODE: PanelData = { title: '', description: '' };

export interface EpisodeViewDependencies {
  /** Changes what the panel shows: the bound surface the stack gives the running view. */
  readonly update: BoundSurface<PanelData>['update'];
  /** Shows a plain-text problem, or clears it when called with `undefined`. */
  readonly showProblem: (message: string | undefined) => void;
  /**
   * Ends the reader's consent to load images in this view. Called before each delivered result is
   * applied (a new result is a new selection, even when its description is unchanged), so a view
   * never shows images the reader agreed to for what it showed before. The view stays live, so
   * the reader can consent again to the new selection.
   */
  readonly revokeImageConsent: () => void;
}

/**
 * Renders each delivered tool result as the episode panel.
 *
 * Delivery only: the result is checked against the public episode contract and turned into
 * panel data; the surface, its typed update and the view's lifetime are the stack's.
 *
 * - Each valid result replaces the one shown.
 * - An error or non-episode result empties the panel and shows a plain-text fallback, so stale
 *   content is never left beside a problem.
 * - A result the surface rejects is treated like any other failure: panel emptied, reason shown.
 * - Image consent is revoked before any result is applied.
 */
export function createEpisodeView(deps: EpisodeViewDependencies): {
  onToolResult(result: ToolResult): void;
} {
  const showFailure = (problem: string) => {
    deps.update(NO_EPISODE);
    deps.showProblem(problem);
  };

  return {
    onToolResult(result) {
      deps.revokeImageConsent();
      if (result.isError) return showFailure('The tool reported an error.');
      const episode = PublicEpisodeSchema.safeParse(result.structuredContent);
      if (!episode.success)
        return showFailure('The tool result was not a public episode.');

      const outcome = deps.update({
        title: episode.data.title,
        description: episode.data.description,
      });
      if (!outcome.ok) return showFailure(outcome.failure.message);
      deps.showProblem(undefined);
    },
  };
}
