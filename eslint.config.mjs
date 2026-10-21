import tseslint from 'typescript-eslint';

// No recommended preset: opt into only correctness rules that add signal beyond tsc.
const rules = {
  'no-async-promise-executor': 'warn',
  'no-unsafe-finally': 'warn',
  'no-unreachable': 'warn',
  'no-sparse-arrays': 'warn',
  'use-isnan': 'warn',
  'valid-typeof': 'warn',
};
export default [
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-installed/**',
      '**/generated/**',
      '**/*.generated.*',
      '**/coverage/**',
      'candidate-out/**',
      'release-out/**',
      'docs/evidence/**',
      'docs/artifacts/**',
      'vendor/**',
      'third_party/**',
      '.wise-agents/**',
      '.claude/**',
      '.codex/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules,
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn' },
  },
];
