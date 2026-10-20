# SAGA starter: Lit view, Fastify server

A Lit view (A2UI rendered with your own catalog) served as an MCP App by a Fastify MCP server. It
uses only the public `@saga-a2ui/*` exports and the official `@modelcontextprotocol/fastify`
adapter, with the Streamable HTTP transport of `@modelcontextprotocol/node` that the adapter's own
documentation pairs it with. It contains no accounts, no sample data and no test verifier.

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

## What is yours

| File | You decide |
| --- | --- |
| `server/verifier.ts` | Who a bearer credential belongs to (your identity provider). |
| `server/authorization.ts` | What a verified account may see. Asked again for every request. |
| `server/operations.ts` | Your operations and their backend calls. The handler's record is projected field by field. |
| `server/listener.ts` | HTTP hosting on Fastify. Add your ingress host name to `ALLOWED_HOSTS` when you deploy. |
| `src/catalog.ts` | Which components a layout may name. Nothing is registered globally. |
| `src/actions.ts`, `src/view.ts` | Your actions, and which rendered control each one is attached to. |

Identity travels one way: `server/listener.ts` verifies the request in an `onRequest` hook of the
protected route and hands the result to the transport as the request's `auth`, and `identityOf`
(`server/identity.ts`) reads it in the operation. No tool argument can name an account, and a prior
call authorizes nothing. SAGA adds no authentication or authorization layer to Fastify: if your
application already has one, call it from `server/verifier.ts` or `server/authorization.ts`.

## The Fastify adapter

`createMcpFastifyApp` (from `@modelcontextprotocol/fastify`) creates the app and validates the Host
and Origin headers, which protects a loopback server from DNS rebinding; `ALLOWED_HOSTS` lists the
host names (no port) it accepts. The per-request transport is not given a second copy of that check.

Fastify normally reads and parses a request body itself, with no deadline. `server/listener.ts`
replaces its parsers with one that passes the unread stream on, then reads the body under the
request's lifetime (see Time) and answers the request itself (`reply.hijack()`). This covers
every route of this app, so a route of your own that needs Fastify's parsed body must register its
own parser in a plugin of its own, or the MCP routes must move to a plugin that holds these two
settings.

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
