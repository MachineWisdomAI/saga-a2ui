# SAGA starter: Lit view, Hapi server

A Lit MCP App with a public status operation and an authenticated account operation.
Already have a Hapi application? Reuse [the bridge](server/bridge.ts) with your existing
server and authentication. The complete starter also supplies standalone hosting and a Lit view.

## Reuse the bridge in your Hapi app

[**`server/bridge.ts`**](server/bridge.ts) is the reusable integration. Copy it into your
application and register `mcpPlugin` on your existing Hapi server. It imports only Hapi
and the official Node/server MCP SDKs; their qualified versions are in [package.json](package.json).
SAGA maintains this file as the repair source for the template. There is no separate Hapi adapter package.

In this example, `app` is your Hapi server, `account` is your required authentication
strategy, and `buildMcpServer` is your application factory returning an SDK `McpServer`:

```ts
import { mcpPlugin } from './server/bridge.js';

await app.register({
  plugin: mcpPlugin,
  options: {
    path: '/mcp',
    auth: 'account',
    allowedHosts: ['api.example.com'],
    allowedOrigins: ['https://app.example.com'],
    createServer: (context) => {
      if (context.authInfo === undefined) {
        throw new Error('The protected route did not establish MCP identity.');
      }
      return buildMcpServer(context);
    },
  },
});
```

Your strategy must establish MCP `AuthInfo` in `request.auth.credentials.authInfo`.
The factory receives `{ authInfo, request }`: verified auth and the current Hapi request.
The bridge also supplies that auth to MCP handlers. Your application owns credential
verification, claim validation and authorization; [authenticate.ts](server/authenticate.ts)
shows the starter's scope checks and immutable snapshot. An intentionally public
registration uses `auth: false` and receives no identity, even with a bearer header.

Each registration owns one persistent SDK handler and its subscription capacity;
the factory builds a fresh MCP server for each request. Modern calls select JSON or
SSE automatically, including SSE for progress; legacy POST calls retain SSE.
Stopping your Hapi server closes the registered handlers.

### What comes with direct reuse

| [Bridge](server/bridge.ts): reusable integration | [Listener](server/listener.ts): standalone hosting |
| --- | --- |
| Explicit route authentication configuration; Host/Origin guards before authentication | Hapi construction, two endpoint registrations and the starter's bearer strategy |
| Request-local identity handoff and persistent SDK handlers | Immutable credential snapshot through [authenticate.ts](server/authenticate.ts) |
| Inspectable Hapi error responses and SDK-owned streams | Bounded streaming body reads, deadlines, cancellation and connection cleanup |
| Handler shutdown when Hapi stops | Admission tracking and cancellation of active request lifetimes |

Direct registration uses Hapi's payload handling by default. Copying the bridge alone
does not install the listener's request budgets or credential snapshot. An existing app
must supply those policies; the current implementation keeps that machinery in
[listener.ts](server/listener.ts). If you configure a streaming payload, finish your
bounded JSON read before the handler and set `request.app.mcpBody = { value: parsedJson }`.
The bridge expects a parsed value there, not the unread stream.

## Run the standalone starter

```sh
npm install
npm run build      # dist/index.html and dist/server.mjs
npm start          # prints both URLs; PORT=0 picks a free port
```

`npm run typecheck` checks the view and server. The starter contains no accounts, sample
data or test verifier. `/status/mcp` is public; `/account/mcp` refuses every credential
until you implement [verifier.ts](server/verifier.ts).

```text
server/
├── bridge.ts          reusable Hapi ↔ MCP integration
├── listener.ts        standalone HTTP lifecycle and endpoint composition
├── main.ts            reads the built view, starts/stops the listener
├── authenticate.ts    verifies and snapshots this request's credential
├── operations.ts      MCP tools, their view and application calls
└── authorization.ts   decides what the verified account may see
src/
├── catalog.ts         components the A2UI view may use
└── view.ts            renders results and owns view cleanup
```

The entry points are [main.ts](server/main.ts), [listener.ts](server/listener.ts) and
[operations.ts](server/operations.ts). The listener prepares one immutable view and its
filename-derived URI before opening the port; requests reuse those bytes and URI.

### One request through the standalone starter

```text
Hapi admission                         listener.ts: start one request lifetime
  Host/Origin guard                    bridge.ts: refuse before auth/body work
    authenticate                       authenticate.ts: verify, copy and freeze identity
      bounded JSON body read           listener.ts: enforce size and deadline
        persistent endpoint handler    bridge.ts: preserve Request and parsed body
          fresh MCP server factory     listener.ts → operations.ts
            identityOf → authorization → operation result
```

[identity.ts](server/identity.ts) reads verified auth, never an account named by a tool
argument. Public requests bypass credential verification and have no account identity.

## Customize the application

| File | Your application decides |
| --- | --- |
| [verifier.ts](server/verifier.ts) | Who a bearer credential belongs to. |
| [authorization.ts](server/authorization.ts) | What that verified account may see, checked on every call. |
| [operations.ts](server/operations.ts) | Tools, backend calls and the public fields projected into results. |
| [listener.ts](server/listener.ts) | Ingress host/origin policy, authentication and request budgets. |
| [catalog.ts](src/catalog.ts) | Which components a layout may name. |
| [actions.ts](src/actions.ts), [view.ts](src/view.ts) | Local actions, control bindings and view teardown. |

The standalone defaults are 3 seconds per operation and 10 seconds per request,
configurable through `startListener({ budgets, ... })`. The clock starts at admission.
A stalled body receives 408 and its connection closes; a response overtaken after it
starts is destroyed rather than given a second status. Shutdown cancels admitted work,
closes both endpoint handlers and stops Hapi.

The view's `retire()` ends its discovery subscription and action binding. Ending a
binding stops the control reacting; the application remains responsible for work its
server actions started.
