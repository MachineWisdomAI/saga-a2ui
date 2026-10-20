# SAGA starter: Lit view, Hono server

A Lit view (A2UI rendered with your own catalog) served as an MCP App by a Hono MCP server. It
uses only the public `@saga-a2ui/*` exports and the official `@modelcontextprotocol/hono`
adapter. It contains no accounts, no sample data and no test verifier.

## Run it

```sh
npm install
npm run build      # the view (dist/index.html), then the server (dist/server.mjs)
npm start          # prints the two endpoint URLs; PORT=0 picks a free port
```

`npm run typecheck` checks the view and the server.

- `…/status/mcp` is public: `get_status` reads no credential and has no identity.
- `…/account/mcp` is protected: `get_account` runs only for a request whose bearer credential your
  verifier accepted, and shows that request's own account.

The protected endpoint refuses every credential until you replace `server/verifier.ts`. That is
deliberate: the starter ships no identity provider.

## The tested recipe

The versions in `package.json` are exact and are the ones this starter is tested with: Hono 4.13.13
and `@hono/node-server` 1.19.17 (the Node host for Hono), the official `@modelcontextprotocol/hono`
2.0.2 (peers: `hono` ^4.11.4 and `@modelcontextprotocol/server` ^2.3.0, which the pinned
`@modelcontextprotocol/server` 2.3.1 satisfies) and Node 22.12.0 or later. Change one and run the
starter's build and your own checks again.

## What is yours

| File | You decide |
| --- | --- |
| `server/verifier.ts` | Who a bearer credential belongs to (your identity provider). |
| `server/authorization.ts` | What a verified account may see. Asked again for every request. |
| `server/operations.ts` | Your operations and their backend calls. The handler's record is projected field by field. |
| `server/listener.ts` | HTTP hosting. Add your ingress host name to `ALLOWED_HOSTNAMES` when you deploy. |
| `src/catalog.ts` | Which components a layout may name. Nothing is registered globally. |
| `src/actions.ts`, `src/view.ts` | Your actions, and which rendered control each one is attached to. |

Identity travels one way: `server/listener.ts` verifies the request and hands the result to the
transport as its per-request `authInfo`, and `identityOf` (`server/identity.ts`) reads it in the
operation. Nothing is stored on the Hono context for a later request to read, no tool argument can
name an account, and a prior call authorizes nothing.

`server/listener.ts` uses the adapter's Host and Origin validators and reads the request body
itself. The adapter's `createMcpHonoApp` reads the body before your routes run, which would leave
that wait outside the request's time limit.

## Actions and cleanup

`src/actions.ts` builds an action once (`Action.local(...).run(...).build()`), and
`src/view.ts` attaches it to the rendered Clear control with `handle.bindAction`. The layout
(`src/surface.ts`) names no action. `startView` keeps the discovery subscription and the binding
it created and ends them in `retire()`, which a host teardown and the page going away both call.
Ending a binding stops the control reacting. It does not prove that work a server action started
has stopped; the application owns whatever such work holds.

## Time

Each operation may run 3 s and each request 10 s unless `startListener` is given `budgets`. A
verifier that does not answer is cut off by the operation limit and the request is answered 503.

The request's clock starts when it is admitted and also covers the waits `server/listener.ts`
owns. A body that stalls is answered 408 and its connection is closed, and nothing is built or
called for it. A response that is not delivered before the request limit is destroyed rather than
left holding its connection, and a response already started is never given a second status.
