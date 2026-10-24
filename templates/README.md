# Starter templates

Maintained, tested template sources for new saga a2ui applications and for attaching saga a2ui to an existing backend. A template is not an npm package. `saga init` and the developer guides take their output and their snippets from these directories; they do not keep copies.

The existing-backend recipes ([`docs/attach-to-existing-backend.md`](../docs/attach-to-existing-backend.md)) are generated from the qualified templates by `npm run guide:recipes`. Adding a template to `scripts/qualified-starters.ts` fails `scripts/guide.test.ts` until the recipes are regenerated.

## The templates

All five use the `lit-mcp` stack: a Lit view with MCP delivery. They differ in the server.

| Template | Server | Qualified in CI by |
| --- | --- | --- |
| [`lit-node`](lit-node/) | `node` (`@modelcontextprotocol/node` 2.1.1) | [`scripts/starter.test.ts`](../scripts/starter.test.ts) and [`apps/lit-host/e2e/starter.spec.ts`](../apps/lit-host/e2e/starter.spec.ts) |
| [`lit-express`](lit-express/) | `express` (`@modelcontextprotocol/express` 2.0.2, `express` 5.3.0) | [`scripts/starter-express.test.ts`](../scripts/starter-express.test.ts) and the same browser specification |
| [`lit-fastify`](lit-fastify/) | `fastify` (`@modelcontextprotocol/fastify` 2.0.1, `fastify` 5.12.7) | [`scripts/starter-fastify.test.ts`](../scripts/starter-fastify.test.ts) and the same browser specification |
| [`lit-hono`](lit-hono/) | `hono` (`@modelcontextprotocol/hono` 2.0.2 with `hono` 4.13.13 and `@hono/node-server` 1.19.17) | [`scripts/starter-hono.test.ts`](../scripts/starter-hono.test.ts) and the same browser specification |
| [`lit-hapi`](lit-hapi/README.md) | `hapi` (a [bridge](lit-hapi/server/bridge.ts) maintained by saga a2ui, over `@modelcontextprotocol/node` 2.1.1, Hapi 21.4.10) | [`scripts/starter-hapi.test.ts`](../scripts/starter-hapi.test.ts), [`scripts/starter-hapi-identity.test.ts`](../scripts/starter-hapi-identity.test.ts) and the same browser specification |

A pair is offered only while CI qualifies it. [`scripts/qualified-starters.ts`](../scripts/qualified-starters.ts) lists the qualified templates, [`scripts/starter-qualification.ts`](../scripts/starter-qualification.ts) holds the shared headless suite, and a template directory that is not listed fails `scripts/starter-template.test.ts`.

A template is a complete copy a developer can own. The files a server framework does not change (the view, and `server/` apart from the listener and its request authentication) are the same text in each template. Change one and change them together.

- **`lit-hono`** is `lit-node` with only the server adapter files replaced (`server/listener.ts`, `server/authenticate.ts`, `package.json` and its README). A test fails if any other file differs.
- **[`lit-hapi`](lit-hapi/README.md#existing-hapi-app-register-an-endpoint)** reuses the bridge over the official Node/server SDK, with Hapi route authentication and request-local immutable identity. [The bridge](lit-hapi/server/bridge.ts) owns Hapi and raw-response integration, admission lifetimes, bounded body reads, deadlines and transport cleanup. [The listener](lit-hapi/server/listener.ts) prepares the view, configures authentication and registers the endpoints. Authentication reads the admitted lifetime through `mcpRequestLifetime(request)`, and the factory receives that same `lifetime` explicitly. No external repository or adapter package is required. Its view, operations, domain identity and policy seams reuse `lit-node` unchanged.

The synthetic demonstration of the `lit-node` pair is [`demo/lit-node`](../demo/lit-node/README.md). It imports this template's request-authentication files as they ship and keeps every identity and fixture in its own directory.

## A template's files

- `template.json` declares the stack, the server adapter and its version, the SDK packages the template installs and the snippet names it declares. It is not part of the exported starter.
- Everything else is the starter. `package.json` declares each `@saga-a2ui/*` package as `*`; export pins them to one SDK build.
- `// #region saga-snippet:<name>` and `// #endregion saga-snippet:<name>` mark lines that an existing-backend recipe shows. The markers are not in the exported starter.

## Using them

Run these from the saga a2ui repository root.

```sh
npx tsx scripts/build-starter.ts                      # export, install packed candidate tarballs and build every qualified template into apps/lit-host/dist/starters/<template>
npx tsx scripts/build-starter.ts --template lit-hono  # build one of them
npx tsx scripts/starter-snippets.ts                   # list the attach-to-an-existing-backend snippets of lit-node
npx tsx scripts/starter-snippets.ts --template lit-fastify   # list another template's snippets (default lit-node)
npx tsx scripts/starter-snippets.ts --out DIR         # write the snippets as files into a new directory
```

`exportTemplate`, `exportTemplateInterruptibly`, `extractSnippets` and `writeSnippets` in [`scripts/starter-template.ts`](../scripts/starter-template.ts) are the functions the CLI and guides call.

- Export writes only into a directory that does not exist, installs nothing and runs nothing.
- It removes only the directory it created, which it recognizes by the directory's identity and not by its path, and leaves a path that was replaced meanwhile as it found it.
- `exportTemplateInterruptibly` is the same export for a caller that must react to SIGINT or SIGTERM. It yields to the event loop between files, which a synchronous copy cannot do.

To create a new project from a qualified pair:

```sh
npx tsx scripts/saga.ts init --a2ui-stack lit-mcp --server node ./my-app
```

`scripts/saga.ts` offers the pairs in its `SUPPORTED_PAIRS`, not every directory here. Today all five templates (`lit-node`, `lit-express`, `lit-fastify`, `lit-hono`, `lit-hapi`) are offered, each with `--a2ui-stack lit-mcp` and its own `--server`. When a pair is qualified, its owner adds one row there; while it fails, the row is removed.

`saga demo --a2ui-stack lit-mcp --server node ./my-demo` is different from a starter. It creates the standalone demonstration (`demo/lit-node`) of the pair that `DEMO_TEMPLATE` names. Its synthetic accounts and data stay in that output and never enter a template or the starter above.
