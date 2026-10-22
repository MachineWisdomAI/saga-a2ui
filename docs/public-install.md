# Installing saga a2ui

Four packages are available from public npm at **`0.1.0-rc.1`**, the version this
page's recipe pins and verifies. Later prereleases of these four also exist; this
page does not inventory them, and a command that names `0.1.0-rc.1` installs that
release, not the newest:

| Package | Use |
| --- | --- |
| `@saga-a2ui/core` | Application actions and A2UI protocol processing. |
| `@saga-a2ui/mcp` | MCP server operations, view connections and request lifetimes. |
| `@saga-a2ui/react` | React A2UI integration, action controls and optional FaithfulCard rendering. |
| `@saga-a2ui/components` | Optional FaithfulCard content, link and image policies. |

Use Node **22.12.0 or newer** and a TypeScript-aware bundler. These packages export
TypeScript source. Install the parts your application uses, keeping saga package
versions matched. The React and FaithfulCard recipe below installs all four.

## Install the React and MCP packages

Before installing, add the required override to your application's root
`package.json`, preserving any existing overrides:

```json
{
  "overrides": {
    "@a2ui/markdown-it": "0.2.1"
  }
}
```

Then install the published versions and the supported React peers:

```sh
npm install --save-exact --strict-peer-deps \
  @saga-a2ui/core@0.1.0-rc.1 \
  @saga-a2ui/components@0.1.0-rc.1 \
  @saga-a2ui/mcp@0.1.0-rc.1 \
  @saga-a2ui/react@0.1.0-rc.1 \
  react@19.3.1 react-dom@19.3.1
```

Commit the resulting application lockfile. The [React integration guide](react-consumers.md)
explains the public imports, the pnpm workspace-root override, and why A2UI's
Zod 3 and MCP's Zod 4 dependencies must remain distinct. Applications using the
MCP APIs directly should declare the dependencies they import; the qualified
combination uses MCP Apps `2.0.3`, MCP server `2.3.1`, MCP Node `2.1.1` and Zod
`4.6.7`.

Use `@saga-a2ui/react/a2ui` for A2UI surfaces and catalogs. Do not add direct
`@a2ui/react` or `@a2ui/web_core` dependencies for this integration. The required
Markdown override keeps A2UI `0.13.0` on its compatible dependency combination.

Public-registry installation, strict typechecking, application builds and a
standalone container have been verified for this four-package recipe. Host
behavior has its own [compatibility observations](2026-10-19_host-compatibility-observations_v1.md).

## The `0.7` release candidates: one stack plus framework peers

The source release candidates (`0.7.6-rc.1` when this page was last reconciled) add `@saga-a2ui/react-mcp-stack` to the four packages above; see [release preparation](release-packages.md). They replace the four-package recipe with one stack package. An application installs `@saga-a2ui/react-mcp-stack` and the React peers, and imports from the stack only (`@saga-a2ui/react-mcp-stack` for its own catalog, `@saga-a2ui/react-mcp-stack/faithful-card` for a card application). The stack declares core, components, MCP and React as regular dependencies, so one install is enough under a strict layout, and it keeps `react` and `react-dom` as your declared singletons. Keep the Markdown override from the recipe above.

```sh
npm install --save-exact --strict-peer-deps @saga-a2ui/react-mcp-stack@VERSION react@19.3.1 react-dom@19.3.1
```

Replace `VERSION` with the release candidate the owner has published under the `next` tag. **No such version is published yet**, so this command cannot succeed today: `@saga-a2ui/react-mcp-stack` has no registry release, no `0.7.x` version of any package exists on the registry, and a source version is not a registry release. Until publication, qualification is source and packed-tarball evidence. `npm run test:pnpm-react` installs exactly this recipe under strict pnpm 10: the stack and the two React peers are the only direct dependencies, and the stack's sibling packages come from the packed tarballs through overrides. It then compiles a consumer that imports the stack and nothing else. That is a local rehearsal, not an anonymous registry installation or acceptance in a real host.

The [React integration guide](react-consumers.md#one-stack-plus-react) describes what the application imports and the two footprints: the installed tree includes `components`, `markdown-it` and the single `react` and `react-dom` peers, while the emitted browser bundle of an own-catalog application excludes components and Markdown and keeps the server entry separate. The Lit stack, `@saga-a2ui/lit-mcp-stack`, stays private like `@saga-a2ui/lit`.

## Run a demo or use a Lit starter

Follow [Getting started](getting-started.md) to run the synthetic podcast demo,
create a Lit starter, or attach saga to an existing backend. Those paths build
matched candidate tarballs from a source checkout, including `@saga-a2ui/lit`,
which is **not published on npm**. The CLI is also source tooling, not an npm
package.

Candidate versions such as `0.0.0-candidate.g<12 hex>` are distinct from the
published releases such as `0.1.0-rc.1`; a candidate is not an upgrade of one. See [candidate installation, updates and rollback](candidate-update-and-rollback.md).
Source package versions may advance ahead of npm; use the published versions
above for a registry installation.

The [development reference](development-reference.md) covers local builds,
packed-consumer checks and the synthetic examples. The workspace root and
example applications are private npm workspaces; that setting does not control
GitHub source visibility.

## Maintainer publication

The [release-packages guide](release-packages.md) describes building and
qualifying the exact tarballs of the five-package set for a subsequent release. Source version changes and
passing CI do not publish them. Verify package contents, licenses, integrity,
scope ownership and the approved versions and tag before publishing with public
npm access. Verify the resulting exact versions through an anonymous clean
installation.

For repeat releases, configure npm trusted publishing for each package and its
GitHub Actions workflow. The publishing job needs an npm-supported Node/npm
combination, `id-token: write`, and a package repository URL matching this
repository. Keep that permission confined to the release job; the existing
source-validation workflow does not publish packages. See npm's
[public scoped package instructions](https://docs.npmjs.com/creating-and-publishing-an-organization-scoped-package/)
and [trusted publishing requirements](https://docs.npmjs.com/trusted-publishers/).

Installing libraries does not deploy an application or submit it to a host
directory. The repository's [publication tooling](../scripts/publish/README.md)
prepares application artifacts and records manual handoff; deployment and
submission remain the application owner's work.
