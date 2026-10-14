import { defineConfig } from 'vitest/config';

// Headless protocol tests run in plain Node: no DOM, no renderer.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
