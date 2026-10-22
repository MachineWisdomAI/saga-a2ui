// What a delivery hands a view as the result of one operation, in terms no delivery owns. A
// delivery (MCP today) maps its own result onto this value; an application's reader decides what it
// means. Nothing here interprets: it names no schema, wording, fallback or error policy, and it
// imports no delivery, renderer or DOM.

/**
 * One piece of a result's ordered content. Its `type` is always kept. A text block also keeps its
 * `text`; any other block is carried exactly as the delivery supplied it, so a reader that knows
 * the block's shape can read it and one that does not leaves it alone.
 */
export interface ContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly [field: string]: unknown;
}

/**
 * The whole result of one operation, as delivered.
 *
 * - `isError` is the delivery's own error indication, kept as a boolean. What an error result
 *   means, and whether beside valid structured data, is the reader's decision.
 * - `content` holds every block in the order delivered, possibly none.
 * - `structuredContent` is unchecked. Absence of the field (`'structuredContent' in result` is
 *   false), a present `null` and malformed data are three different results, and a reader may
 *   treat them differently.
 */
export interface DeliveredResult {
  readonly isError: boolean;
  readonly content: readonly ContentBlock[];
  readonly structuredContent?: unknown;
}
