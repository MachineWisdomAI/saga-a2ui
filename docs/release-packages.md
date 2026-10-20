# Preparing the first four-package prerelease

The prepared version is `0.3.1-rc.1` for `@saga-a2ui/core`, `@saga-a2ui/components`,
`@saga-a2ui/mcp` and `@saga-a2ui/react`, with the proposed npm tag `next`. This
document does not announce registry availability or authorize publication.
Lit, the CLI, the workspace and the example application are outside this
publication set.

## Build the exact artifacts

From the reviewed commit, on Node >=22.12.0:

```sh
npm ci
npm run release:pack -- release-out
```

`release-out/release.json` identifies the source revision, dirty state, exact
package manifests, file inventories, SHA-256 digests and npm SHA-512 integrity.
The four tarballs are in `release-out/packages`. A dirty build is preparation
only: rebuild after committing and reviewing the final source. This command
does not publish, tag, deploy or change repository visibility.

Release packing retains the enrolled versions and exact sibling dependencies,
ships Apache-2.0 `LICENSE` with every package, and includes the Markdown notices
with components. Exports are TypeScript source and require a TypeScript-aware
bundler. No precompiled JavaScript runtime is claimed. The release set has no
dependency on `@saga-a2ui/lit`.

The existing `candidate:pack` remains a separate, nonpublishable qualification
path: its copies always have `private: true`, commit-derived candidate versions
and an invalid registry, even after source version enrollment.

## Install and qualify before publishing

Install all four local tarballs together in an external consumer. Use React and
React DOM **19.3.1**, MCP Apps **2.0.3**, and Zod **4.6.7** for MCP schemas. Keep the
consumer-root override `@a2ui/markdown-it: 0.2.1`. SAGA owns A2UI **0.13.0** and its
Zod **3.25.76** context; do not add direct application A2UI dependencies or force
a single Zod version. Follow [React consumer dependencies](react-consumers.md)
for public imports and the pnpm root override.

Run strict peer installation, dependency-tree checks and strict TypeScript
compilation without `skipLibCheck`, then the application's existing build and
tests. Reuse unchanged runtime and host evidence; requalify changed resources
with their application owner. Local tarballs are not anonymous public npm
installation evidence.

## Publication and verification

The owner approves the exact source, package names, versions, tarball integrity
and tag before publication. Verify scope ownership and publish rights. A dry
run, `npm publish TARFILE --dry-run --access public --tag next --ignore-scripts`,
inspects publication metadata without uploading. Publish only the approved
tarball bytes through the authorized account and public npm access.

After publication, install the four exact versions anonymously from the public
registry in a clean consumer, compare registry integrity to the approved
artifacts, and run that consumer's strict install/build/typecheck/tests. Preserve
its lockfile. Only then document these versions as publicly available.

The version updater owns each package version, its workspace-lock entry and
the sibling dependency fields that mirror it. Future changes use the repository
version policy; changing a version does not authorize publishing it.
