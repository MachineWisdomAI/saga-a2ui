# Starter templates

Maintained, tested template sources for new SAGA applications and for attaching SAGA to an existing
backend. A template is not an npm package. `saga init` (CLI1) and the developer guides take their output and
their snippets from these directories; they do not keep copies. The existing-backend recipes
([`docs/attach-to-existing-backend.md`](../docs/attach-to-existing-backend.md), GUIDE1) are
generated from the qualified templates by `npm run guide:recipes`; adding a template to
`scripts/qualified-starters.ts` fails `scripts/guide.test.ts` until they are regenerated.

| Template | Stack | Server | Status |
| --- | --- | --- | --- |
| [`lit-node`](lit-node/) | `lit-mcp` (Lit view, MCP delivery) | `node` (`@modelcontextprotocol/node` 2.1.1) | Qualified in CI: [`scripts/starter.test.ts`](../scripts/starter.test.ts) and [`apps/lit-host/e2e/starter.spec.ts`](../apps/lit-host/e2e/starter.spec.ts) |
| [`lit-express`](lit-express/) | `lit-mcp` (Lit view, MCP delivery) | `express` (`@modelcontextprotocol/express` 2.0.2, `express` 5.3.0) | Qualified in CI: [`scripts/starter-express.test.ts`](../scripts/starter-express.test.ts) and [`apps/lit-host/e2e/starter.spec.ts`](../apps/lit-host/e2e/starter.spec.ts) |
| [`lit-fastify`](lit-fastify/) | `lit-mcp` (Lit view, MCP delivery) | `fastify` (`@modelcontextprotocol/fastify` 2.0.1, `fastify` 5.12.7) | Qualified in CI: [`scripts/starter-fastify.test.ts`](../scripts/starter-fastify.test.ts) and [`apps/lit-host/e2e/starter.spec.ts`](../apps/lit-host/e2e/starter.spec.ts) |
| [`lit-hono`](lit-hono/) | `lit-mcp` (Lit view, MCP delivery) | `hono` (`@modelcontextprotocol/hono` 2.0.2 with `hono` 4.13.13 and `@hono/node-server` 1.19.17) | Qualified in CI: [`scripts/starter-hono.test.ts`](../scripts/starter-hono.test.ts) and [`apps/lit-host/e2e/starter.spec.ts`](../apps/lit-host/e2e/starter.spec.ts) |
| [`lit-hapi`](lit-hapi/README.md) | `lit-mcp` (Lit view, MCP delivery) | `hapi` (SAGA-maintained [bridge](lit-hapi/server/bridge.ts) over `@modelcontextprotocol/node` 2.1.1, Hapi 21.4.10) | Qualified in CI: [`scripts/starter-hapi.test.ts`](../scripts/starter-hapi.test.ts), [`scripts/starter-hapi-identity.test.ts`](../scripts/starter-hapi-identity.test.ts) and [`apps/lit-host/e2e/starter.spec.ts`](../apps/lit-host/e2e/starter.spec.ts) |
| [`react-hono`](react-hono/) | `react-mcp` (React view, MCP delivery) | `hono` (the same `@modelcontextprotocol/hono` 2.0.2, `hono` 4.13.13 and `@hono/node-server` 1.19.17 as `lit-hono`) | Qualified in CI: [`scripts/starter-react-hono.test.ts`](../scripts/starter-react-hono.test.ts), [`scripts/starter-hono.test.ts`](../scripts/starter-hono.test.ts) and [`apps/lit-host/e2e/starter.spec.ts`](../apps/lit-host/e2e/starter.spec.ts) |

The synthetic demonstration of the `lit-node` pair is [`demo/lit-node`](../demo/lit-node/README.md): it imports this template's request-authentication files as they ship and keeps every identity and fixture in its own directory.

`lit-hono` is `lit-node` with only the server adapter files replaced (`server/listener.ts`, `server/authenticate.ts`, `package.json` and its README); a test fails if any other file differs.

