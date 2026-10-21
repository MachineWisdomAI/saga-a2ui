# Release candidates: contents, update, rollback and publication

This guide is for a maintainer who prepares, updates to, or restores a **candidate**: a build of one revision of the five owned packages that CI packs, installs and qualifies as a set. A candidate is not a release. Nothing is published, tagged, deployed or made public by anything described here, and candidate artifacts stay private (see [public install](public-install.md) and [the version policy](version-policy.md)).

## What CI produces

`npm run verify` builds, type-checks and tests everything, including the five packages installed from packed tarballs into clean directories outside the repository. The CI job then runs `npm run candidate:pack -- --out candidate-out` and uploads that directory as a workflow artifact, and only that (the job has `contents: read`, no publish step and no registry credential):

| File | What it is |
| --- | --- |
| `packages/*.tgz` | The five tarballs: `core`, `lit`, `components`, `mcp`, `react` |
| `candidate.json` | The machine-readable record: versions, tarball digests, files, exports, exclusions, combinations, recipe, install results, the carried checks |
| `CANDIDATE.md` | The same record for a maintainer to read |
| `consumer-package-lock.json` | The lockfile of the clean-directory `npm install` of those tarballs: the resolved third-party tree |
| `rehearsal.json` (and a section of `CANDIDATE.md`) | Written by the next CI step, `npm run candidate:rehearse -- --candidate candidate-out/candidate.json`: the installed-application rehearsal of an install, an update and a rollback (below) |

The tarball digests, the built views and servers, and the consumer installs are tied together: `candidate:pack` fails unless every consumer build in `apps/lit-host/dist*` was installed from exactly these tarballs, at this revision.

## The matched set

**Prerelease version.** Every package carries `0.0.0-candidate.g<first 12 hex of the commit>`, with `.dirty` after it when tracked files differ from the commit (a CI run is never dirty). Four repository packages now have enrolled release versions; this separate candidate identity is stamped into a staged copy and does not change those owned versions. Every SDK-to-SDK dependency and peer in the tarballs is pinned to exactly that version (from either an exact enrolled sibling version or `*` for an unversioned package), so a package manager refuses to resolve a sibling from another build. This is checked three ways: the package tests, a real `npm install` of a set that mixes two builds (npm stops with E404 for the missing sibling), and `candidate:verify` below.

**Resources.** Each built view is identified by `ui://sha256/<digest>.html`, the SHA-256 of its exact bytes. `candidate.json` lists the notes view of the `own` and `card` combinations and the subscriptions and playback views of the browse and Play application. The episode view is served through the content policy, so its URI depends on the policy an application configures (`npm run candidate:identity` computes it for a given policy).

**Catalogs.** Protocol A2UI v0.9 on upstream `@a2ui/web_core` 0.13.0. The `own` combination lists the application's own catalog (`https://pack1.example/catalogs/notes/v1`: `Line`, `Column`, `Row`, `List`, `ActionButton`); `card` adds the optional `FaithfulCard` at content contract version 1. A version other than 1 is refused by the card without reading its Markdown (existing reader tests).

