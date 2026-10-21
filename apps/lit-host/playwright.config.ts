import { defineConfig } from '@playwright/test';
import { builtDirectory } from './e2e/built-artifacts.js';
import type { PlayerOptions } from './e2e/player-renderer.js';

// Smoke check runs against the built page served by `vite preview`. The served build is `dist`, or
// the build from the packed SDK packages when `SAGA_BUILT_DIR=dist-installed` (VIEW2).
// Playwright's default testMatch also matches `*.test.ts`; the fixture's headless unit tests live
// under e2e/ and run through Vitest, so restrict Playwright to the browser specs.
//
// Every spec runs once, in the `lit` project. The player spec runs a second time in the `react`
// project, against the React view of the same controller, actions and server (REACT2).
export default defineConfig<PlayerOptions>({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: [
    { name: 'lit', use: { playerRenderer: 'lit' } },
    {
      name: 'react',
      testMatch: '**/playback-view.spec.ts',
      use: { playerRenderer: 'react' },
    },
  ],
  webServer: {
    command: `npm run preview -- --outDir ${builtDirectory()}`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
