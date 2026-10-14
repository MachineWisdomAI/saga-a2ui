import { defineConfig } from '@playwright/test';

// Smoke check runs against the built page served by `vite preview`.
// Playwright's default testMatch also matches `*.test.ts`; the fixture's headless unit tests live
// under e2e/ and run through Vitest, so restrict Playwright to the browser specs.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
