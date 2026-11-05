/**
 * The most array elements and object members one `tools/call` `arguments` payload may hold, for
 * the `maxToolInputElements` option of the official `McpServer`. Without that option the server
 * parses and validates whatever the request body holds, up to the transport's byte limit; with it,
 * an oversized payload is refused with an invalid-params error before the tool's schema runs.
 *
 * Pass it on every server you build:
 *
 *     new McpServer(info, { maxToolInputElements: DEFAULT_MAX_TOOL_INPUT_ELEMENTS })
 *
 * The count is every element of every array plus every member of every object, nested ones
 * included. Operations in this repository take a handful of members (a question, an identifier,
 * a short record), so 256 leaves more than an order of magnitude of headroom over a legitimate
 * call while keeping the work a single call can cause small. An application whose tools really
 * take larger structured input passes its own finite number instead.
 */
export const DEFAULT_MAX_TOOL_INPUT_ELEMENTS = 256;
