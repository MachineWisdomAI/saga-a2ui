// The words the probe application shows, shared by the probe pages and the specification. Every
// failure has its own sentence, so a test can tell a readiness failure from a connect failure.
export const PROBE_TEXTS = {
  waiting: 'Waiting for the answer.',
  problem: 'The answer could not be shown.',
  connectFailure: 'The host did not answer.',
  readyFailure: 'The embedded fonts did not load.',
  policyFailure: 'The content policy is not valid.',
} as const;

/** The wording the probe application supplies when it rejects a result under its own reading. */
export const PROBE_UNSUPPORTED = 'This answer needs a newer version.';

/** The text an error result carries under the probe application's own reading, shown as its problem. */
export const PROBE_ERROR_TEXT = 'The service could not answer.';
