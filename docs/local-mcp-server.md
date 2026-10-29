# Run a local MCP server

`startLocalMcpServer` runs an application's MCP operations on a local Node server. It is a small [Hono](https://hono.dev/docs/getting-started/basic) app built with the official `createMcpHonoApp` from `@modelcontextprotocol/hono`, served on Node. It handles request admission, the MCP transport and shutdown. Your application supplies the operations, rendered view and stored data.

The helper is introduced in `0.9.0-rc.1`. Check [public installation](public-install.md) for registry availability before choosing a version. Import it from your stack's `/server/node` entry; the Lit stack offers the same helper. A lower-level integration can import it from `@saga-a2ui/mcp/server/node`.

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { startLocalMcpServer } from '@saga-a2ui/react-mcp-stack/server/node';

const listener = await startLocalMcpServer({
  port: 3000,
  createServer() {
    const server = new McpServer({ name: 'my-app', version: '1.0.0' });
    // Register your operations here.
    return server;
  },
});

console.log(listener.url); // http://127.0.0.1:3000/mcp
// Call await listener.close() when the application stops.
```

The callback creates a fresh MCP server for each admitted request. Keep shared application state, such as a game store, outside that callback. Load the built view before starting the listener, then reuse it when registering operations. Each operation runs under the SDK's default operation and request deadlines.

The listener binds only to `127.0.0.1` and serves `/mcp`. It accepts `localhost` and `127.0.0.1` Host headers and the official MCP adapter's localhost Origin policy. Requests without an Origin header are allowed, as needed by server-to-server MCP clients. A development tunnel must forward an accepted Host header; for Cloudflare Quick Tunnel, use `--http-host-header localhost`.

Requests have a 1 MiB body limit: an oversized body receives 413 and malformed JSON receives 400, both from the official adapter.

`close()` closes the MCP handler and releases the listening port, which ends open connections and cancels the operations they carry. Repeated calls reuse the same shutdown. The application owns process signals and calls `close()` when appropriate; the SDK does not install signal handlers.

**Known issue.** The official adapter limits a request body's size but not the time it takes to arrive, so a stalled body is bounded only by Node's own request timeout. This listener does not add a deadline of its own. The gap is tracked upstream in [modelcontextprotocol/typescript-sdk#3131](https://github.com/modelcontextprotocol/typescript-sdk/issues/3131); it matters little for a loopback listener used for local development.

This listener supplies no sign-in or authorization. Use it for local development and disposable tutorial data. Making it reachable through a tunnel makes its public operations reachable too. Existing applications that need their own routes, authentication or deployment policy should use the [existing-backend recipes](attach-to-existing-backend.md).
