# Starter templates

Maintained, tested template sources for new SAGA applications and for attaching SAGA to an existing
backend. A template is not an npm package. The later CLI and the developer guides take their output and
their snippets from these directories; they do not keep copies.

| Template | Stack | Server | Status |
| --- | --- | --- | --- |
| [`lit-node`](lit-node/) | `lit-mcp` (Lit view, MCP delivery) | `node` (`@modelcontextprotocol/node` 2.1.1) | Qualified in CI: [`scripts/starter.test.ts`](../scripts/starter.test.ts) and [`apps/lit-host/e2e/starter.spec.ts`](../apps/lit-host/e2e/starter.spec.ts) |
| [`lit-fastify`](lit-fastify/) | `lit-mcp` (Lit view, MCP delivery) | `fastify` (`@modelcontextprotocol/fastify` 2.0.1, `fastify` 5.12.7) | Qualified in CI: [`scripts/starter-fastify.test.ts`](../scripts/starter-fastify.test.ts) and [`apps/lit-host/e2e/starter-fastify.spec.ts`](../apps/lit-host/e2e/starter-fastify.spec.ts) |

The synthetic demonstration of this pair is [`demo/lit-node`](../demo/lit-node/README.md): it imports this template's request-authentication files as they ship and keeps every identity and fixture in its own directory.

The `express`, `hono` and `hapi` server targets are separate required slices
([#62](https://github.com/MachineWisdomAI/saga-a2ui/issues/62),
[#63](https://github.com/MachineWisdomAI/saga-a2ui/issues/63) and
[#65](https://github.com/MachineWisdomAI/saga-a2ui/issues/65)); `fastify` is
[#64](https://github.com/MachineWisdomAI/saga-a2ui/issues/64). A pair is offered only while CI qualifies it.

## A template's files

- `template.json`: the stack, the server adapter and its version, the SDK packages it installs and the
  snippet names it declares. It is not part of the exported starter.
- Everything else is the starter. `package.json` declares each `@saga-a2ui/*` package as `*`; export
  pins them to one SDK build.
- `// #region saga-snippet:<name>` … `// #endregion saga-snippet:<name>` marks lines an
  existing-backend recipe shows. The markers are not in the exported starter.

## Using them

```sh
npx tsx scripts/build-starter.ts                      # export, install packed candidate tarballs, build; apps/lit-host/dist/starter
npx tsx scripts/starter-snippets.ts                   # list the attach-to-an-existing-backend snippets
npx tsx scripts/starter-snippets.ts --out DIR         # write them as files into a new directory
npx tsx scripts/build-starter-fastify.ts              # the same export, install and build for lit-fastify; apps/lit-host/dist/starter-fastify
npx tsx scripts/starter-snippets.ts --template lit-fastify   # that template's snippets
```

`exportTemplate`, `extractSnippets` and `writeSnippets` in [`scripts/starter-template.ts`](../scripts/starter-template.ts)
are the functions the CLI and guides call. Export writes only into a directory that does not exist,
installs nothing and runs nothing.
