---
feature_name: host_publication
status: approved
module_blueprints: []
dependencies: []
date_added: 2026-10-16
---

# Prepare an application for host publication

## Status

- Design: approved on 2026-10-16 at [`19fb26c84116b15a56fec31bfa358898fe96d791`](https://github.com/MachineWisdomAI/saga-a2ui/blob/19fb26c84116b15a56fec31bfa358898fe96d791/blueprints/features/host_publication.blueprint.md).
- Implementation: ChatGPT preparation (CLI3) and Claude connector materials (CLI4) are implemented and independently verified. The resumable submission handoff (CLI5, [#68](https://github.com/MachineWisdomAI/saga-a2ui/issues/68)) is implemented as `saga publish handoff` and independently verified through fixtures, as recorded below.
- Acceptance: application-owner agreement, authorized submissions and each host’s directory approval remain separate; design approval authorizes none of those actions. [The exact implementation and review records](#implementation-and-acceptance-records) preserve CLI3–CLI5's source and fixture evidence.

## Problem and current behavior

A working SAGA application still needs host-specific packaging, listing materials and submission evidence before people can discover it in ChatGPT or Claude. Publishing an npm library does not publish an application to either directory. Hosting is the application owner's deployed HTTPS MCP service, and the preparation commands do not deploy it. A directory listing is the host's own review and publication of the application, which only the host can grant.

The existing single SAGA CLI provides init and demo commands. CLI3 now adds `saga publish check` and `saga publish prepare` through optional workspace publication tooling. It prepares ChatGPT artifacts or a Claude connector dossier with the shared evidence record; it does not deploy an application, submit it or establish a live directory listing. No separately published `@saga-a2ui/publish` package is claimed.

## Proposed behavior

An application maintainer supplies a built release, its already deployed HTTPS MCP endpoint, intended hosts and listing materials. `saga publish check` validates those inputs; `saga publish prepare` writes the target's materials and a findings record. A separate `saga publish handoff` command records the manual submission that follows. ChatGPT preparation and the release-input format are implemented by CLI3, Claude artifacts by CLI4, and the resumable submission record by CLI5 (`saga publish handoff`, [its README](../../scripts/publish/README.md#resuming-a-handoff-saga-publish-handoff-cli5)). The record is fixture-verified; an actual submission needs the intended publisher's authority and access, and an actual listing needs named-host evidence, neither of which this implementation supplies.

By default, checking reads local artifacts and performs read-only endpoint discovery. It does not invoke application tools, change remote state or fabricate host acceptance. Executing test cases requires an explicitly selected test fixture and authorized credentials. Preparation proceeds automatically through checks and generation; missing information produces specific findings without stopping unrelated preparation.

![Application-owned build and endpoint enter publication checks; host artifacts and evidence support an authorized portal handoff, while platform review remains external.](../../diagrams/host-publication.svg)

[Editable Mermaid](../../diagrams/host-publication.mmd) · [Editable Excalidraw](../../diagrams/host-publication.excalidraw) · [PNG](../../diagrams/host-publication.png)

The implemented targets are:

| Target | Prepared output and distribution path |
| --- | --- |
| ChatGPT | A portable package with root `plugin.json` and `mcp.json`, assets and applicable `extensions.com.openai` metadata. The ZIP references the remote endpoint and follows the portal's **With MCP** flow. [Packaging](https://developers.openai.com/plugins/build/plugins), [submission](https://developers.openai.com/plugins/deploy/submission). |
| Claude | A connector submission dossier for the remote endpoint and MCP App. An optional GitHub plugin bundle can add skills; its connector still requires a separate submission. Desktop `.mcpb` files and Code-only installation are not substitutes for web distribution. [Directory publishing](https://claude.com/docs/directory/publish), [surface support](https://claude.com/docs/plugins/platform-support). |

The maintainer can resume an explicitly authorized portal operation with the prepared materials. The record distinguishes preparation, submission, approval and actual publication, with platform identifiers and observed timestamps. It never equates a generated ZIP or completed upload with a live listing. No undocumented submission API is assumed. Existing authorization can cover the workflow; the local record does not grant it or add a new confirmation requirement.

### One release from preparation to handoff

Suppose a notes application already serves its built card at a public HTTPS endpoint. Its maintainer writes a `saga-publication/1` release input naming that build, the application publisher, the endpoint and target materials. From the SDK source checkout:

```sh
npx tsx scripts/saga.ts publish check --target chatgpt --release ./saga-publication.json
npx tsx scripts/saga.ts publish prepare --target chatgpt --release ./saga-publication.json --out ./publication
```

Discovery initializes the endpoint and reads tools and resources; it makes no application tool call by default. A ready preparation contains `chatgpt-plugin.zip` and `findings.json`, tied to the built and served resource bytes. A failure leaves findings without an apparently complete package. An unknown result, such as an unavailable validator or missing deployment identity, makes the preparation incomplete.

The maintainer can then begin a handoff from that ready output and record an attempt before submitting through the host's portal. If the browser closes before the outcome is known, the next attempt is refused until the maintainer inspects the existing portal record and confirms the submission or records that none occurred. Approval and an observed live listing are later, separate events. The tool records those observations; it does not perform or independently verify the portal actions. [The command reference](../../scripts/publish/README.md#resuming-a-handoff-saga-publish-handoff-cli5) provides the full sequence.

## Responsibilities and interfaces

The optional workspace modules in [`scripts/publish/`](../../scripts/publish/README.md) own release inputs, validation, host artifact generation and handoff records. The single parser loads them only for a publication command. There is no separately published `@saga-a2ui/publish` package. Two target implementations apply their formats and rules, using pinned upstream schemas and available official validators. SAGA adds checks for application/resource consistency that manifest validation cannot establish.

The application owns deployment, hosting, identity, backend effects, listing claims and publisher authority. Publication consumes an endpoint; it does not introduce a hosting platform. Credentials remain in the authorized credential mechanism, with references in local records and no secrets in archives, reports or screenshots.

Publication inputs distinguish the application publisher from credited contributors and the SDK's npm publisher. Preparation preserves that attribution without substituting the tool operator's identity for the intended listing owner; the target publisher and its authority must be confirmed before submission.

Runtime host negotiation and optional [OpenAI MCP extensions](https://developers.openai.com/plugins/build/extensions) belong in `@saga-a2ui/mcp` host adapters. The publication module checks declared support and packages its metadata; it does not implement sidebar behavior, transport or renderer logic. OpenAI's manifest namespace and runtime extension protocol remain separate contracts.

A release record associates source revision, installed SAGA versions, build/archive digests, endpoint deployment identity, tool-definition snapshot, UI resource URIs and resource digests with host-test evidence. If an endpoint cannot establish its deployment identity, the report states that uncertainty. OpenAI may pick up hosted-server changes independently of a new ZIP; the record therefore compares the deployed contract as well as packaged files. The application must preserve live tool/resource compatibility or roll back its deployment. [Remote server review](https://developers.openai.com/plugins/deploy/app-review).

## Failure and recovery

Invalid manifests, missing assets or mismatched resources prevent a ready result for the affected target. Partial generation leaves no apparently complete archive; a rerun replaces generated output only after validation. A host rejection retains its reference and feedback. An uncertain upload outcome requires checking the existing portal record before retrying, preventing duplicate submissions.

Changed tool definitions, deployment identity or resource bytes make affected evidence stale. Rechecking identifies what changed and which host checks need rerunning. A timeout, unavailable validator or changed platform rule produces an unknown or blocked finding, never a pass. Reports record the validator version and documentation date.

Missing publisher access, verification, reviewer credentials or platform approval leaves the handoff pending while other preparation continues. These are platform requirements, not failures to hide or bypass. Claude bundle submission, for example, checks GitHub push access; its publication mode determines whether passing updates can publish automatically. [Claude submission](https://claude.com/docs/plugins/submit).

## Verification outcomes

The implementation is qualified against the following outcomes; actual web installation remains an application-specific observation:

- Given a built fixture and matching endpoint, each target produces valid artifacts referring to the same tools and UI resources. Unchanged inputs reproduce their content digests.
- Default discovery causes zero application tool calls or domain effects. Opted-in fixture tests remain separately identified from real-host observations.
- A missing asset, invalid manifest, secret in output or changed resource prevents a ready claim and identifies the repair.
- Interruption and retry retain the existing submission identity and never duplicate an upload or silently publish.
- Actual ChatGPT web and Claude web runs establish installation, card rendering and supported interactions using the recorded release. Local validators, protocol tests and directory approval do not replace these observations.

## Implementation sequence

CLI3 established the shared release input, discovery and ChatGPT package; CLI4 added Claude connector materials; CLI5 added the local hash-chained handoff record. Their checks preserve init/demo's output-ownership and interruption safety. They are source tooling, not a release of another SDK package.

Publication tooling is optional, and neither it nor external directory approval is a new prerequisite for the [Ansari migration](ansari_adoption.blueprint.md). An owner can prepare a listing through the platform's native flow. The migration's public SDK/npm prerequisite and the destination maintainer's merge authority remain separate.

## Open decisions

The release format, record format and pinned validator recipes are implemented in [the publication modules](../../scripts/publish/README.md#recorded-decisions). An application still must establish its publisher's authority, deployment identity, review materials and access. The endpoint's self-reported name/version does not prove domain ownership. A supported portal automation path would be separate work; the current handoff command reads and writes local records only.

## References

The [reusable MCP connector](reusable_mcp_connector.blueprint.md), [application setup](https://github.com/MachineWisdomAI/saga-a2ui/blob/b10a8882fa5b15ad9a7243f592e5c3dc086d5340/blueprints/features/application_setup.blueprint.md), [package ownership](../../packages/README.md) and [coding standards](../../CODING_STANDARDS.md) define the runtime responsibilities the tooling preserves. The pinned validator/documentation baseline is recorded in the implementation; platform rules can change, so a preparation result does not replace the host's current submission checks.

## Implementation and acceptance records

These records describe the source and fixture observations on 20 October 2026. Issue-closeout statements retain their original timing; none is a claim of an upload, listing or newly repeated validation.

## CLI3 implementation and acceptance — 20 October 2026

Blueprint `19fb26c84116b15a56fec31bfa358898fe96d791` implemented for the ChatGPT preparation slice at `MachineWisdomAI/saga-a2ui@373f467761251d34c621d5d83ba2a321c22308d7` ([PR186](https://github.com/MachineWisdomAI/saga-a2ui/pull/186)). Independent approval [5588900817](https://github.com/MachineWisdomAI/saga-a2ui/pull/186#pullrequestreview-5588900817) covers exact head `9ccd7f70b133c03418c4f2b6dd7851d738a85c83`; [application CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39464761155) and [version policy](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39464761231) passed.

The five [SDK66 criteria](https://github.com/MachineWisdomAI/saga-a2ui/issues/66) map to the following accepted behavior:

| Criterion | Accepted scope and evidence |
| --- | --- |
| Release inputs, records and supported validators | The implementation pins portable manifest schemas with source/license/digest attribution, records validator identities, and keeps the OpenAI authorization extension as an explicit portal handoff rather than silently accepting it under a closed schema. Official requirements were checked during independent review. |
| Complete application and identity validation | Qualification reuses the existing packed starter build and listener, serves its actual built Lit resource, and records observed installed package versions separately from declarations. Build/resource correspondence, tool/resource definitions, assets and publisher/contributor attribution are checked. Declared endpoint name/version equality is bounded evidence, not proof of publisher or domain authority; unresolved deployment identity stays explicit. |
| No-effect discovery and secret boundaries | Default discovery invokes no application tools; fixture invocation requires explicit opt-in. Sanitized output includes unexpected errors escaping assessment, with synthetic-token regressions covering stdout/stderr as well as artifacts. |
| Readiness, determinism and interruption | Missing/invalid inputs, unavailable validators and truncated discovery prevent readiness. Contract metadata/instructions and validator changes invalidate affected freshness. Repeated unchanged inputs retain content digests. Directory identity checks preserve replacement user data and staged interruption tests prevent an apparently complete partial artifact. PNG structure and SVG XML validation reject malformed assets; unavailable XML validation remains unknown. |
| Single optional CLI, preparation only | Commands reuse the existing parser and output-ownership safety. No deployment, directory submission, runtime extension implementation or package publication is performed. |

Independent verification retained 81 passing publication/original-regression checks, then ran 18 affected checks for the final reporting/XML repairs. The final integration changed synchronized version values and prepared-version prose only; those accepted runtime checks were reused. The original broader run passed 137 of 139 cases; the two unrelated framework typechecks lacked adapters in the reused review dependency tree and were not represented as passing. Existing qualified framework evidence remains separate. No new host matrix or live application effects were needed for this preparation scope.

CLI3 source acceptance and its reviewed lifecycle record are complete; SDK66 is closed. CLI4 and CLI5 retain their own acceptance criteria. Application-owner authority, authorized submission, platform review, actual listing installation and named-host evidence are not supplied by generating a ZIP or a ready preparation record.

## CLI4 implementation and acceptance — 20 October 2026

Blueprint `19fb26c84116b15a56fec31bfa358898fe96d791` implemented for Claude connector preparation at `MachineWisdomAI/saga-a2ui@63e857ea6ca9326735657caa0dc2b75622d1082a` ([PR189](https://github.com/MachineWisdomAI/saga-a2ui/pull/189)). Final head `0c149400c07b7c437fdc7938e3bcf895c55115d9` received [independent approval 5590281447](https://github.com/MachineWisdomAI/saga-a2ui/pull/189#pullrequestreview-5590281447); [application CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39481128657) and [version policy](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39481128672) passed.

| SDK67 criterion | Accepted scope and evidence |
| --- | --- |
| Shared records, validators and deterministic generation | `saga publish --target claude` reuses CLI3 release inputs, record identities, output ownership/interruption safety and target-aware prior-artifact checks. The locally available official Claude plugin validator passed; unavailable validation remains an explicit finding. |
| Connector-specific identity without distribution claims | The dossier records the declared endpoint and exact tool/resource/release evidence, including the documented UI-domain calculation. Official submission/authentication/MCP Apps guidance was inspected during review. Local well-formedness and dossier preparation do not establish directory approval, Desktop/Code installation or web distribution. |
| Optional bundle requires supplied scope | Bundle assembly uses only supplied skills, README and license scope and points to the declared endpoint. No sidebar, invented onboarding capability or runtime extension is created. Excess screenshot input is rejected explicitly rather than silently truncated; the independently checked official constraint was three to five screenshots. |
| No effects, safe outputs and honest missing inputs | Default discovery against the qualified synthetic Node listener makes no application-tool calls. Supported bundled text, extensionless files and LICENSE content are scanned for recognized credentials; original public-command credential regressions pass after repair. Missing publisher authority, materials and validators remain explicit findings. |

Independent verification passed 122 supplied Claude/shared publication checks and root TypeScript. After two verified output-validation repairs, 21 affected Claude/independent regression cases and 11 affected shared cases passed; unchanged evidence was reused. Final main integration imported only the accepted TOUR1 record and preserved the reviewed runtime and version outputs. No package installation, named-host tests, deployment, submission or publication was performed. SDK67 is closed after its reviewed lifecycle record; CLI5 retains the separate resumable-handoff scope.

## CLI5 implementation and acceptance — 20 October 2026

Blueprint `19fb26c84116b15a56fec31bfa358898fe96d791` implemented for the fixture-verified resumable-handoff scope at `MachineWisdomAI/saga-a2ui@260b475fdc457dd3d3ca45f7caa9c8b59dcf2bdb` ([PR193](https://github.com/MachineWisdomAI/saga-a2ui/pull/193)). Final head `067e05a64eb58f0dc4a7ac9382922b404e056793` received [independent approval 5591522127](https://github.com/MachineWisdomAI/saga-a2ui/pull/193#pullrequestreview-5591522127); [application CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39494167535) and [version policy](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39494167594) passed.

| SDK68 criterion | Accepted behavior and boundary |
| --- | --- |
| Durable identity, evidence and freshness | The local handoff record retains host-specific identity, release evidence, explicit unverified publisher-authority references and observed timestamps. Changed current preparation/deployment evidence invalidates affected readiness even when a historical live-listing observation exists. Review observations cannot supersede a newer observation with an older one. |
| Uncertain outcomes and safe retry | Persisted attempt/submission/review/listing states remain distinct. Uncertain outcomes require inspecting the existing record before retry; fixtures cover interruption, concurrency and state transitions without duplicate upload or silent publication. Directory and staged-file ownership checks refuse replacement and preserve foreign files, including the native macOS non-`/proc` cleanup path. |
| Supported handoff, no invented service | `saga publish handoff` supports local records for documented manual/native handoff. It makes no network submission, provides no undocumented submission API or hosting service, and bundles no credentials. |
| Fixture verification versus actual publication | Implementation acceptance uses fixtures and public-command regressions. Recorded authority references are not independently verified publisher authority, and recording a listing is not named-host installation evidence. Actual submission, platform review and live installation require their own authorized evidence. |

Independent verification passed 89 affected handoff/parser checks, then 27 focused checks after the first repairs and 11 focused ownership/cleanup/interruption/race/state checks after the final repair, with TypeScript and current-base version policy passing. The final independent macOS reproduction verified that a directory replaced after staging keeps its foreign file and the command refuses the write. Unchanged cases were reused; the Linux-only `/proc` branch was not newly qualified by that macOS run. Worker-reported broad-suite failures were assessed proportionately: 22 request-consumer/playback-budget checks passed in isolation, while a missing Lynx dependency prevented collection in the reused environment and was not a new CLI5 defect. No broad runtime or host matrix was repeated.

All four scoped SDK68 criteria are supported by this evidence; the issue remains open until this lifecycle record is independently reviewed and merged. No actual upload, submission, installation, deployment or publication was performed. The implementation records observations and readiness boundaries; it cannot grant platform approval or establish a live listing by itself.
