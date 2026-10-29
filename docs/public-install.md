# Installing saga a2ui

The public release set contains seven packages:

| Package | Use |
| --- | --- |
| `@saga-a2ui/core` | Application actions and A2UI protocol processing. |
| `@saga-a2ui/mcp` | MCP server operations, view connections and request lifetimes. |
| `@saga-a2ui/components` | Optional FaithfulCard content, link and image policies. |
| `@saga-a2ui/lit` | Lit renderer integration and optional FaithfulCard rendering. |
| `@saga-a2ui/react` | React A2UI integration, action controls and optional FaithfulCard rendering. |
| `@saga-a2ui/lit-mcp-stack` | Lit rendering joined to MCP Apps delivery. |
| `@saga-a2ui/react-mcp-stack` | React rendering joined to MCP Apps delivery. |

Use Node **22.12.0 or newer** and a TypeScript-aware bundler. The packages export TypeScript source. An application normally installs one stack and its framework peers, and imports from that stack only.

## Choose an exact published version

Check the registry before selecting a version:

```sh
npm view @saga-a2ui/lit-mcp-stack dist-tags --json
npm view @saga-a2ui/react-mcp-stack dist-tags --json
```

All seven packages are available at `0.7.7-rc.1`, verified on 27 October 2026, and the recipes below pin that release. The [release receipt](https://github.com/MachineWisdomAI/saga-a2ui/releases/tag/v0.7.7-rc.1) records its installation and build qualification. `next` currently selects this version for every package; `latest` differs across the set, so use an exact version. For another release, confirm that version and its framework peers in npm before replacing the pins. Source manifests and candidate builds can be ahead of the registry.

## Install one stack plus framework peers

At your application's root, preserve existing overrides and add:

```json
{
  "overrides": {
    "@a2ui/markdown-it": "0.2.1"
  }
}
```

For Lit:

```sh
npm install --save-exact --strict-peer-deps @saga-a2ui/lit-mcp-stack@0.7.7-rc.1 lit@3.3.3
```

For React:

```sh
npm install --save-exact --strict-peer-deps @saga-a2ui/react-mcp-stack@0.7.7-rc.1 react@19.3.1 react-dom@19.3.1
```

Commit the application lockfile. Each stack declares its SAGA siblings as regular dependencies with exact pins, so the application does not declare those packages separately. Use the stack root for an application-owned catalog and `/faithful-card` for a card application; `/server` is composed separately and stays out of browser bundles. A stack's server entry requires the full application's framework peers.

For pnpm, put the equivalent Markdown override in the consumer workspace root. See [React consumer dependencies](react-consumers.md) for the separate A2UI Zod 3 and MCP Zod 4 contexts. Do not add direct upstream A2UI packages to a stack application.

## Lower-level integrations

Applications that intentionally compose lower-level SDK APIs may install the packages they import, using the same matched release. The original four-package `0.1.0-rc.1` release remains historical; it predates the stacks. See [package layout](../packages/README.md) for ownership and entry points.

## Run a demo or use a starter

[Getting started](getting-started.md) creates a Lit starter or the React starter on Hono, or attaches SAGA to an existing backend, and its two tracks build an application ([React](build-tic-tac-toe-with-react.md), [Lit](build-notes-with-lit.md), which also runs the synthetic demo). The React tutorial installs published npm packages in the reader’s own app directory. The source CLI and contributor workflows build matched candidate tarballs from a checkout to test unpublished changes. Candidates have versions such as `0.0.0-candidate.g<12 hex>` and are distinct from public npm releases; see [candidate installation, updates and rollback](candidate-update-and-rollback.md). The source CLI, root workspace and example applications are not npm packages.

Continue with [the Lit track](build-notes-with-lit.md#compose-a-view-with-a-stack) or the [React track](build-tic-tac-toe-with-react.md) to connect a view, then the [action guide](actions.md) to trace a complete interaction. [Host compatibility](host-compatibility.md) records the flows observed in ChatGPT, Claude and Alexa+. Installing a package does not deploy an application or establish acceptance in an assistant host.

## Maintainer publication

[Release preparation](release-packages.md) describes the seven-package set, exact tarball qualification and publication verification. Source metadata and passing CI prepare a release; successful publication followed by an anonymous exact-version install establishes registry availability. Keep current release receipts here instead of copying mutable registry status into agent instructions and development guides.

For repeat releases, npm [trusted publishing](https://docs.npmjs.com/trusted-publishers/) needs a matching package repository URL, a supported Node/npm combination and `id-token: write` confined to its publishing job. The existing validation workflow does not publish. Verify scope ownership and approved versions and tags before publishing with [public npm access](https://docs.npmjs.com/creating-and-publishing-an-organization-scoped-package/).
