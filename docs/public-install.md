# Installing SAGA A2UI

SAGA A2UI does not yet have a public npm release. The current repository contains
a runnable Lit example and unreleased SDK packages under `packages/` that cannot yet be
installed from a registry. Locally packed copies of them, including the optional
`@saga-a2ui/components` FaithfulCard, are built into an external example by
`npm run build:answer-consumer` (Lit) and, for the optional React card, `npm run build:react-card-consumer`
(see the [development reference](development-reference.md)); `npm run build:pack1-consumers` installs the packed packages into two separate
consumers (the application's own catalog alone, and the same catalog plus the card; see "PACK1" in the [development reference](development-reference.md)).
The two PACK1 consumers qualify notes and Archive; #154/#156 also qualifies the actual external authenticated browse/Play listener with matching installed resources, as recorded in the [development reference](development-reference.md). Those are development checks, not an installation recipe. CI also packs the five packages as an unreleased **candidate** artifact (PACK2); [candidate contents, update, rollback and the publication recipe](candidate-update-and-rollback.md) describe it. A candidate's prerelease version is not a release version. This guide will name the tested package versions when the first release exists. To run the demonstration, create a project from a qualified starter or attach SAGA to an existing backend from a candidate build, follow [Getting started](getting-started.md).

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
[development reference](development-reference.md) describes its MCP listener, authenticated browsing and
playback recipes, and the limits of its local host fixture. Running it locally
does not establish compatibility with a conversational host.

## First public npm release

The first distribution uses public npm packages under `@saga-a2ui`. The [four-package prerelease preparation](release-packages.md) records proposed versions and exact artifact commands; it does not establish registry availability. Only packages
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

The planned migration of the Ansari application into `iaser-ai/ansari` cannot merge until the
public SDK source and exact public npm versions described above exist; private CI
packages and locally packed candidates can support development but do not meet
that requirement. The [Ansari migration design](../blueprints/features/ansari_adoption.blueprint.md)
describes the full path. Source publication, package installation and
actual-host acceptance are recorded as separate outcomes.

Releasing the SDK to npm gives developers libraries to install. It does not
deploy an application; that is the application owner's work. A listing in
ChatGPT or Claude comes from the host's own review of the deployed application.
The draft [host publication design](../blueprints/features/host_publication.blueprint.md)
proposes optional shared tooling that prepares application plugin packages and
directory submission materials. That tooling is not implemented, and its
commands are not an alternative to the npm release procedure below.

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
