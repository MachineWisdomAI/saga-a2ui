import type {
  CardResultOutcome,
  DeliveredResult,
} from '@saga-a2ui/react-mcp-stack/faithful-card';

/**
 * The application's one reading of a whole delivered result. Only the server's published output
 * (`{ contractVersion: 1, markdown }`) is shown, and an error result is never shown, even beside
 * valid structured content. Anything else is rejected without wording, so the definition's
 * `texts.problem` is shown. Fields beyond those two are ignored here and never bound: a result
 * cannot select assets, CSS, a template or a policy.
 */
export function readAnswerResult(result: DeliveredResult): CardResultOutcome {
  const rejected: CardResultOutcome = { kind: 'rejected' };
  if (result.isError) return rejected;
  const { structuredContent } = result;
  if (typeof structuredContent !== 'object' || structuredContent === null)
    return rejected;
  const { contractVersion, markdown } = structuredContent as {
    contractVersion?: unknown;
    markdown?: unknown;
  };
  return contractVersion === 1 && typeof markdown === 'string'
    ? { kind: 'content', content: { markdown } }
    : rejected;
}
