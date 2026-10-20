# Release candidates: contents, update, rollback and publication

This guide is for a maintainer who prepares, updates to, or restores a **candidate**: a build of one revision of the five owned packages that CI packs, installs and qualifies as a set. A candidate is not a release. Nothing is published, tagged, deployed or made public by anything described here, and the packages stay private (see [public install](public-install.md) and [the version policy](version-policy.md)).

## What CI produces

`npm run verify` builds, type-checks and tests everything, including the five packages installed from packed tarballs into clean directories outside the repository. The CI job then runs `npm run candidate:pack -- --out candidate-out` and uploads that directory as a workflow artifact, and only that (the job has `contents: read`, no publish step and no registry credential):

| File | What it is |
| --- | --- |
| `packages/*.tgz` | The five tarballs: `core`, `lit`, `components`, `mcp`, `react` |
| `candidate.json` | The machine-readable record: versions, tarball digests, files, exports, exclusions, combinations, recipe, install results, the carried checks |
| `CANDIDATE.md` | The same record for a maintainer to read |
| `consumer-package-lock.json` | The lockfile of the clean-directory `npm install` of those tarballs: the resolved third-party tree |

The tarball digests, the built views and servers, and the consumer installs are tied together: `candidate:pack` fails unless every consumer build in `apps/lit-host/dist*` was installed from exactly these tarballs, at this revision.

## The matched set

**Prerelease version.** Every package carries `0.0.0-candidate.g<first 12 hex of the commit>`, with `.dirty` after it when tracked files differ from the commit (a CI run is never dirty). The repository packages stay unversioned; the identity is stamped into a staged copy, so it is not an owned version, needs no enrollment, and cannot be mistaken for a release. Every SDK-to-SDK dependency and peer in the tarballs is pinned to exactly that version (the repository declares `*`), so a package manager refuses to resolve a sibling from another build. This is checked three ways: the package tests, a real `npm install` of a set that mixes two builds (npm stops with E404 for the missing sibling), and `candidate:verify` below.

**Resources.** Each built view is identified by `ui://sha256/<digest>.html`, the SHA-256 of its exact bytes. `candidate.json` lists the notes view of the `own` and `card` combinations and the subscriptions and playback views of the browse and Play application. The episode view is served through the content policy, so its URI depends on the policy an application configures (`npm run candidate:identity` computes it for a given policy).

**Catalogs.** Protocol A2UI v0.9 on upstream `@a2ui/web_core` 0.13.0. The `own` combination lists the application's own catalog (`https://pack1.example/catalogs/notes/v1`: `Line`, `Column`, `Row`, `List`, `ActionButton`); `card` adds the optional `FaithfulCard` at content contract version 1. A version other than 1 is refused by the card without reading its Markdown (existing reader tests).

