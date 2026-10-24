# Preparing a five-package release

The public release set is `@saga-a2ui/core`, `@saga-a2ui/components`,
`@saga-a2ui/mcp`, `@saga-a2ui/react` and `@saga-a2ui/react-mcp-stack`. All
five have a public npm release candidate, `0.7.6-rc.1`, published under the
`next` tag; the first four also have `0.1.0-rc.1` and later prereleases. See
[public installation](public-install.md) for the registry recipes. Pin exact
versions in applications.

The reviewed source manifests and generated `release.json` determine the
prepared versions. Source manifests can run ahead of npm; read their versions
at the reviewed commit rather than inferring them from a registry tag. Changes
follow the [version policy](version-policy.md).
This procedure does not authorize publication, and changing a version or passing
CI publishes nothing. Lit, `lit-mcp-stack`, the CLI, the workspace and the
example applications are outside this publication set.

## Build the exact artifacts

From the reviewed commit, on Node 22.23.3 or newer (the repository minimum):

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

Each step is a separate, reviewed change or an owner action. Steps 1 to 3 are
preparation, steps 4 and 5 are owner actions that publish a release candidate,
and stable promotion (step 6) is held and never implied by an earlier step.

1. Changes land on `main` through the ordinary [version policy](version-policy.md),
   so every unit shares one major.minor and the current prerelease advances
   with product changes. Documentation-only changes leave the versions alone.
2. Qualify the exact head as a candidate: from that commit run `candidate:pack`,
   `candidate:verify`, `candidate:rehearse` and the packed-consumer suites,
   including `test:pnpm-react` (see [candidate installation, updates and
   rollback](candidate-update-and-rollback.md)). This is the behavioral
   qualification and is a local source rehearsal. Reuse unchanged evidence; a
   source change after this step requalifies what it affects.
3. Build `release:pack` from that commit and verify those exact bytes
   (identities, sibling pins, files, dependency graph, and the lower-level,
   stack-only and server-only installs below). Fresh package bytes alone do not
   require rerunning unchanged behavior or host evidence.
4. The owner approves the exact source, package names, versions, tarball
   integrity and tag, and the tag names the exact commit that was demonstrated.
5. Publish the approved bytes under the `next` tag (see below), then verify
   through an anonymous registry install. Downstream adoption and named-host
   acceptance are separate evidence.
6. Held until the owner decides: an explicit promotion change
   (`chore(release): promote version`) turns the prerelease into the stable
   version. Promotion changes only version metadata, so unchanged behavioral
   evidence carries over, but the `release:pack` bytes are rebuilt from the
   promoted commit and verified again, and the stable `latest` tag is a
   separate publication decision.

## Qualify the exact artifacts before publishing

Verify the five tarballs that would be published, not a candidate or an earlier
build of different source. Evidence from another source revision or version
identity is context, not qualification of these bytes. Use React and React DOM
**19.3.1**, MCP Apps **2.0.3**, and Zod **4.6.7** for MCP schemas. Keep the
consumer-root override `@a2ui/markdown-it: 0.2.1`. The A2UI **0.13.0** dependency and its
Zod **3.25.76** context belong to saga a2ui; do not add direct application A2UI dependencies or force
a single Zod version. Follow [React consumer dependencies](react-consumers.md)
for public imports and the pnpm root override.

The stack pins exact siblings. For a release that is not yet published the
registry cannot supply them, so a local install supplies them from the tarballs
through overrides. Keep three consumer shapes separate.
`npm run test:pnpm-react` (`scripts/check-react-pnpm.ts`) demonstrates these shapes
using candidate tarballs, including a separate Lit stack fixture. It does not
consume `release:pack` output: repeat the React and server checks with the five
release tarballs to qualify the bytes for publication. None of these consumers
stands in for another:

- **Lower-level consumer** (availability of the five packages). It names every
  saga a2ui tarball as a direct dependency and as an override, plus React, React DOM,
  MCP Apps and Zod.
- **Stack-only consumer** (the documented React recipe). Its direct
  dependencies are only the React stack and its framework peers
  (`react`, `react-dom`), and its typed fixture imports every stack entry
  and nothing else: no upstream renderer or schema package, no Zod, no other
  saga a2ui package. The unpublished siblings are supplied by overrides only. Direct
  declarations would mask a dependency or an export the stack failed to
  provide, so only this consumer shows that the recipe resolves. It also checks
  the exact sibling resolutions, the stack's full peer requirements and one
  copy of each framework runtime.
- **Server-only consumer.** Names `@saga-a2ui/mcp`, the MCP server package and
  Zod, and compiles `@saga-a2ui/mcp/server` with strict peers and no renderer
  package or peer anywhere in the tree (`lit` arrives only beneath upstream
  `@a2ui/web_core`, which core depends on). A renderer-named stack's `/server`
  entry is compiled separately, under the full application recipe above; it is
  a convenience for an application that already installs the stack and is not
  renderer-free.

Then check two different footprints; neither stands in for the other:

- **Installed tree** (an install check, on the stack-only consumer). An
  application that depends on the stack and declares `react` and `react-dom`
  gets `core`, `components`, `mcp`, `react`, the MCP Apps bridge and `markdown-it`
  beneath the stack, resolved with strict peers and exactly one React runtime.
  Components and Markdown belong in this tree.
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
