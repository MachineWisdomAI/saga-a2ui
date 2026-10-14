import { defineConfig } from 'vitest/config';

// Headless tests run in plain Node: no DOM, no renderer. They cover the protocol modules in
// src/ and the fixture's pure policy module in e2e/host-fixture.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'] },
});
