# Installing saga a2ui

Five packages are published on public npm as release candidates. There is no
stable release, and the `latest` tag does not point at the newest candidate for
every package, so always install an exact version:

| Package | Use |
| --- | --- |
| `@saga-a2ui/react-mcp-stack` | The React renderer connected to MCP delivery. One install plus React; the application imports from it only. |
| `@saga-a2ui/core` | Application actions and A2UI protocol processing. |
| `@saga-a2ui/mcp` | MCP server operations, view connections and request lifetimes. |
| `@saga-a2ui/react` | React A2UI integration, action controls and optional FaithfulCard rendering. |
| `@saga-a2ui/components` | Optional FaithfulCard content, link and image policies. |

Use Node **22.12.0 or newer** and a TypeScript-aware bundler. These packages
export TypeScript source. Install the exact `@saga-a2ui` versions the chosen recipe names; do not mix versions from different recipes.

Choose one recipe:

- **React stack, `0.7.6-rc.1`.** The current candidate and the simplest install.
- **Four packages, `0.1.0-rc.1`.** The earlier set, for an application that must
  stay on it. The stack did not exist at that version.

Both need the same Markdown override, so add it first. In your application's root
`package.json`, preserving any existing overrides:

```json
{
  "overrides": {
    "@a2ui/markdown-it": "0.2.1"
  }
}
```

The override keeps A2UI `0.13.0` on its compatible dependency combination. For
pnpm, and for why A2UI's Zod 3 and MCP's Zod 4 must stay distinct, read the
[React integration guide](react-consumers.md). Commit the resulting lockfile.

## Install the React stack

```sh
npm install --save-exact --strict-peer-deps \
  @saga-a2ui/react-mcp-stack@0.7.6-rc.1 react@19.3.1 react-dom@19.3.1
```

The stack declares core, components, MCP and React as regular dependencies, so
one install is enough under a strict layout, and it keeps `react` and
`react-dom` as your declared singletons. Import from the stack only:
`@saga-a2ui/react-mcp-stack` for your own catalog and
`@saga-a2ui/react-mcp-stack/faithful-card` for a card application. The
[React integration guide](react-consumers.md#one-stack-plus-react) describes the
two footprints: the installed tree includes `components` and `markdown-it`,
while the emitted browser bundle of an own-catalog application excludes them and
keeps the server entry separate.

What has been checked for this recipe:

- On 2026-10-24 the registry listed all five packages at `0.7.6-rc.1` under the
  `next` tag, and an anonymous `npm install` of the command above, with the
  override and strict peers, resolved `core`, `components`, `mcp` and `react`
  at `0.7.6-rc.1`, MCP Apps `2.0.3`, Zod `4.6.7` and one copy of React and React
  DOM. That check covers installation only.
- `npm run test:pnpm-react` installs this recipe under strict pnpm 10 from packed
  tarballs and compiles a consumer that imports the stack and nothing else. That
  is a local source rehearsal, not an anonymous registry installation.
- No host acceptance is claimed. See the
  [compatibility observations](2026-10-19_host-compatibility-observations_v1.md)
  for what has been observed in named hosts.

## Install the four-package set

```sh
npm install --save-exact --strict-peer-deps \
  @saga-a2ui/core@0.1.0-rc.1 \
  @saga-a2ui/components@0.1.0-rc.1 \
  @saga-a2ui/mcp@0.1.0-rc.1 \
  @saga-a2ui/react@0.1.0-rc.1 \
  react@19.3.1 react-dom@19.3.1
```

A command that names `0.1.0-rc.1` installs that release, not the newest. The
registry holds other prereleases of these four, which this page does not
inventory.

Use `@saga-a2ui/react/a2ui` for A2UI surfaces and catalogs. Do not add direct
`@a2ui/react` or `@a2ui/web_core` dependencies for this integration. Applications
using the MCP APIs directly should declare the dependencies they import; the
qualified combination uses MCP Apps `2.0.3`, MCP server `2.3.1`, MCP Node
`2.1.1` and Zod `4.6.7`.

Public-registry installation, strict typechecking, application builds and a
standalone container have been verified for this four-package recipe. The
registry install resolved again on 2026-10-24.

## Run a demo or use a Lit starter

Follow [Getting started](getting-started.md) to run the synthetic podcast demo,
create a Lit starter, or attach saga a2ui to an existing backend. Those paths build
matched candidate tarballs from a source checkout, including `@saga-a2ui/lit`
and `@saga-a2ui/lit-mcp-stack`, which are **not published on npm**. The CLI is
also source tooling, not an npm package.

Candidate versions such as `0.0.0-candidate.g<12 hex>` are distinct from
published versions such as `0.7.6-rc.1`; a candidate is not an upgrade of one.
See [candidate installation, updates and rollback](candidate-update-and-rollback.md).
Source package versions may advance ahead of npm; use the published versions
above for a registry installation.

The [development reference](development-reference.md) covers local builds,
packed-consumer checks and the synthetic examples. The workspace root and
example applications are private npm workspaces; that setting does not control
GitHub source visibility.

## Maintainer publication

The [release-packages guide](release-packages.md) describes building and
qualifying the exact tarballs of the five-package set for a release. Source
version changes and passing CI do not publish them. Verify package contents,
licenses, integrity, scope ownership and the approved versions and tag before
publishing with public npm access. Verify the resulting exact versions through
an anonymous clean installation.

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
