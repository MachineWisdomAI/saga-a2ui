import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';
export default defineConfig({
  ...base,
  use: { ...base.use, launchOptions: { executablePath: '/opt/hermes/tools/chromium-1208/chrome-linux64/chrome', args: ['--no-sandbox'] } },
});
