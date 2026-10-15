import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// One headless inventory for the repository. Fixture tests live under apps/*/e2e and must
// stay included; Playwright specs are *.spec.ts and are not part of this include.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    root: repoRoot,
    environment: 'node',
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.wise-agents/**'],
  },
});
