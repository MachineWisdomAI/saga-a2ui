import { defineConfig } from '@playwright/test';

// Smoke check runs against the built page served by `vite preview`.
export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
