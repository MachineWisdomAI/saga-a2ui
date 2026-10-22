# Preparing a five-package release

The public release set is `@saga-a2ui/core`, `@saga-a2ui/components`,
`@saga-a2ui/mcp`, `@saga-a2ui/react` and `@saga-a2ui/react-mcp-stack`. The first
four already have public npm releases (`0.1.0-rc.1` and later prereleases);
`react-mcp-stack` has none. See [public installation](public-install.md) for the
verified registry recipe. Subsequent release candidates use the `next` tag; pin
exact versions in applications.

The reviewed source manifests and generated `release.json` determine the
prepared versions. Source versions can advance ahead of npm: `0.7.0-rc.1` on the
integration branch is a source version, not a registry release. This procedure
does not authorize publication, and nothing here has published a `0.7.0` package.
Lit, `lit-mcp-stack`, the CLI, the workspace and the example applications are
outside this publication set.

## Build the exact artifacts

From the reviewed commit, on Node >=22.12.0:

```sh
npm ci
npm run release:pack -- release-out
```

`release-out/release.json` identifies the source revision, dirty state, exact
package manifests, file inventories, SHA-256 digests and npm SHA-512 integrity.
The five tarballs are in `release-out/packages`. A dirty build is preparation
only: rebuild after committing and reviewing the final source. This command
does not publish, tag, deploy or change repository visibility.

Release packing retains the enrolled versions and exact sibling dependencies,
ships Apache-2.0 `LICENSE` with every package, and includes the Markdown notices
with components. Exports are TypeScript source and require a TypeScript-aware
bundler. No precompiled JavaScript runtime is claimed. The release set has no
dependency on `@saga-a2ui/lit` or `@saga-a2ui/lit-mcp-stack`.

The existing `candidate:pack` remains a separate, nonpublishable qualification
path: its copies always have `private: true`, commit-derived candidate versions
and an invalid registry, even after source version enrollment. Candidate and
local-CI rehearsal evidence is not evidence about release bytes (see
[candidate installation, updates and rollback](candidate-update-and-rollback.md)).

## Release sequence

Each step is a separate, reviewed change or an owner action. None has happened
for `0.7.0`.

1. Child changes land on the integration branch with every version held at its
   pin ([version policy](version-policy.md)).
2. One final integration pull request into `main` removes the pin; the updater
   advances the baseline and the reviewer confirms it equals the intended version.
3. Qualify the merged head: build `release:pack` from that commit and run the
   qualification below on those tarballs.
4. An explicit promotion change (`chore(release): promote version`) turns the
   prerelease into `0.7.0`. Promotion changes the version strings, so rebuild
   the artifacts from the promoted commit and requalify those exact bytes.
5. The owner approves the exact source, package names, versions, tarball
   integrity and tag.
6. Publish the approved bytes (see below), then verify through an anonymous
   registry install.

## Qualify the exact artifacts before publishing

Qualify the five tarballs that would be published, not a candidate or an earlier
build of different source. Evidence from another source revision or version
identity is context, not qualification of these bytes. Use React and React DOM
**19.3.1**, MCP Apps **2.0.3**, and Zod **4.6.7** for MCP schemas. Keep the
consumer-root override `@a2ui/markdown-it: 0.2.1`. SAGA owns A2UI **0.13.0** and its
Zod **3.25.76** context; do not add direct application A2UI dependencies or force
a single Zod version. Follow [React consumer dependencies](react-consumers.md)
for public imports and the pnpm root override.

Because the stack pins exact siblings that are not on the registry yet, name every
tarball as a direct dependency and as an override, as `npm run test:pnpm-react`
does. Then check two different footprints; neither stands in for the other:

- **Installed tree** (an install check). An application that depends on the
  stack and declares `react` and `react-dom` gets `core`, `components`, `mcp`,
  `react`, the MCP Apps bridge and `markdown-it` beneath the stack, resolved with
  strict peers and exactly one React runtime. Components and Markdown belong in
  this tree.
- **Emitted browser graph** (a bundle check). An own-catalog application's
  browser bundle excludes components and Markdown, and no browser entry imports
  the stack's Node-only `/server` entry; the server is composed separately. The
  stack's `exports.test.ts` inspects this; an install does not.

Run strict peer installation, dependency-tree checks and strict TypeScript
compilation without `skipLibCheck`, then the application's existing build and
tests. Reuse unchanged runtime and host evidence; requalify changed resources
with their application owner. Local tarballs are not anonymous public npm
installation evidence, and a local or CI rehearsal is not acceptance in a real host.

## Publication and verification

The owner approves the exact source, package names, versions, tarball integrity
and tag before publication. Verify publish rights for each package. A dry
run, `npm publish TARFILE --dry-run --access public --tag next --ignore-scripts`,
inspects publication metadata without uploading. Publish only the approved
tarball bytes through the authorized account and public npm access, the four
packages the stack pins before the stack itself.

After publication, install the exact versions anonymously from the public
registry in a clean consumer, compare registry integrity to the approved
artifacts, and run that consumer's strict install/build/typecheck/tests. Preserve
its lockfile. Only then document these versions as publicly available.

The version updater owns each package version, its workspace-lock entry and
the sibling dependency fields that mirror it. Future changes use the repository
version policy; changing a version does not authorize publishing it.
