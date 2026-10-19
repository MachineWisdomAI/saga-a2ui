/**
 * The Markdown of the server's published output (`{ contractVersion: 1, markdown }`), or nothing if
 * the delivered value is anything else. Fields beyond those two are ignored here and never bound: a
 * result cannot select assets, CSS, a template or a policy.
 */
export function readAnswerMarkdown(structuredContent: unknown): string | undefined {
  if (typeof structuredContent !== 'object' || structuredContent === null) return undefined;
  const { contractVersion, markdown } = structuredContent as { contractVersion?: unknown; markdown?: unknown };
  return contractVersion === 1 && typeof markdown === 'string' ? markdown : undefined;
}
