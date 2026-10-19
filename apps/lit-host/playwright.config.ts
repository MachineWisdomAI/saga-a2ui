import { defineConfig } from '@playwright/test';
import { builtDirectory } from './e2e/built-artifacts.js';

// Smoke check runs against the built page served by `vite preview`. The served build is `dist`, or
// the build from the packed SDK packages when `SAGA_BUILT_DIR=dist-installed` (VIEW2).
// Playwright's default testMatch also matches `*.test.ts`; the fixture's headless unit tests live
// under e2e/ and run through Vitest, so restrict Playwright to the browser specs.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: `npm run preview -- --outDir ${builtDirectory()}`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
