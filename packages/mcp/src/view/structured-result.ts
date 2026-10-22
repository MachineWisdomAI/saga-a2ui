import type { ToolResult } from './run-tool-result-view.js';

/**
 * The default reading of one delivered result, and the one place that decides what MCP's
 * `isError` and `structuredContent` mean for it: an error result is rejected unread, and any
 * other result is read through `parse` from `structuredContent` alone. `undefined` is a rejection.
 *
 * A stack that offers an application its own whole-result reading uses this as the default
 * beneath it, so every stack makes this decision the same way. A throw from `parse` is the
 * caller's to handle.
 */
export function readStructuredResult<Content>(
  result: ToolResult,
  parse: (structuredContent: unknown) => Content | undefined,
): Content | undefined {
  if (result.isError === true) return undefined;
  return parse(result.structuredContent);
}
