# SAGA starter: Lit view, Node server

A Lit view (A2UI rendered with your own catalog) served as an MCP App by a Node MCP server. It
uses only the public `@saga-a2ui/*` exports and the official `@modelcontextprotocol/node`
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

## What is yours

| File | You decide |
| --- | --- |
| `server/verifier.ts` | Who a bearer credential belongs to (your identity provider). |
| `server/authorization.ts` | What a verified account may see. Asked again for every request. |
| `server/operations.ts` | Your operations and their backend calls. The handler's record is projected field by field. |
| `server/listener.ts` | HTTP hosting. Add your ingress host name to `allowedHosts` when you deploy. |
| `src/catalog.ts` | Which components a layout may name. Nothing is registered globally. |
| `src/actions.ts`, `src/view.ts` | Your actions, and which rendered control each one is attached to. |

Identity travels one way: `server/listener.ts` verifies the request and hands the result to the
transport, and `identityOf` (`server/identity.ts`) reads it in the operation. No tool argument can
name an account, and a prior call authorizes nothing.

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