**Recipe.** Node: CI uses the version in `.nvmrc` (22.12.0, also the minimum in `package.json`); `candidate.json` records the version the run actually used, and local runs may use a newer one. npm: recorded per run. Upstream: `@a2ui/web_core`/`lit`/`react` 0.13.0; `@modelcontextprotocol/client`, `core`, `server` 2.3.1 and `ext-apps` 2.0.3; Zod 4.6.7 (3.25.76 only as core's `zod3` alias); React and React DOM 19.3.1 exactly, for `@saga-a2ui/react` only. Optional peers: `@saga-a2ui/components` for `lit` and `react`.

**Application overrides.** An application must carry `"overrides": { "@a2ui/markdown-it": "0.2.1" }` in its own `package.json`. Without it a fresh install resolves `@a2ui/markdown-it` 0.2.2, whose peer `@a2ui/web_core ^0.14.0` conflicts with the pinned 0.13.0, and npm stops with ERESOLVE. npm honors overrides of the root project only, so a package cannot carry this for its consumers. `candidate:pack` installs with the overrides taken from the workspace root, and `candidate.json` records them. Whether the packages should declare `@a2ui/markdown-it` themselves so that no override is needed is an open packaging decision for the owner; it would change the manifests, and this candidate does not.

**Predecessor.** This is the first candidate. No SAGA package has been published, so there is no earlier release and no upgrade from a release was tested. The update and rollback sequence below is rehearsed between two *candidate* builds only (`scripts/release-candidate.test.ts` packs two builds, installs one, updates to the other, and restores the first byte for byte). The preceding accepted evidence is PACK1 ([#21](https://github.com/MachineWisdomAI/saga-a2ui/issues/21), [#154](https://github.com/MachineWisdomAI/saga-a2ui/issues/154)); its consumers and checks are carried, not redone.

## Package contents and boundaries

Each tarball holds `package.json`, `LICENSE` (Apache-2.0, copied into the staged package) and the package `src/` that its `files` list names; `components` also carries `THIRD_PARTY_NOTICES.md`, because it brings `markdown-it` into a consumer's built view and the notices must travel with a view that bundles it. Test and test-support sources and the workspace `tsconfig` files are left out; `candidate.json` lists each exclusion with the rule that leaves it out. There are no bundled templates: the CLI templates in the application-setup design do not exist, and `examples/pack1-consumer` is a development check, not a template. There is no per-package README yet; adding one is a release task.

What each entry point may load is asserted from the installed copies by `scripts/pack1.test.ts` and not repeated here: server entry points bundle and run for Node with no renderer, DOM or Markdown parser; the view bundle carries the view connection and no server module, Node built-in or credential; neutral components run with no MCP package, renderer or DOM; an own-catalog consumer has no card, parser or components module.

## Starter files an application owns, and what changed

There is no generated starter. The files below, shown by `examples/pack1-consumer`, are the ones an application writes and owns; they bind to the packages as listed.

| Application-owned file | Binds to | Changed in this candidate |
| --- | --- | --- |
| `src/notes-view.ts` (view composition) | `@saga-a2ui/core`, `lit`, `mcp/view` | A successful result that fails the view's contract now shows `MISMATCH_TEXT` and renders none of it (before, the same generic sentence as an unavailable list). Copy the pattern; the wording is the application's |
| `src/notes-contract.ts`, `server/notes-server.ts` | `@saga-a2ui/mcp/server` | No |
| `src/notes-actions.ts`, `src/row-holds.ts` | `@saga-a2ui/core/actions` | No |
| `src/notes-catalog.ts`, `src/main-*.ts` | `@saga-a2ui/lit`, optional `components` | No |
| Vite configuration and `package.json` | The tarballs, the overrides above | An application installs candidate tarballs (exact versions), not `*`, and adds the override |

No file routes an action through a handler name. Layout messages name controls by ID and carry no action; an application binds an action to each rendered instance with `watchById`/`bindAction`.

## Update sequence

Update every SDK package of the combination together. Do not update one package alone.

1. Read the new `CANDIDATE.md`: version, tarballs, the resource digests and the carried checks. Confirm the recipe (Node, npm, overrides) matches your build.
2. Install all the tarballs you use, from the same candidate, in one command (`npm install ./candidate/packages/saga-a2ui-core-….tgz ./…lit….tgz …`): each pins its siblings to the exact candidate version, which npm can satisfy only from the tarballs named beside it. Keep the `@a2ui/markdown-it` override in place and commit the lockfile.
3. Check the installed set: `npm run candidate:verify -- --candidate candidate/candidate.json --modules PATH/node_modules`. Any mismatch is reported with the tarball to reinstall.
4. Rebuild the view from that install (not from a cached build). With `--page FILE --combination own|card` the same command compares the example's built page with the recorded resource.
5. Restart the server so it serves the rebuilt view; its tool result names the view by digest, so a host that kept the old view is pointed at the new one. Pair the server and resource: never run a server of one build with a view of another.
6. Run the carried checks against the new combination (below), then refresh the tested host and repeat its observation if the contract you rely on changed.

If steps 3 to 5 are skipped, a view that meets a result it does not understand shows nothing of it and says that the view and server are from different builds (the `MISMATCH_TEXT` pattern); the package manager refuses a mixed set at install.

## Rollback

Rollback restores a complete, previously tested combination: all the packages, the view built from them and the server that serves it. Never roll back one package.

1. Pick a candidate record (`candidate.json`) from CI whose carried checks you accept.
2. Run `candidate:verify -- --candidate OLD/candidate.json --modules …` first. Besides the set, it checks that the record lists every check this tree requires. A record that predates one (for example per-request authorization, or the late-result checks) is reported as `floor-missing`: restoring it would silently undo that fix. Choose a later candidate, or re-qualify the old one with the current checks.
3. Reinstall its tarballs, rebuild the view, restart the server, run the carried checks, refresh the host. Reinstalling an earlier candidate restores its package manifests byte for byte (tested). Rebuilding the view from the same sources and lockfile should restore its digest; `candidate:verify --page` confirms it against the old record.
4. Keep any authorization fix that landed in your application code or configuration; an SDK rollback does not touch it.

## Carried checks

Each claimed combination passes the same behavior, and a claim is only as old as its last run:

- `scripts/pack1.test.ts`: what the packages declare, ship and may load.
- `apps/lit-host/e2e/pack1-consumers.spec.ts`, once for `own` and once for `card`: the page and server the consumer's own build produced, over a real Streamable HTTP connection: action input, one definition bound to two rendered instances, session prerequisite, server-side authorization after a withdrawn permission, known-refusal versus unknown outcome, late result after an item change, disposal, and the mismatch case.
- `scripts/installed-listener.test.ts` and `apps/lit-host/e2e/installed-listener.spec.ts`: the installed browse and Play listener and player.

`candidate.json` lists these cases by file and exact title (`carriedEvidence.cases`) with the SHA-256 of each file, and a headless test fails if a listed title no longer exists, so a combination is never claimed on a renamed or removed check. An obsolete handler-name scheme cannot satisfy them: a resource whose actions are not bound to the pressed instance fails the two-row, item-change and disposal cases (README, PACK2 section, lists the mutations run).

## Supported secure publication recipe (not performed)

Preparing the candidate grants no authority to publish. Publishing needs the owner's separate authorization and a release change reviewed like any other:

1. Enroll owned versions through the version policy; the packages stay unversioned until then. Set real versions in a release PR, remove `private`, and add `publishConfig.access: public` for the scoped packages. Build the release from the merged, tagged commit, not from a candidate tarball: candidate tarballs name `candidate-artifact.invalid` as their registry and a prerelease identity, so an accidental `npm publish` of one reaches nothing. npm 12.0.2 accepted a private manifest in `publish --dry-run`, so `private` is not the safeguard on its own.
2. Verify ownership of the `@saga-a2ui` scope and publish rights before the first publication; the first publication of a new scoped package must be public.
3. For repeat releases use npm trusted publishing from the release workflow only, with `id-token: write` confined to that job, an npm and Node combination that npm supports, and a package `repository` URL that matches this repository. The existing CI workflow keeps `contents: read`.
4. After publishing, install the exact versions anonymously in a clean consumer, build it without source aliases or a checkout, and record that; only then does the Ansari adoption's requirement for public versions hold.

## Obligations and renderer paths the candidate implements

Recorded from the repository's own records; package metadata, type declarations compiling or Lit passing establishes none of the open rows.

| Obligation or path | In the candidate | Open or not established |
| --- | --- | --- |
| Action runtime (`@saga-a2ui/core/actions`): local and server actions, prerequisites, bounded hooks, activation-scoped resources, `subject` freshness, `limits` (30,000 ms work and 5,000 ms per hook or release; field override, then instance, then default; invalid values rejected; remaining time clamped, never reset) | Implemented and tested through core, Lit and React | Real-device latency: the numbers are product defaults, not measured |
| Request lifetime (`@saga-a2ui/mcp/server`): separate 3,000 ms operation and 10,000 ms total request budgets starting before authentication, finite-response delivery | Implemented and tested (CORE3, STATE2) | Ongoing-stream idle and backpressure policy is separate and stays with CORE3's record |
| Playback retirement and label loss: permanent retirement of playback until a new view | Implemented in the reference application (STATE1) | Hosts that reuse a view stay retired until reload |
| Lit renderer path | Implemented, packed-consumer and built-browser checked | Windows is not claimed |
| React renderer path | Only the action-attachment qualification and the optional FaithfulCard text and image-consent slices, installed from the same tarballs by `examples/react-card-consumer` | React parity (E15) is separate, required work; nothing here establishes it |
| Lynx | Nothing: the owner retired Lynx delivery on 2026-10-19; `apps/lynx-fixture` is historical evidence, not a recipe | No Lynx package, recipe or host gate is required |
| Host-to-server cancellation and rollback in an actual host | Not implemented or claimed | Open (STATE2/CORE2 receipts bound what was seen) |
| Event-turn environment tagging; the other open decisions in the [action binding](../blueprints/modules/action_binding.blueprint.md#open-decisions) and [lifetime](../blueprints/features/request_view_lifetimes.blueprint.md#open-decisions) designs | Not decided here | Open with their owners; this candidate decides none of them |

**Named-host observations that exist** (none is repeated or extended by this candidate): ChatGPT web and Claude web receipts recorded in the lifecycle sections of the [connector](../blueprints/features/reusable_mcp_connector.blueprint.md#status) and [lifetime](../blueprints/features/request_view_lifetimes.blueprint.md#status) designs (CORE2 Play flow, STATE1 retirement and recovery, STATE2 finite waits, CARD1/CARD2 card reading); and the [host compatibility observations](2026-10-19_host-compatibility-observations_v1.md), including the Alexa+ in-card call that timed out with a different probe. No named host was run against this candidate's tarballs or views, and the local host fixture is not an assistant host.
