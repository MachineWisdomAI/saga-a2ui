---
feature_name: ansari_adoption
status: approved
module_blueprints: []
dependencies: [reusable_mcp_connector, reusable_lit_adapter]
date_added: 2026-10-15
---

# Migrate Ansari Faithful Cards to public SAGA packages

## Status

- Design: approved on 2026-10-16 at [`19fb26c84116b15a56fec31bfa358898fe96d791`](https://github.com/MachineWisdomAI/saga-a2ui/blob/19fb26c84116b15a56fec31bfa358898fe96d791/blueprints/features/ansari_adoption.blueprint.md).
- Implementation: a destination candidate is open in [iaser-ai/ansari PR #323](https://github.com/iaser-ai/ansari/pull/323). On 27 October 2026 its head is `e4ded0ec3e39afb33292e311c8fe3a0669c1bb41`, targeting `develop`, and it is unmerged. Its [manifest](https://github.com/timeleft--/ansari/blob/e4ded0ec3e39afb33292e311c8fe3a0669c1bb41/apps/ansari-faithful-answers/package.json) pins the public React MCP stack at `0.7.6-rc.1`; its public PR reports installation, build and local/browser validation. This is candidate evidence, not a landed destination migration or independent verification performed for this document.
- The approved 2026-10-17 sequencing amendment permits server preparation after [CORE1 #14](https://github.com/MachineWisdomAI/saga-a2ui/issues/14) and view preparation after CORE1 plus [VIEW1 #17](https://github.com/MachineWisdomAI/saga-a2ui/issues/17). It preserves the single migration and all final release, host and destination-maintainer gates.
- Acceptance: destination review/merge, exact-candidate host evidence and application publication remain separate. SAGA's seven packages are now public at [`0.7.7-rc.1`](https://github.com/MachineWisdomAI/saga-a2ui/releases/tag/v0.7.7-rc.1); that availability neither upgrades the candidate's `0.7.6-rc.1` pin nor approves its destination merge. The original Lit-based extraction plan below records the approved starting design; the newer candidate uses the stack/card composition and must be assessed on its own revision.

## Problem and current behavior

Ansari Faithful Answers presents the complete answer returned by Ansari with its attribution. The original migration source rendered it in a custom Lit card and owned both application concerns—source requests, answer preparation and branding—and generic delivery/rendering integration. The migration separates those responsibilities so a maintained application consumes public SAGA interfaces instead of carrying another copy of the SDK's work.

The current destination candidate at PR #323 uses `apps/ansari-faithful-answers`, a React FaithfulCard over one Hono application with Node/Docker and Worker entries. Its [source README](https://github.com/timeleft--/ansari/blob/e4ded0ec3e39afb33292e311c8fe3a0669c1bb41/apps/ansari-faithful-answers/README.md) describes that candidate. The approved original design and its extraction sequence remain below to preserve their scope; they are not a claim that the destination has merged or that its newer renderer has acquired every historical Lit acceptance result.

The destination is the [`apps/` directory on `iaser-ai/ansari`'s `develop` branch](https://github.com/iaser-ai/ansari/tree/develop/apps/). The application will be transplanted there in **one migration**, consuming the public SAGA libraries and inheriting the destination's [MIT license](https://github.com/iaser-ai/ansari/blob/d9ea8ac40d478c044cb5cc67eeb184b103f06cc9/LICENSE), which carries the 2026 IASER copyright notice. The current private repository will not be made public in place, and its history is not transplanted. At inspected destination revision `d9ea8ac40d478c044cb5cc67eeb184b103f06cc9`, `apps/` contains `api`, `auth` and `frontend`; that was the inspected starting tree. The current candidate chooses `apps/ansari-faithful-answers`; destination acceptance remains pending.

The proposed ownership model is IASER ownership and operation of the hosted service and each host's publisher account and listing. Machine Wisdom AI would contribute the migration under the destination's MIT license, with contributor attribution and no additional rights or restrictions reserved by Machine Wisdom AI. Existing license notices and third-party terms remain intact. IASER's agreement and its operational/account readiness still need confirmation; this describes the intended arrangement rather than an established handover.

The migration preserves the maintained answer contract and custom card while replacing generic delivery and rendering integration with SAGA. The original design introduced no authentication rollout, source-provider change, generic FaithfulCard replacement or unrelated presentation feature. The later candidate's FaithfulCard composition is identified separately in Status; that choice is not retroactively attributed to this original design approval. The server and view changes can be prepared and tested in parallel, but the destination receives one complete working application with one coherent installation and resource recipe.

## Proposed behavior

The following is the approved original Lit route. The current candidate’s React stack flow follows it below, with its source revision kept separate.

A host invokes `ask_ansari` with a question. The transplanted application's existing API client obtains the answer once. The application preserves the returned source text, constructs the current answer presentation and attribution, and supplies them to the installed SAGA MCP connector. SAGA validates and delivers the declared result with its linked immutable HTML resource.

The view receives the delivered answer through SAGA's MCP view interface. The application converts its maintained answer contract into presentation updates for the SAGA core/Lit adapter and its own catalog. The user sees the same question binding, answer order, Arabic/RTL behavior, attribution, typography and theme behavior. Initialization consumes the answer already delivered to that view; it must not invoke Ansari again merely to render it.

### The current candidate's answer flow

In PR #323, `ask_ansari` makes one source request and returns the full answer and attribution. The application supplies the meaning of that result through a single `FaithfulCardApp.result(...)` reader. The stack owns the MCP connection, readiness ordering, card presentation, content policy and consent; application code owns branding, embedded assets and the Hono service. Rendering the already delivered answer makes no second source request.

An error or rejected answer clears stale content and presents the application's failure wording. A later valid answer can recover. A new presentation resets consent even if the text is unchanged. On teardown the application releases its fonts and the stack retires card and delivery state. The candidate's request budget bounds its MCP reply; neither closing a view nor ending the wait proves that upstream work has stopped. These are the candidate's declared source behaviors, requiring the exact-revision checks linked by its PR.

### From parallel preparation to the destination merge

In the original preparation sequence, the server migration (ANSARI1) moves delivery onto the SAGA MCP connector. The view migration (ANSARI2) moves rendering onto the SAGA core and Lit adapter. Both are developed in parallel against pinned SAGA candidate builds and are preparation slices of one migration, not separate production migrations or releases. They join in ANSARI3, the single destination PR to `develop`, which carries the complete installation, compatibility and rollback checks. Destination CI and maintainer review decide the merge.

The SDK work that Ansari consumes must meet its full requirements. [CORE3](https://github.com/MachineWisdomAI/saga-a2ui/issues/16) establishes the connector's complete bounded failure and lifecycle contract through installed public exports. [VIEW2](https://github.com/MachineWisdomAI/saga-a2ui/issues/18) moves the full account, selection, cancellation and teardown fixtures onto the public adapter. [PACK1](https://github.com/MachineWisdomAI/saga-a2ui/issues/21) and [PACK2](https://github.com/MachineWisdomAI/saga-a2ui/issues/22) cover packing and release readiness, including own-catalog and optional FaithfulCard consumers, the protected synthetic workflow, external installation, matched resources and upgrade/rollback evidence. The original own-catalog route did not require the optional FaithfulCard components; the current candidate uses them. Either choice retains the SDK qualification obligations relevant to that installed recipe.

Public release is a prerequisite for the merge only. Server and view preparation, joining them in the ANSARI3 candidate, and testing against pinned candidates can all proceed before it. Private CI artifacts and locally packed candidates can support that work, but neither satisfies the merge prerequisite. Before the destination migration merges, the release and packaging checks must pass and a clean checkout with no private credentials must install the exact public npm versions used by that candidate. Public SDK source and registry releases now exist; verification of the candidate's actual installation remains distinct from that availability. The first public SAGA installation must use **npm packages**; release tarballs are not an alternative distribution path for this migration.

Running the candidate in the required hosts does not wait for the merge. Host runs (described under Verification outcomes) start as soon as a candidate and authorized access exist, and their results are recorded separately.

### Library release, hosting and directory listings

Releasing the SAGA libraries, hosting the application and listing it in a host directory are separate deliverables with separate gates.

| Deliverable | What it is | Relation to the destination merge |
| --- | --- | --- |
| SAGA library release | Public SAGA source and exact npm package versions | A hard prerequisite for the merge |
| Hosted application | The deployed MCP service that serves `ask_ansari` and its UI resource | Preparation proceeds with the migration; operational readiness is unconfirmed |
| Host listing | The ChatGPT plugin directory and Claude directory entries that make the application discoverable | Prepared alongside migration; external directory review is not a merge prerequisite |

The proposed release outcome includes packaging Ansari for installation through ChatGPT's plugin directory and Claude's directory. IASER is the proposed owner of the hosted service and the listings, pending agreement and account readiness. A working open-source application can merge while its listings await external review.

![Server and view preparation join in one destination candidate, gated by public SAGA installation. Host distribution preparation proceeds alongside migration; a qualified hosted release proceeds through separate directory review and publication.](../../diagrams/ansari-adoption.svg)

[Editable Mermaid](../../diagrams/ansari-adoption.mmd) · [Editable Excalidraw](../../diagrams/ansari-adoption.excalidraw) · [PNG](../../diagrams/ansari-adoption.png)

## Responsibilities and interfaces

SAGA owns reusable MCP delivery and renderer-independent A2UI processing. The original migration consumed its Lit adapter; the current candidate consumes its React MCP stack and card entry. The destination application owns its domain result, source API client, transport configuration, logging policy and branded presentation. SDK code must not import application configuration or know Ansari's catalog identifier, attribution copy, fonts or backend service.

| Concern | Responsibility after migration |
| --- | --- |
| Source request and answer preparation | Application API client, answer text, question binding, attribution and safe source failures. |
| HTTP and long-running delivery | Application listener and EventStore configuration; supported SAGA integration preserves JSON/SSE, progress and delayed completion. |
| Tool and resource delivery | SAGA public server/view exports supply generic metadata, linkage and lifecycle; application supplies its contracts and resource identities. |
| Presentation | The application owns answer meaning, branding, fonts, themes and source fidelity. In the original route it also owns its catalog and Markdown rendering over core/Lit; in the current candidate the stack supplies the reusable FaithfulCard renderer, policy and lifecycle. |
| Package and resource compatibility | Exact npm versions and the built resource form a tested combination; the application owns its answer-contract and resource rollout. |
| Destination distribution | The application follows the verified `iaser-ai/ansari` layout and license, with third-party notices and redistribution rights preserved. |
| Host distribution | IASER is the proposed service and listing owner, with Machine Wisdom AI credited as contributor. The confirmed publisher would own the endpoint, listing identity, legal/support information and release approval. SAGA source tooling prepares and checks host artifacts; the host owns directory review. |

At the inspected destination revision, the pnpm workspace driven by Turborepo had this recipe: Node is at least 22.18.0, pnpm is pinned to 10.33.0, and the root `pnpm-lock.yaml` is authoritative. That inspected shared toolchain catalog selected TypeScript `~6.0.3`. Public npm distribution of SAGA does not require using the npm CLI inside this repository. The transplant must join the destination's scripts, environment declarations, cache inputs and CI task coverage. The root lockfile owns workspace installation. PR #323 additionally supplies a standalone application lockfile and verification path; their consistency is part of that candidate's review, not evidence inherited from the original extraction plan. A new application's checks must actually run in CI; existing API/auth/frontend checks alone cannot establish that.

The server-side starting points are the current application's `apps/ansari/src/create-server.ts`, `http-server.ts`, `event-store.ts` and `ansari-client.ts`. The view-side starting points are `packages/sdui/src/view-bridge.ts`, `view/mcp-app.ts`, `answer-surface.ts` and `answer-renderer.ts`. These paths describe the source being transplanted, not a prescribed destination layout. Do not copy the old repository wholesale or import its private records and history as a convenience.

The original compatibility investigation compared two dependency sets. At that time, Ansari used MCP Apps 2.0.3, split MCP server/client 2.3.1 and Node integration 2.1.1 with Zod 4.2-compatible schemas, and its A2UI packages were 0.9.1. SAGA's prototype used MCP Apps 1.7.5, MCP SDK 1.32.1, Zod 3.25.76 and A2UI 0.13.0. Both A2UI integrations use `/v0_9`. The [connector compatibility decision](reusable_mcp_connector.blueprint.md#responsibilities-and-interfaces) selects ext-apps 2.0.3 and the split MCP target as the extraction direction. At that investigation the target was selected, not yet qualified: its complete peer and engine recipe still required migration work, and the connector Blueprint records that an unchanged copy of SAGA's merged source, installed with complete peers, produced 32 TypeScript diagnostics. Those diagnostics are historical, not a current failure of the published recipe. The present candidate pins the stack and React peers in its manifest; qualification must verify that installed set without assuming wire incompatibility from package-version differences or silently retaining conflicting framework instances.

The installed packages must expose real supported interfaces. Cross-checkout aliases, copied SDK source and a private fork inside the destination are not acceptable substitutes. If an installed SAGA export cannot preserve a required behavior, produce a minimal reproducer and repair its owning SDK interface before integrating the transplant.

## Failure and recovery

| Trigger | Required outcome |
| --- | --- |
| Ansari fails, times out or returns an unusable result | Preserve safe tool failure and fallback behavior without exposing source diagnostics, questions or credentials in ordinary logs. No duplicate upstream request is introduced by the view. |
| The result arrives before view initialization, is repeated, or is replaced | Handler ordering preserves the latest accepted answer and its question binding; initialization does not discard an early answer or display it twice. |
| A malformed, unsupported or oversized current answer contract arrives | Clear the prior presentation and show the established safe fallback. No partial valid-looking answer or stale attribution remains. |
| Work is cancelled, the view is disposed, or a retired result arrives | Release owned listeners/state and ignore retired output. A result from another request or instance cannot restore an old answer. |
| A host lacks the supported link callback or omits optional font metadata | Links remain readable and inert; use the established font fallback without fetching an undeclared origin. |
| Supplied content tries to change policy or action arguments | It remains content. The trusted Standard/Strict policy, image allowlist and application actions are unchanged. |
| Package, answer-contract or cached resource versions do not match | Use the documented compatible combination or safe unsupported fallback; do not claim an older resource implements the new adapter. |
| Public npm installation is unavailable or the dependency is private/local | The destination integration remains unmerged. Development may continue against a pinned candidate, but no public installation claim is made. |

Preserve Standard with an empty image allowlist as the application default, and preserve the existing supported Strict behavior; the [content safety levels Blueprint](https://github.com/MachineWisdomAI/saga-a2ui/blob/b10a8882fa5b15ad9a7243f592e5c3dc086d5340/blueprints/features/content_safety_levels.blueprint.md) describes both. Configuration and navigation callbacks remain instance-owned. Any difference between the current application's handling of invalid configuration and the SDK's declared contract needs an explicit compatibility decision; migration is not authority to silently loosen content rules.

## Host packaging and directory publication

The implemented [host publication tooling](host_publication.blueprint.md) supplies reusable preparation and validation through the source CLI's optional `scripts/publish/` modules. There is no published `@saga-a2ui/publish` package. Ansari supplies its own listing copy, assets, endpoint and tested release identities. Hosting remains application-owned; a plugin package points to the deployed MCP service and its UI resources rather than deploying that service. The packaging tool is development tooling outside the server and browser runtime.

For ChatGPT, prepare the plugin ZIP with its remote MCP connection, publisher metadata, assets and review material, then use OpenAI's [submission flow](https://developers.openai.com/plugins/deploy/submission). The answer card remains an MCP App UI. Additional [plugin extensions](https://developers.openai.com/plugins/build/extensions), such as a sidebar entry or conversation panel, require an explicit user experience and runtime capability design; packaging alone cannot add them. The initial proposal preserves the existing inline answer experience.

For Claude, submit the hosted server as an MCP connector. Add a GitHub-backed plugin bundle if Ansari also supplies useful skills or onboarding; that bundle references the same endpoint and does not replace connector submission. Follow the current [directory publication guidance](https://claude.com/docs/directory/publish). A local Desktop bundle or Claude Code installation does not establish distribution of the web card.

The ChatGPT plugin ZIP, the Claude connector submission and the optional Claude plugin bundle are distinct artifacts. Prepare them against the exact application, SDK versions, built UI resource and advertised tools used in the required host runs. Use screenshots and examples from successful runs of that candidate. Keep test-account credentials outside package contents and public records. Track preparation, submission, platform approval and live listing separately for each host. A failed scan or review directs a repair; it does not turn a working custom connection into a public directory listing. The platform documents linked here were checked on 2026-10-16; their rules can change before submission.

The source migration can complete while a listing awaits external review. If shared publishing tooling is not ready, the same reviewed host artifacts can be prepared through each platform's documented native flow. The proposal therefore adds a distribution outcome without making completion of the whole CLI or either marketplace queue a new dependency of the destination merge. Required host runs and the public SDK/npm prerequisite remain intact.

## Verification outcomes

Establish the comparison baseline before changing either integration. Reuse synthetic API responses, vetted public passages, the answer corpus and current layout tests. Retain only fixtures that can be redistributed in the destination; private questions, credentials and host-account material must not enter source, history or evidence.

| Condition | Observable result |
| --- | --- |
| The same synthetic question/answer runs through old and proposed server integrations | The actual MCP wire result preserves answer text, question binding, progress, safe failures and supported JSON/SSE delayed completion with one source request. |
| The existing answer corpus runs through installed core/Lit and the application catalog | Exact source text and content order, attribution, Arabic/RTL, long answers, fonts, themes, keyboard behavior and narrow layout remain correct. |
| Standard and Strict render hostile Markdown, links and images | Trusted policy holds, including actual navigation callbacks and network requests; content cannot override it. |
| Early/repeated/late results and teardown exercise the built resource | Hook ordering, fallback and request-isolated state survive the migration without duplicate listeners or stale restoration. |
| A clean destination checkout installs exact public npm versions through pnpm | Root lint, typecheck, test and build tasks include the new app; its affected browser/layout checks pass without a sibling checkout, private package access or undeclared files. |
| The complete package/resource/answer-contract combination is upgraded or restored | Current and supported preceding resources behave according to their own contracts; documented rollback restores a tested complete combination. |
| Public source and dependency contents are inspected | Destination license and third-party notices cover included material; no private records or credentials are introduced. |
| Host distribution artifacts are prepared from a tested candidate | Supported validators accept the package structure; endpoint, tool and resource identities match the host evidence. Required listing material is present or reported as missing; credentials and unrelated files are excluded. |
| An authorized directory release becomes available | Retain the actual listing URL and version, then install through that listing in each claimed web host and reproduce the faithful answer. A custom connection, uploaded ZIP or pending review does not satisfy this outcome. |

The SDK obligations of CORE3, VIEW2, PACK1 and PACK2 (see the path above) remain intact, including both own-catalog and optional FaithfulCard packed consumers and the protected synthetic workflow. Ansari's different domain does not remove them. The destination transplant uses the resulting supported public packages, and its complete installation is verified independently of the SDK workspace.

Run the migrated application in ChatGPT web, Claude web and the existing supported Alexa+ path as soon as its candidate and authorized access are available. Each required host run records invocation, rendered answer, source fidelity, resource identity and observed limitations. Keep its outcome separate from local/browser tests and from the final maintainer acceptance decision. Host runs are not postponed merely because that acceptance is pending; a failed or inaccessible required path stays open and directs a concrete repair or access step.

## Implementation sequence

First complete the shared SDK dependency decision and establish the Ansari comparison fixtures. Refresh the destination source and follow its [contributor workflow](https://github.com/iaser-ai/ansari/blob/d9ea8ac40d478c044cb5cc67eeb184b103f06cc9/CONTRIBUTING.md) and [agent guidance](https://github.com/iaser-ai/ansari/blob/d9ea8ac40d478c044cb5cc67eeb184b103f06cc9/AGENTS.md), including the destination feature specification, plan and review. Confirm which fixtures and assets can be transplanted under the MIT license while retaining third-party notices; resolve any asset whose redistribution rights are not established.

ANSARI1 and ANSARI2 can then be prepared in parallel against pinned SAGA candidates. Server work preserves the old view for its comparison; renderer work uses the existing delivery seam for its comparison. Shared manifests, resource/version identities and final composition have one integration owner.

In parallel, confirm the proposed IASER ownership arrangement and authorized accounts, prepare listing assets with Machine Wisdom AI contributor attribution, and maintain the host package sources with the destination application. Finalize submission inputs against a qualified deployed candidate. The existing migration tickets do not already cover this distribution outcome or the shared CLI work, so the normal Blueprint breakdown review must reconcile them. Submit and release through the authorized owner when the platform prerequisites are met, recording each host's result independently.

The public-release prerequisite described under "From parallel preparation to the destination merge" applies to the ANSARI3 merge even if implementation and review completed earlier. Branch from and target `develop`. The destination's required CI and maintainer review remain authoritative; a contributor's own workflow approvals do not replace them. Its contributor guide supports fork PRs and requires a maintainer-approved workflow run for a first-time fork contribution. Publication of SAGA does not grant destination merge permission.

React parity, demo, CLI and tour work in the SDK keep their requirements but do not impose a React-before-Ansari implementation sequence. The full SDK quality checks and host work remain. Normal Blueprint design approval and breakdown approval precede execution; pending final maintainer signoff can remain open while compatible downstream work advances. Design approval grants no publication or destination merge authority.

## Open decisions

1. **Does the destination candidate fit the receiving workspace?** PR #323 chooses `apps/ansari-faithful-answers`. Its workspace scripts, both lockfile entry points and CI coverage require destination review on the exact candidate; the original directory question is no longer unanswered.
2. **Which released recipe does this candidate actually use?** PR #323 pins `@saga-a2ui/react-mcp-stack@0.7.6-rc.1` and React/React DOM `19.3.1`. Verify that precise installed combination. The newer seven-package `0.7.7-rc.1` release does not authorize an automatic upgrade or substitute for its evidence.
3. **Which source assets and fixtures are redistributable under MIT and their retained third-party terms?** The destination license is established; included fonts, branding, corpus provenance and any source-specific notices still need inspection. The source repository's current access does not establish those rights.
4. **Which prior resource combinations remain supported after the transplant?** Exercise the current maintained rollback contract and define destination resource identities without pretending a previous resource contains SAGA. Keep application compatibility separate from a first-version SDK release.
5. **Is the proposed IASER ownership arrangement ready for submission?** Confirm IASER's agreement, publisher accounts, stable endpoint/domain, support and privacy URLs, review access and update ownership. Agree where Machine Wisdom AI's contributor attribution appears. Destination repository maintainers must participate where the host requires repository push access; SDK npm ownership does not determine the application publisher.
6. **Does the first Claude release need a plugin bundle as well as its connector?** Define any useful skill or onboarding behavior before adding it. Sidebar, panel and other host-specific UI extensions remain separate proposals until their user experience and host support are established.

## References

- [Destination application directory](https://github.com/iaser-ai/ansari/tree/develop/apps/), [workspace definition](https://github.com/iaser-ai/ansari/blob/d9ea8ac40d478c044cb5cc67eeb184b103f06cc9/pnpm-workspace.yaml), and [root package recipe](https://github.com/iaser-ai/ansari/blob/d9ea8ac40d478c044cb5cc67eeb184b103f06cc9/package.json).
- [Reusable MCP connector](reusable_mcp_connector.blueprint.md), [reusable Lit adapter](https://github.com/MachineWisdomAI/saga-a2ui/blob/b10a8882fa5b15ad9a7243f592e5c3dc086d5340/blueprints/features/reusable_lit_adapter.blueprint.md), [content safety levels](https://github.com/MachineWisdomAI/saga-a2ui/blob/b10a8882fa5b15ad9a7243f592e5c3dc086d5340/blueprints/features/content_safety_levels.blueprint.md), [package ownership](../../packages/README.md), and [coding standards](../../CODING_STANDARDS.md).
- [CORE3](https://github.com/MachineWisdomAI/saga-a2ui/issues/16), [VIEW2](https://github.com/MachineWisdomAI/saga-a2ui/issues/18), [PACK1](https://github.com/MachineWisdomAI/saga-a2ui/issues/21) and [PACK2](https://github.com/MachineWisdomAI/saga-a2ui/issues/22).
