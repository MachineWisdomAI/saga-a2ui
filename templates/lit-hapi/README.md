# SAGA starter: Lit view, Hapi server

Use the maintained [Hapi bridge](server/bridge.ts) in an existing application, or start
with the complete Lit/MCP application. The bridge owns request admission, bounded JSON
reading, deadlines, disconnects and transport cleanup in both cases.

## Existing Hapi app: register an endpoint

Copy [**`server/bridge.ts`**](server/bridge.ts) into your application. It composes Hapi,
the official Node/server MCP SDKs and the budget implementation from
`@saga-a2ui/mcp/server`. [package.json](package.json) records the qualified dependencies;
there is no separate Hapi adapter package.

Here `app` is your Hapi server, `account` is your required authentication strategy,
and `buildMcpServer` is your factory returning an SDK `McpServer`:

```ts
import { mcpPlugin, mcpRequestLifetime } from './server/bridge.js';

await app.register({
  plugin: mcpPlugin,
  options: {
    path: '/mcp',
    auth: 'account',
    allowedHosts: ['api.example.com'],
    allowedOrigins: ['https://app.example.com'],
    budgets: { operationMs: 3_000, requestMs: 10_000 },
    maxRequestBytes: 1024 * 1024,
    createServer: ({ authInfo, lifetime, request }) =>
      buildMcpServer({ authInfo, lifetime, request }),
  },
});
```

Your strategy supplies verified MCP `AuthInfo` in `request.auth.credentials.authInfo`.
Inside its Hapi `authenticate(request, h)` method, access the already-admitted lifetime:

```ts
const lifetime = mcpRequestLifetime(request);
```

Use `lifetime.run('authentication', ...)` for authentication waits; the starter's
[authentication strategy](server/listener.ts) and [verifier integration](server/authenticate.ts)
show refusal handling and immutable identity snapshots. The bridge starts this lifetime
before authentication and passes the same object to the factory. The accessor is for
registered MCP requests and throws for requests outside those endpoints. Authentication,
claim validation and authorization remain application-owned.

Registration supplies the complete body, deadline and socket handling by default; no
parsing hooks or request application-state fields are needed. POST requests must use
`Content-Type: application/json`; unsupported content types receive HTTP 415. Omit `budgets` and
`maxRequestBytes` to keep the defaults shown. `maxSubscriptions` optionally limits this
endpoint's concurrent subscriptions; omission keeps the SDK default. Each registration
owns a separate persistent handler and subscription capacity. Stopping Hapi cancels
admitted requests and closes its registered MCP handlers.

An intentionally public registration uses `auth: false` and receives no identity,
even with a bearer header. Ordinary Hapi routes keep their existing authentication,
payload parsing and timeouts.

## New application: use the complete starter

From a SAGA checkout:

```sh
npx tsx scripts/saga.ts init --a2ui-stack lit-mcp --server hapi ./my-app
cd my-app
npm install
npm run build      # dist/index.html and dist/server.mjs
npm start          # prints both URLs; PORT=0 picks a free port
```

`npm run typecheck` checks the view and server. `/status/mcp` is public;
`/account/mcp` refuses every credential until you implement [verifier.ts](server/verifier.ts).
The starter ships no accounts, sample data or test verifier.

```text
server/
├── bridge.ts          reusable request and transport lifecycle
├── listener.ts        view preparation, auth and endpoint registration
├── main.ts            starts/stops Hapi and handles termination signals
├── authenticate.ts    verifies and snapshots this request's credential
├── operations.ts      MCP tools, their view and backend calls
└── authorization.ts   decides what the verified account may see
src/
├── catalog.ts         components the A2UI view may use
└── view.ts            renders results and owns view cleanup
```

## Ownership and request flow

| [Bridge](server/bridge.ts) owns | [Application setup](server/listener.ts) owns |
| --- | --- |
| Bounded JSON reading and parsed-body forwarding | Endpoint paths, hosts/origins and limit values |
| Admission lifetime, deadlines and disconnect handling | Authentication strategy and authorization decisions |
| Response/socket cleanup and cancellation on shutdown | Immutable view preparation and MCP server factories |
| Persistent handler per endpoint and its shutdown | Starting/stopping Hapi and termination signals |

```text
Registered MCP route
  bridge: admit lifetime → Host/Origin guard
    application: authenticate using that lifetime
      bridge: bounded JSON read → persistent SDK handler
        application: factory({ authInfo, lifetime, request }) → operation
      bridge: complete response, or cancel and clean up
```

The listener prepares the built view and filename-derived URI once before listening.
Modern calls select JSON or SSE automatically, including SSE for progress; legacy POST
calls retain SSE. The bridge returns malformed-body and transport refusals as inspectable
Hapi responses. A stalled body receives 408 and its connection closes; an overdue response
that has already started is destroyed rather than given another status.

Customize [operations.ts](server/operations.ts), [authorization.ts](server/authorization.ts)
and [catalog.ts](src/catalog.ts) for your application. [identity.ts](server/identity.ts)
reads verified auth, never an account named by a tool argument.
[actions.ts](src/actions.ts) and [view.ts](src/view.ts) own local actions and bindings.
The view's `retire()` ends its discovery subscription and binding; the application remains
responsible for work its server actions started.
