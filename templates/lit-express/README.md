# saga a2ui starter: Lit view, Express server

A Lit view (A2UI rendered with your own catalog) served as an MCP App by an Express MCP server. It
uses only the public `@saga-a2ui/*` exports, the official `@modelcontextprotocol/express` adapter
and the official `@modelcontextprotocol/node` transport. It contains no accounts, no sample data
and no test verifier.

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
| `server/listener.ts` | The Express application and its HTTP hosting. Replace `localhostHostValidation()` with `hostHeaderValidation([...])` naming your ingress host when you deploy. Configure trusted Origins separately if clients send a remote Origin. |
| `src/catalog.ts` | Which components a layout may name. Nothing is registered globally. |
| `src/actions.ts`, `src/view.ts` | Your actions, and which rendered control each one is attached to. |

Identity travels one way: the `identify` middleware in `server/listener.ts` verifies the request
and puts the result on `req.auth`, which the transport hands to the operation, and `identityOf`
(`server/identity.ts`) reads it there. No tool argument can name an account, no module-level
"current user" exists, and a prior call authorizes nothing. Express does not authenticate for you
and the starter adds no layer over it: your middleware decides who is asking, your authorization
function decides what that account may see.

## Why `createMcpExpressApp` and `requireBearerAuth` are not used

`createMcpExpressApp` installs `express.json()` ahead of every route. That parser waits for a body
with no deadline, so a client that stalls would hold the request open. `server/listener.ts` instead
reads each POST body itself, as a bounded stage of the request, after the Host and Origin checks
from the same adapter (`localhostHostValidation`, `localhostOriginValidation`). In the same way,
authentication is a stage of the request's lifetime (`server/authenticate.ts`), so a verifier that
never answers is cut off, and your application decides which scopes a credential must carry.

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

The request's clock starts in the first middleware, before authentication, and also covers the waits
`server/listener.ts` owns. A body that stalls is answered 408 and its connection is closed, and
nothing is built or called for it. A response that is not delivered before the request limit is
destroyed rather than left holding its connection, and a response already started is never given a
second status.

## Versions

The starter pins the tested recipe exactly: `express` 5.3.0, `@modelcontextprotocol/express` 2.0.2
(peers `express` `^4.18.0 || ^5.0.0` and `@modelcontextprotocol/server` `^2.3.0`),
`@modelcontextprotocol/node` 2.1.1 and `@modelcontextprotocol/server` 2.3.1, on Node 22.12 or newer.
Express 4 satisfies the adapter's peer range but is not the tested recipe.
