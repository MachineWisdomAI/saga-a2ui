import { defineConfig } from '@playwright/test';

// The Web target in Chromium. `npm run build` must have run first; the server serves `dist`.
// Tests share one server and keep state in the page they open, so they can run in parallel.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4174' },
  webServer: {
    command: 'npx tsx scripts/serve.ts',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
