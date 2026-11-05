# Host MCP operations through Fetch

`createMcpFetchApp` serves an application's MCP operations through a standard `fetch(Request)` function. Use it in a Cloudflare Worker, or place the same function behind a Node listener you choose. The SDK admits requests by Host and Origin, hands them to the official MCP handler, and ends each request's lifetime when its server closes. Your application supplies the operations, rendered view, stored data and settings.

The helper is introduced in `0.10.0-rc.1`. It ships in the 1.0 packages; see [public installation](public-install.md) for the install recipe. Import it from your stack's `/server/http` entry; the Lit and React stacks offer the same function. A lower-level integration can import it from `@saga-a2ui/mcp/server/http`.

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { DEFAULT_MAX_TOOL_INPUT_ELEMENTS } from '@saga-a2ui/react-mcp-stack/server';
import { createMcpFetchApp } from '@saga-a2ui/react-mcp-stack/server/http';

const app = createMcpFetchApp({
  path: '/mcp',
  allowedHosts: ['mcp.example.com'],
  allowedOrigins: ['mcp.example.com'],
  createServer(lifetime) {
    const server = new McpServer(
      { name: 'my-app', version: '1.0.0' },
      { maxToolInputElements: DEFAULT_MAX_TOOL_INPUT_ELEMENTS },
    );
    // Register your operations here, passing { lifetime } to each registration.
    return server;
  },
});

// Cloudflare Worker:
export default { fetch: (request: Request) => app.fetch(request) };
```

Behind a Node listener, pass each incoming request to `app.fetch` through your framework's Fetch adapter, and call `await app.close()` when the application stops.

## What you supply

- `createServer(lifetime)` returns a fresh `McpServer` for each protocol request. Register operations with `registerPublicOperation` or `registerProtectedOperation`, passing `{ lifetime }`. Keep shared state, such as a game store, outside this callback. Give every server `maxToolInputElements: DEFAULT_MAX_TOOL_INPUT_ELEMENTS` (a finite limit on the array elements and object members of one tool call, 256 by default): the official server applies no limit unless it is set, and `maxRequestBodySize` bounds bytes, not structure. Do not subclass the server to finish the lifetime: the SDK attaches the existing request-lifetime closure, so the lifetime ends once when the server closes, with or without a connected transport. If your callback throws, the lifetime ends once and the request fails. The callback may return a promise, and the SDK waits for it only as long as the request budget allows: a callback that never settles ends the request when that budget is spent, with the same fixed failure as a throw. A server it returns after that point is closed and never serves a request, so construction work that ignores `lifetime.signal` still cannot hold a request open or leave a late server behind (it can still run to its end; stop it through the signal if you can).
- `allowedHosts` and `allowedOrigins` are explicit lists of host names (without scheme or port). Entries are trimmed and de-duplicated. An empty list admits no Host, or no Origin, and the SDK adds no `localhost` entries. A request without an Origin header is not refused for that reason, as non-browser MCP clients send none; a request with an Origin must match your list. Missing or blank settings fail when you create the app, before any traffic. Reading these lists from environment variables or bindings stays in your application.
- `path` is one exact route, `/mcp` unless stated. It is a literal path: no parameter, wildcard, query or trailing slash. Any other path answers `404` and runs no application code. A refused Host or Origin answers `403` before the factory runs, so no operation, and no backend effect, starts.
- `responseMode` is `json` (the default) or `sse`. In `json` mode the official handler returns the terminal result for 2026-07-28 requests and drops progress sent before it; use `sse` if clients should receive progress. Older-protocol exchanges are always served by the official stateless fallback. Optional `budgets` take the same settings as `createServerBudgets`, and an invalid value fails when you create the app. `maxRequestBodySize` is passed to the official handler (4 MiB by default).
- `onFailure(kind)` receives only `server-factory`, `handler` or `route`. It never receives tool arguments, responses, credentials or an exception, and an exception in the callback is ignored. Responses to failed requests carry fixed text.

`app.close()` delegates shutdown to the official handler and aborts in-flight exchanges. Repeated calls reuse the same shutdown.

## What the SDK does not do

The function starts no listener, reads no environment variable or file, forwards requests to no upstream, and adds no body reader of its own, proxy or connection teardown. It runs the official bounded reader under the request budget, over a relay it can cancel. It keeps no per-request state between requests. It supplies no authentication; verify identity in your listener or entry point and pass it to protected operations as you do today.

## Time limits

The request budget starts when the app admits a request, after the Host, Origin and path checks and before the body is read. The declared size, the observed size, the time the body takes, the JSON parse and the construction of the server all count against it, and `createServer` is not called for a request that ends there or that arrives at the factory with its budget already spent. The app checks the budget again inside the construction stage immediately before it invokes the callback, because setting that stage up spends the budget too; a stage that has ended by then is answered with 408 and your callback is not called. That is a check at those points, not a guarantee about the time between adjacent operations. The callback may use whatever the request budget has left. When the budget ends a read that is waiting, the app cancels the request body, so it is pulled no further and is not left locked. A body that stalls past the budget (or past the operation budget, which also bounds the body stage) is answered once with 408, a body over `maxRequestBodySize` with 413 and malformed JSON with 400. A 408 asks the listener to close the connection (`Connection: close`). A 413 or 400 does not, so a client that is still sending the refused body can finish and read the answer; the listener discards the unread rest under its own limits. `@hono/node-server` discards at most 64 MiB within 500 ms, then closes the socket. A `fetch` function cannot close a socket itself: the platform or listener still owns network admission, socket and server timeouts, and shutdown, so keep its own header and idle timeouts as well. A canceled local wait does not show that a remote backend effect stopped.

## Cloudflare Workers

Enable the `nodejs_compat` compatibility flag. The MCP SDK, and the SDK's view identity hash, use Node's `crypto`. The shared Fetch entry imports no Node listener, filesystem or process-environment module. Bind your own settings and storage in the Worker's entry point and pass them to `createMcpFetchApp` and your operations.

## Qualification

`scripts/fetch-consumer.test.ts` installs the packed packages in a clean directory outside the repository, builds one application composition, and runs it twice: as a Worker in the real `workerd` runtime (through Miniflare, with `nodejs_compat`), and behind a Node `http` listener. In both, an MCP client lists tools, calls an operation and reads its declared view, and requests with an unlisted Host, an unlisted Origin or another path run no application code. The unit tests in `packages/mcp/src/server/http/fetch-app.test.ts` cover route selection, Host and Origin rules (including an absent Origin and empty lists), JSON and SSE delivery, configuration errors, and lifetime release on factory failure and on closing before or after a transport connects.

These results come from source and packed candidate packages. They are not an observation of a published package or a deployed host.