`react-hono` is the same application with a React view: its `server/` (and the server build files `tsconfig.server.json` and `vite.server.config.ts`) is the `lit-hono` text, byte for byte, and `scripts/starter-hono.test.ts` fails if either copy changes alone. Its `src/` is written in `.tsx` against `@saga-a2ui/react-mcp-stack` and keeps the same public status, protected account operation (the verifier refuses every credential) and local "Clear the note" action. Each template declares in `src/contract.ts` the `VIEW_MARKER` its built page must contain, which the shared `server/operations.ts` checks before listening (`<starter-app` for a Lit template, `<div id="root"` for a React template).

[`lit-hapi`](lit-hapi/README.md#existing-hapi-app-register-an-endpoint) is maintained here too: it reuses the bridge over the official Node/server SDK,
with Hapi route authentication and request-local immutable identity. [The bridge](lit-hapi/server/bridge.ts) owns
Hapi/raw-response integration, admission lifetimes, bounded body reads, deadlines and transport
cleanup; [the listener](lit-hapi/server/listener.ts) prepares the view, configures authentication
and registers the endpoints. Authentication reads the admitted lifetime through `mcpRequestLifetime(request)`;
the factory receives that same `lifetime` explicitly. No external repository or adapter package is
required. Its view, operations, domain identity and policy seams reuse `lit-node` unchanged.

A pair is offered only while CI qualifies it:
[`scripts/qualified-starters.ts`](../scripts/qualified-starters.ts) lists the qualified templates, the
shared headless suite is [`scripts/starter-qualification.ts`](../scripts/starter-qualification.ts) and
a template directory that is not listed fails `scripts/starter-template.test.ts`. A template is a
complete copy a developer can own, so the files a server framework does not change (the view and
`server/` apart from the listener and its request authentication) are the same text in each; change one and change them together.

## A template's files

- `template.json`: the stack, the server adapter and its version, the SDK packages it installs and the
  snippet names it declares. It is not part of the exported starter.
- Everything else is the starter. `package.json` declares each `@saga-a2ui/*` package as `*`; export
  pins them to one SDK build.
- `// #region saga-snippet:<name>` … `// #endregion saga-snippet:<name>` marks lines an
  existing-backend recipe shows. The markers are not in the exported starter.

## Using them

```sh
npx tsx scripts/build-starter.ts                      # export, install packed candidate tarballs, build every qualified template; apps/lit-host/dist/starters/<template>
npx tsx scripts/build-starter.ts --template lit-hono      # one of them
npx tsx scripts/starter-snippets.ts                   # list the attach-to-an-existing-backend snippets (--template lit-express, lit-hono or react-hono for the other pairs)
npx tsx scripts/starter-snippets.ts --out DIR         # write them as files into a new directory
npx tsx scripts/starter-snippets.ts --template lit-fastify   # the Fastify pair's snippets
npx tsx scripts/starter-snippets.ts --template lit-hono   # choose another template (default lit-node)
```

`exportTemplate`, `exportTemplateInterruptibly`, `extractSnippets` and `writeSnippets` in [`scripts/starter-template.ts`](../scripts/starter-template.ts)
are the functions the CLI and guides call. Export writes only into a directory that does not exist,
installs nothing and runs nothing. It removes only the directory it created, which it recognizes by the
directory's identity and not by its path, and leaves a path that was replaced meanwhile as it found it.
`exportTemplateInterruptibly` is the same export for a caller that must react to SIGINT or SIGTERM: it
yields to the event loop between files, which a synchronous copy cannot do.

```sh
npx tsx scripts/saga.ts init --a2ui-stack lit-mcp --server node ./my-app   # a new project from a qualified pair
```

`scripts/saga.ts` offers the pairs listed in its `SUPPORTED_PAIRS`, not every directory here: today all six
templates are offered. `lit-node`, `lit-express`, `lit-fastify`, `lit-hono` and `lit-hapi` each take `--a2ui-stack lit-mcp` and
their own `--server`; `react-hono` takes `--a2ui-stack react-mcp --server hono`. When a pair is qualified, its owner adds one row there; while it fails, the row is removed.

`saga demo --a2ui-stack lit-mcp --server node ./my-demo` is a different thing from a starter: it creates the
standalone demonstration (`demo/lit-node`, DEMO1) of the pair `DEMO_TEMPLATE` names. Its synthetic accounts and
data stay in that output and never enter a template or the starter above.
