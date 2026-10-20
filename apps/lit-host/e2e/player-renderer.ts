import { test as base } from '@playwright/test';

// The player view exists in two renderers over one controller, one set of actions and one server
// (REACT2): the Lit view and the React view. `playback-view.spec.ts` runs unchanged against each,
// selected by the `playerRenderer` option of the Playwright project it runs in
// (playwright.config.ts). A spec that is only true of one renderer says so with `test.skip`.

export type PlayerRenderer = 'lit' | 'react';

export interface PlayerOptions {
  readonly playerRenderer: PlayerRenderer;
}

/** The built single-file view of each renderer, relative to the selected build directory. */
export const PLAYER_VIEW: Readonly<Record<PlayerRenderer, string>> = {
  lit: 'playback-view/playback.html',
  react: 'playback-react-view/playback-react.html',
};

export const test = base.extend<PlayerOptions>({
  playerRenderer: ['lit', { option: true }],
});

export { expect } from '@playwright/test';
export type { FrameLocator, Page } from '@playwright/test';
