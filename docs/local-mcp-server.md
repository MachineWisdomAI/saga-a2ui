# Run a local MCP server

`startLocalMcpServer` runs an application's MCP operations on a local Node server. It handles HTTP admission, the MCP transport, request deadlines and shutdown. Your application supplies the operations, rendered view and stored data.

The helper is introduced in `0.9.0-rc.1`. Check [public installation](public-install.md) for registry availability before choosing a version. Import it from your stack's `/server/node` entry; the Lit stack offers the same helper. A lower-level integration can import it from `@saga-a2ui/mcp/server/node`.

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { startLocalMcpServer } from '@saga-a2ui/react-mcp-stack/server/node';

const listener = await startLocalMcpServer({
  port: 3000,
  createServer(lifetime) {
    const server = new McpServer({ name: 'my-app', version: '1.0.0' });
    // Register your operations here, passing { lifetime } to each registration.
    return server;
  },
});

console.log(listener.url); // http://127.0.0.1:3000/mcp
// Call await listener.close() when the application stops.
```

The callback creates a fresh MCP server for each admitted request. Keep shared application state, such as a game store, outside that callback. Load the built view before starting the listener, then reuse it when registering operations. The callback's `lifetime` gives each operation the same deadline as the HTTP request that carries it.

The listener binds only to `127.0.0.1` and serves `/mcp`. It accepts `localhost` and `127.0.0.1` Host headers and the official MCP adapter's localhost Origin policy. Requests without an Origin header are allowed, as needed by server-to-server MCP clients. A development tunnel must forward an accepted Host header; for Cloudflare Quick Tunnel, use `--http-host-header localhost`.

Requests have a 1 MiB body limit. The default budgets are 3 seconds per operation and 10 seconds per request, including body reading and response delivery. Set `budgets` when your application's operations need different limits, using the same settings as `createServerBudgets`. Invalid budgets fail before the port opens. A stalled body receives HTTP 408; an oversized body receives 413; malformed JSON receives 400. If a response has already started when its deadline expires, the listener closes the connection instead of sending another status.

`close()` cancels active requests, closes the MCP handler and releases the listening port. Repeated calls reuse the same shutdown. The application owns process signals and calls `close()` when appropriate; the SDK does not install signal handlers.

This listener supplies no sign-in or authorization. Use it for local development and disposable tutorial data. Making it reachable through a tunnel makes its public operations reachable too. Existing applications that need their own routes, authentication or deployment policy should use the [existing-backend recipes](attach-to-existing-backend.md).
