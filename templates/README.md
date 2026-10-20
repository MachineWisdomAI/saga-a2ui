# Starter templates

Maintained, tested template sources for new SAGA applications and for attaching SAGA to an existing
backend. A template is not an npm package. `saga init` (CLI1) and the developer guides take their output and
their snippets from these directories; they do not keep copies.

| Template | Stack | Server | Status |
| --- | --- | --- | --- |
| [`lit-node`](lit-node/) | `lit-mcp` (Lit view, MCP delivery) | `node` (`@modelcontextprotocol/node` 2.1.1) | Qualified in CI: [`scripts/starter.test.ts`](../scripts/starter.test.ts) and [`apps/lit-host/e2e/starter.spec.ts`](../apps/lit-host/e2e/starter.spec.ts) |
| [`lit-express`](lit-express/) | `lit-mcp` (Lit view, MCP delivery) | `express` (`@modelcontextprotocol/express` 2.0.2, `express` 5.3.0) | Qualified in CI: [`scripts/starter-express.test.ts`](../scripts/starter-express.test.ts) and [`apps/lit-host/e2e/starter.spec.ts`](../apps/lit-host/e2e/starter.spec.ts) |

The synthetic demonstration of this pair is [`demo/lit-node`](../demo/lit-node/README.md): it imports this template's request-authentication files as they ship and keeps every identity and fixture in its own directory.

The `hono`, `fastify` and `hapi` server targets are separate required slices
([#63](https://github.com/MachineWisdomAI/saga-a2ui/issues/63) to
[#65](https://github.com/MachineWisdomAI/saga-a2ui/issues/65)). A pair is offered only while CI qualifies it:
[`scripts/qualified-starters.ts`](../scripts/qualified-starters.ts) lists the qualified templates, the
shared headless suite is [`scripts/starter-qualification.ts`](../scripts/starter-qualification.ts) and
a template directory that is not listed fails `scripts/starter-template.test.ts`. A template is a
complete copy a developer can own, so the files a server framework does not change (the view and
`server/` apart from `listener.ts`) are the same text in each; change one and change them together.

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
npx tsx scripts/build-starter.ts --template lit-express   # one of them
npx tsx scripts/starter-snippets.ts                   # list the attach-to-an-existing-backend snippets (--template lit-express for the Express pair)
npx tsx scripts/starter-snippets.ts --out DIR         # write them as files into a new directory
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

`scripts/saga.ts` offers the pairs listed in its `SUPPORTED_PAIRS`, not every directory here. When a pair is
qualified, its owner adds one row there; while it fails, the row is removed.
