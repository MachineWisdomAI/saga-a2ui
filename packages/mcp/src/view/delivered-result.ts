import type {
  ContentBlock,
  DeliveredResult,
} from '@saga-a2ui/core/delivered-result';
import type { ToolResult } from './run-tool-result-view.js';

/**
 * Maps one MCP tool result onto the delivery-neutral {@link DeliveredResult}, keeping what MCP
 * said and deciding nothing about what it means. `isError` becomes a boolean, `content` keeps
 * every block in delivered order (each block as supplied, so a text block keeps its text and any
 * other block stays opaque), and `structuredContent` is present exactly when MCP delivered a
 * value, `null` included. An application's reader gives all of it meaning.
 *
 * A tool result arrives from the host's bridge unchecked. One whose content cannot be carried
 * faithfully (not a list of blocks, or a block without a type, or a text block without its text)
 * throws a `TypeError`; the caller handles that as a failed reading.
 */
export function deliveredResultFromToolResult(
  result: ToolResult,
): DeliveredResult {
  if (typeof result !== 'object' || result === null)
    throw new TypeError('The tool result is not an object.');
  const { content, isError, structuredContent } = result as {
    content?: unknown;
    isError?: unknown;
    structuredContent?: unknown;
  };
  if (!Array.isArray(content))
    throw new TypeError('The tool result has no content list.');
  const blocks = content.map((block: unknown, index): ContentBlock => {
    if (typeof block !== 'object' || block === null)
      throw new TypeError(`Content block ${index} is not an object.`);
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (typeof type !== 'string')
      throw new TypeError(`Content block ${index} has no string type.`);
    if (type === 'text' && typeof text !== 'string')
      throw new TypeError(`Text block ${index} has no string text.`);
    // Checked above to carry a string type (and its text when it is a text block).
    return block as ContentBlock;
  });
  return {
    isError: isError === true,
    content: blocks,
    ...(structuredContent === undefined ? {} : { structuredContent }),
  };
}
