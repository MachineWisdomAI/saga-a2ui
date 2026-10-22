// The words the probe application shows, shared by the probe pages and the specification. Every
// failure has its own sentence, so a test can tell a readiness failure from a connect failure.
export const PROBE_TEXTS = {
  waiting: 'Waiting for the answer.',
  problem: 'The answer could not be shown.',
  connectFailure: 'The host did not answer.',
  readyFailure: 'The embedded fonts did not load.',
  policyFailure: 'The content policy is not valid.',
} as const;
