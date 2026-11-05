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

The current RC is `0.11.0-rc.1` for all seven packages, published on 30 October 2026 and verified against the registry the same day. The recipes below pin those versions. `next` selects these versions; `latest` was not changed by this release.

The registry's own record of each version is the receipt. Open `https://registry.npmjs.org/@saga-a2ui/<package>/0.11.0-rc.1` (or the package's page on npmjs.com) to see its `dist.integrity`; the values should equal these:

| Package | `dist.integrity` of `0.11.0-rc.1` |
| --- | --- |
| `@saga-a2ui/core` | `sha512-Uq3UjKlvU1TZAFfM+e/fIEP9BtaoQpjYEXrqOdVzKkUIrHiQ0YbioUIdaGXvpFSRS0Z4t3ENRex5kpcXptivBQ==` |
| `@saga-a2ui/components` | `sha512-2rseheJBxV9g9AA9jXOS7rQrhZtNFM/0q4kuH+ml8J7VAUUt9YNQ/broVf0c5reixP+PT+happXme1ihLH4J8w==` |
| `@saga-a2ui/mcp` | `sha512-JYZS4LoDX65mk/8Ym5MEOAuhvbYRMSIFOeAH4O/41QC1OqYdeRupHHYRY9SIUbrrovpG8RrsecCrNbq0Pizj+g==` |
| `@saga-a2ui/lit` | `sha512-qM2H+NT9VLsi86epaHvwQdNh/VeyKUrzVn2E3lkOF4u/B+Km/ySJf4/JPz+4EKv2nilbv0ZnH22JqgufHz/Ntw==` |
| `@saga-a2ui/react` | `sha512-cOrMbqRNdcxiBu71rkQYYS2QMQewqFWCOqzll+TM9ZO/VXHHwPsGfwYK8ADXwApEa692dL2epaKf1E+lazQK6g==` |
| `@saga-a2ui/lit-mcp-stack` | `sha512-KE6J1YRuh+AA2Wip2Wlu3/XIrEeAdvzrWxJQkjv3YJbDTW0P3rJM1r7L1yE9wDm7lm66tzm8ekerXx6PTNOCSg==` |
| `@saga-a2ui/react-mcp-stack` | `sha512-abrfDAynzpTCXqm+HcMiIEF69eFnnzFUgnrzIkw9Rad45MYPv86T6YRZQXX6dxzAW09hyYzz7dqm/sfmHK3t1Q==` |

Both recipes below were run from empty directories with `npm` 10 and installed these exact versions from the registry, with every package in the resulting lockfile resolved from `registry.npmjs.org`.

A stack pins its SDK siblings, so its patch version can differ from theirs. For another release, confirm the stack version and its framework peers in npm before replacing the pins. Source manifests and candidate builds can be ahead of the registry.

## Install one stack plus framework peers

At your application's root, preserve existing overrides and add the following. If the application already directly declares any of these three packages, use the same exact specifier in its dependency field too; npm rejects a direct dependency and override with different specifiers (EOVERRIDE).

```json
{
  "overrides": {
    "@a2ui/markdown-it": "0.2.1", "dompurify": "3.4.17", "@hono/node-server": "2.1.5"
  }
}
```

The DOMPurify and Hono overrides replace vulnerable transitive versions pinned or permitted by upstream dependencies. npm applies overrides only from the application root; the SDK cannot impose them through its own manifest. Regenerate the application's lockfile after changing them.

A2UI still requires Zod 3, which is covered by [the Zod resource-consumption advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). The available upstream fix is in Zod 4; forcing it into the A2UI v3 context breaks schema compatibility. These overrides do not resolve that advisory. Bound untrusted request sizes at the application's ingress while that dependency remains in use.

For Lit:

```sh
npm install --save-exact --strict-peer-deps @saga-a2ui/lit-mcp-stack@0.11.0-rc.1 lit@3.3.3
```

For React:

```sh
npm install --save-exact --strict-peer-deps @saga-a2ui/react-mcp-stack@0.11.0-rc.1 react@19.3.1 react-dom@19.3.1
```

Commit the application lockfile. Each stack declares its SAGA siblings as regular dependencies with exact pins, so the application does not declare those packages separately. Use the stack root for an application-owned catalog and `/faithful-card` for a card application; `/server` is composed separately and stays out of browser bundles. A stack's server entry requires the full application's framework peers.

For pnpm, put the equivalent Markdown override in the consumer workspace root. See [React consumer dependencies](react-consumers.md) for the separate A2UI Zod 3 and MCP Zod 4 contexts. Do not add direct upstream A2UI packages to a stack application.

## Lower-level integrations

Applications that intentionally compose lower-level SDK APIs may install the packages they import, using the versions recorded in the release receipt. The original four-package `0.1.0-rc.1` release remains historical; it predates the stacks. See [package layout](../packages/README.md) for ownership and entry points.

## Run a demo or use a starter

[Getting started](getting-started.md) creates a Lit starter or the React starter on Hono, or attaches SAGA to an existing backend, and its two tracks build an application ([React](build-tic-tac-toe-with-react.md), [Lit](build-notes-with-lit.md), which also runs the synthetic demo). The React tutorial installs published npm packages in the reader’s own app directory. The source CLI and contributor workflows build matched candidate tarballs from a checkout to test unpublished changes. Candidates have versions such as `0.0.0-candidate.g<12 hex>` and are distinct from public npm releases; see [candidate installation, updates and rollback](candidate-update-and-rollback.md). The source CLI, root workspace and example applications are not npm packages.

Continue with [the Lit track](build-notes-with-lit.md#compose-a-view-with-a-stack) or the [React track](build-tic-tac-toe-with-react.md) to connect a view, then the [action guide](actions.md) to trace a complete interaction. [Host compatibility](host-compatibility.md) records the flows observed in ChatGPT, Claude and Alexa+. Installing a package does not deploy an application or establish acceptance in an assistant host.

## Maintainer publication

[Release preparation](release-packages.md) describes the seven-package set, exact tarball qualification and publication verification. Source metadata and passing CI prepare a release; successful publication followed by an anonymous exact-version install establishes registry availability. Keep current release receipts here instead of copying mutable registry status into agent instructions and development guides.

For repeat releases, npm [trusted publishing](https://docs.npmjs.com/trusted-publishers/) needs a matching package repository URL, a supported Node/npm combination and `id-token: write` confined to its publishing job. The existing validation workflow does not publish. Verify scope ownership and approved versions and tags before publishing with [public npm access](https://docs.npmjs.com/creating-and-publishing-an-organization-scoped-package/).
