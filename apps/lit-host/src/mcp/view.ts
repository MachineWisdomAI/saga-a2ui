import type { App } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { IngestResult } from '../protocols/a2ui/v0_9/session.js';
import { panelData } from '../saga-panel/fixture.js';
import { PublicEpisodeSchema } from './episode.js';

export interface EpisodeViewDependencies {
  /** The MCP Apps view bridge. Its transport is chosen by the composition root. */
  readonly app: App;
  readonly transport: Transport;
  /** Hands A2UI input to the renderer's session (decoding and validation live there). */
  readonly deliver: (input: unknown) => IngestResult;
  /** Shows a plain-text problem, or clears it when called with `undefined`. */
  readonly showProblem: (message: string | undefined) => void;
}

/**
 * Connects the view bridge, then renders each delivered tool result through the A2UI session.
 *
 * Delivery only: the result is checked against the public episode contract and turned into an
 * A2UI data-model update; A2UI decoding stays in the protocol module and presentation in the
 * Lit view. A result that is an error or is not a public episode changes nothing on screen.
 * The handler is installed before `connect`, so no early notification is missed.
 */
export async function connectEpisodeView(deps: EpisodeViewDependencies): Promise<void> {
  deps.app.ontoolresult = (result) => {
    if (result.isError) return deps.showProblem('The tool reported an error.');
    const episode = PublicEpisodeSchema.safeParse(result.structuredContent);
    if (!episode.success) return deps.showProblem('The tool result was not a public episode.');

    const outcome = deps.deliver(panelData(episode.data));
    deps.showProblem(outcome.ok ? undefined : outcome.failure.message);
  };
  await deps.app.connect(deps.transport);
}