**Recipe.** Node: CI uses the version in `.nvmrc` (22.23.3, also the minimum in `package.json`); `candidate.json` records the version the run actually used, and local runs may use a newer one. npm: recorded per run. Upstream: `@a2ui/web_core`/`lit`/`react` 0.13.0; `@modelcontextprotocol/client`, `core`, `server` 2.3.1 and `ext-apps` 2.0.3; Zod 4.6.7 (3.25.76 only as core's `zod3` alias); React and React DOM 19.3.1 exactly, for `@saga-a2ui/react` only. Optional peers: `@saga-a2ui/components` for `lit` and `react`.

**Application overrides.** An application must carry `"overrides": { "@a2ui/markdown-it": "0.2.1" }` in its own `package.json`. Without it a fresh install resolves `@a2ui/markdown-it` 0.2.2, whose peer `@a2ui/web_core ^0.14.0` conflicts with the pinned 0.13.0, and npm stops with ERESOLVE. npm honors overrides of the root project only, so a package cannot carry this for its consumers. `candidate:pack` installs with the overrides taken from the workspace root, and `candidate.json` records them. For pnpm, place the equivalent override in the consumer workspace root `pnpm-workspace.yaml`. See [React consumer dependencies](react-consumers.md) for the supported imports and Zod ownership; merely declaring another direct Markdown dependency does not constrain every transitive resolution.

**Predecessor.** This is the first candidate. No SAGA package has been published, so there is no earlier release and no upgrade from a release was tested. The update and rollback sequence below is rehearsed between two *candidate* builds only: `scripts/release-candidate.test.ts` packs two builds, installs one, updates to the other and restores the first byte for byte, and `npm run candidate:rehearse` (see [the rehearsal](#update-and-rollback-rehearsal)) installs, updates and restores them as built applications. The preceding accepted evidence is PACK1 ([#21](https://github.com/MachineWisdomAI/saga-a2ui/issues/21), [#154](https://github.com/MachineWisdomAI/saga-a2ui/issues/154)); its consumers and checks are carried, not redone.

## Package contents and boundaries

Each tarball holds `package.json`, `LICENSE` (Apache-2.0, copied into the staged package) and the package `src/` that its `files` list names; `components` also carries `THIRD_PARTY_NOTICES.md`, because it brings `markdown-it` into a consumer's built view and the notices must travel with a view that bundles it. Test and test-support sources and the workspace `tsconfig` files are left out; `candidate.json` lists each exclusion with the rule that leaves it out. There are no bundled templates: the CLI templates in the application-setup design do not exist, and `examples/pack1-consumer` is a development check, not a template. The four release packages also carry a package README.

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
3. Check the installed set: `npm run candidate:verify -- --candidate candidate/candidate.json --modules PATH/node_modules --combination own` (or `card`). The named combination's recorded packages must all be installed at the candidate version: for `own` that is `core`, `lit` and `mcp` (the optional `components` package is not required), for `card` it adds `components`. A missing package, a mismatched one, or a `--modules` location that does not exist or holds no `@saga-a2ui` package is reported with the tarball to reinstall, and the command exits 1; a missing or unknown `--combination` is a usage error (exit 2).
4. Rebuild the view from that install (not from a cached build). With `--page FILE --combination own|card` the same command compares the example's built page with the recorded resource.
5. Restart the server so it serves the rebuilt view; its tool result names the view by digest, so a host that kept the old view is pointed at the new one. Pair the server and resource: never run a server of one build with a view of another.
6. Run the carried checks against the new combination (below), then refresh the tested host and repeat its observation if the contract you rely on changed.

If steps 3 to 5 are skipped, a view that meets a result it does not understand shows nothing of it and says that the view and server are from different builds (the `MISMATCH_TEXT` pattern); the package manager refuses a mixed set at install.

## Rollback

Rollback restores a complete, previously tested combination: all the packages, the view built from them and the server that serves it. Never roll back one package.

1. Pick a candidate record (`candidate.json`) from CI whose carried checks you accept.
2. Run `candidate:verify -- --candidate OLD/candidate.json --modules … --combination own|card` first. Besides the set, it checks that the record lists every check this tree requires. A record that predates one (for example per-request authorization, or the late-result checks) is reported as `floor-missing`: restoring it would silently undo that fix. Choose a later candidate, or re-qualify the old one with the current checks.
3. Reinstall its tarballs, rebuild the view, restart the server, run the carried checks, refresh the host. Reinstalling an earlier candidate restores its package manifests byte for byte (tested). Rebuilding the view from the same sources and lockfile restores its digest (the rehearsal shows it); `candidate:verify --page` confirms it against the old record. A built server bundle names its scratch build directory in its region comments, so its raw digest differs between two builds of one install; the rehearsal compares it with that name normalized.
4. Keep any authorization fix that landed in your application code or configuration; an SDK rollback does not touch it.

## Carried checks

Each claimed combination passes the same behavior, and a claim is only as old as its last run:

- `scripts/pack1.test.ts`: what the packages declare, ship and may load.
- `apps/lit-host/e2e/pack1-consumers.spec.ts`, once for `own` and once for `card`: the page and server the consumer's own build produced, over a real Streamable HTTP connection: action input, one definition bound to two rendered instances, session prerequisite, server-side authorization after a withdrawn permission, known-refusal versus unknown outcome, late result after an item change, disposal, and the mismatch case.
- `scripts/installed-listener.test.ts` and `apps/lit-host/e2e/installed-listener.spec.ts`: the installed browse and Play listener and player.

`candidate.json` lists these cases by file and exact title (`carriedEvidence.cases`) with the SHA-256 of each file, and a headless test fails if a listed title no longer exists, so a combination is never claimed on a renamed or removed check. An obsolete handler-name scheme cannot satisfy them: a resource whose actions are not bound to the pressed instance fails the two-row, item-change and disposal cases (the [development reference’s PACK2 section](development-reference.md#release-candidate-update-and-rollback-pack2) lists the mutations run).

Listing a case by title is a claim, not a run. What ran for this candidate is in the rehearsal below.

## Update and rollback rehearsal

`npm run candidate:rehearse -- --candidate DIR/candidate.json` (CI runs it after `candidate:pack`, so it needs `npm run build` and Playwright Chromium) installs candidate **A**, updates to **B** and restores **A**, as applications that are built and run at each step, for both `own` and `card`:

1. A is the candidate in `candidate.json`; the command packs this tree again and refuses to go on unless every tarball has the recorded digest. B is the same revision packed with `.update` after the version.
2. For each stage, the consumer is installed from that stage's tarballs alone, the installed set is checked against the candidate for the consumer's combination (the stage stops if it is not that candidate), and the digests of the tarballs the build actually installed must be the stage's.
3. The page and the server are rebuilt from that install. A real MCP client connects to the rebuilt server, reads the view its `list_notes` tool names and must receive exactly the rebuilt page, with the `ui://sha256/…` URI of its bytes.
4. The representative cases of `pack1-consumers.spec.ts` (the ten listed in `CARRIED_CASES` for that file: disclosure, per-request authorization, known versus unknown effect, one definition on two rendered rows, prerequisite, subject freshness, disposal, page teardown, no handler-name routing, view and server of different builds) run in a real browser against that stage's rebuilt page and server. Each must run exactly once per consumer and pass; a case that did not run is a failure. The other broad suites are not repeated.
5. After the rollback, the restored view must be the first install's view exactly, and its server bundle equal after the scratch directory name is normalized.

`rehearsal.json` and the section it appends to `CANDIDATE.md` record, per stage and consumer: the installed packages and their tarball digests, the rebuilt view's URI and digest, the server bundle digests, whether the server serves the rebuilt view, the cases that ran with their outcome, and for each consumer whether the update changed the view and whether the rollback restored it.

**What this does and does not show.** A and B are one source revision with different version strings, because there is no earlier candidate, so the rebuilt views are identical and the update changes nothing the application can observe. The rehearsal shows that the sequence works as a procedure, that each stage's application is built from, and only from, that stage's tarballs, and that the action input, instance attachment, outcome and disposal behavior holds in each rebuilt application over a real MCP connection. It does not show an upgrade between two different versions of the code, an upgrade from a published release (none exists), or behavior in an actual assistant host.

## Supported secure publication recipe (not performed)

Preparing the candidate grants no authority to publish. Publishing needs the owner's separate authorization and a release change reviewed like any other:

1. Follow [four-package release preparation](release-packages.md) for the enrolled versions and `release:pack` artifacts. Build the release from the reviewed source commit, not from a candidate tarball: candidate tarballs name `candidate-artifact.invalid` as their registry and a prerelease identity, so an accidental `npm publish` of one reaches nothing. npm 12.0.2 accepted a private manifest in `publish --dry-run`, so `private` is not the safeguard on its own.
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
