# Installing SAGA A2UI

SAGA A2UI does not yet have a public npm release. The current repository contains
a runnable Lit example; `packages/` contains no installable SDK implementation.
This guide will name the tested package versions when the first release exists.

## Run the current source example

Repository access is required while the source remains private. Use the Node
version in `.nvmrc`, then run:

```sh
git clone https://github.com/MachineWisdomAI/saga-a2ui.git
cd saga-a2ui
npm ci
npx playwright install --with-deps chromium
npm run verify
npm start
```

The example's development credentials and content are synthetic. The
[README](../README.md) describes its MCP listener, authenticated browsing and
playback recipes, and the limits of its local host fixture. Running it locally
does not establish compatibility with a conversational host.

## First public npm release

The first distribution uses public npm packages under `@saga-a2ui`. Only packages
with implemented, reviewed public exports and passing release checks will be
published. The workspace root and runnable application remain private npm
workspaces; their `private` setting is independent of GitHub repository visibility.

The release must provide:

- Public SDK source at an identified Git commit and exact npm package versions
  that can be downloaded without authentication.
- A tested combination of package, upstream dependency, catalog, protocol and
  built-resource versions, with the supported Node range and a rollback recipe.
- An example installed from those registry versions outside the source workspace,
  using public exports and a consumer lockfile. It must build and render without
  source aliases, copied SDK modules, private registry access or a local checkout.
- License and attribution files for the distributed code and bundled dependencies.
  Preserve actual upstream notices; a package metadata license label alone does
  not describe every file in an upstream distribution.

The release notes will supply the exact installation command after that command
has passed in a clean consumer. Do not infer a release version from a branch name
or install an unverified dist-tag.

Ansari's migration must merge against publicly available SDK source and public
npm versions. Private CI packages can support development, but cannot satisfy
that integration's public-installation gate. Source publication, package
installation and actual-host acceptance remain separately recorded outcomes.

## Publishing configuration

Maintainers must verify ownership and publish access for the npm scope before the
first release. A new scoped package must be published with public access. The
first publication and subsequent release jobs require the repository's release
authorization; this guide does not grant it.

For repeat releases, configure npm trusted publishing for each actual package and
the intended GitHub Actions workflow. The publishing job needs an npm-supported
Node/npm combination, `id-token: write`, and a package repository URL matching
this repository. Keep that permission confined to the release job. The existing
source-validation workflow does not yet publish packages.

See npm's [public scoped package instructions](https://docs.npmjs.com/creating-and-publishing-an-organization-scoped-package/)
and [trusted publishing requirements](https://docs.npmjs.com/trusted-publishers/).
The package-specific trust configuration requires an existing package; account
access and initial publication must therefore be resolved before assuming later
OIDC releases are ready. See [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/).
