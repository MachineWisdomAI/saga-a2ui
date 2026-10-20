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
- Implementation: partial. The ChatGPT preparation slice (CLI3) is implemented and independently verified; Claude connector materials (CLI4) and resumable submission handoff (CLI5) remain separate unfinished scopes.
- Acceptance: application-owner agreement, authorized submissions and each host’s directory approval remain separate; design approval authorizes none of those actions.

## Problem and current behavior

A working SAGA application still needs host-specific packaging, listing materials and submission evidence before people can discover it in ChatGPT or Claude. Publishing an npm library does not publish an application to either directory. Hosting is the application owner's deployed HTTPS MCP service, and nothing in this proposal deploys it. A directory listing is the host's own review and publication of the application, which only the host can grant.

The existing single SAGA CLI provides init and demo commands. CLI3 now adds `saga publish check` and `saga publish prepare` through optional workspace publication tooling. It prepares a ChatGPT artifact and evidence record; it does not deploy an application, submit it or establish a live directory listing. No separately published `@saga-a2ui/publish` package is claimed.

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

CLI3 source acceptance is complete; SDK66 remains open until this lifecycle record is reviewed and merged. CLI4 and CLI5 retain their own acceptance criteria. Application-owner authority, authorized submission, platform review, actual listing installation and named-host evidence are not supplied by generating a ZIP or a ready preparation record.

## Proposed behavior

An application maintainer supplies a built release, its already deployed HTTPS MCP endpoint, intended hosts and listing materials. Illustrative commands `saga publish check` and `saga publish prepare` validate those inputs and produce host artifacts, a concise findings report and a resumable submission record. The ChatGPT commands and release-input format are implemented by CLI3; Claude artifacts and resumable submission behavior below remain the approved remaining design.

By default, checking reads local artifacts and performs read-only endpoint discovery. It does not invoke application tools, change remote state or fabricate host acceptance. Executing test cases requires an explicitly selected test fixture and authorized credentials. Preparation proceeds automatically through checks and generation; missing information produces specific findings without stopping unrelated preparation.

![Application-owned build and endpoint enter publication checks; host artifacts and evidence support an authorized portal handoff, while platform review remains external.](../../diagrams/host-publication.svg)

[Editable Mermaid](../../diagrams/host-publication.mmd) · [Editable Excalidraw](../../diagrams/host-publication.excalidraw) · [PNG](../../diagrams/host-publication.png)

The proposed first targets are:

| Target | Prepared output and distribution path |
| --- | --- |
| ChatGPT | A portable package with root `plugin.json` and `mcp.json`, assets and applicable `extensions.com.openai` metadata. The ZIP references the remote endpoint and follows the portal's **With MCP** flow. [Packaging](https://developers.openai.com/plugins/build/plugins), [submission](https://developers.openai.com/plugins/deploy/submission). |
| Claude | A connector submission dossier for the remote endpoint and MCP App. An optional GitHub plugin bundle can add skills; its connector still requires a separate submission. Desktop `.mcpb` files and Code-only installation are not substitutes for web distribution. [Directory publishing](https://claude.com/docs/directory/publish), [surface support](https://claude.com/docs/plugins/platform-support). |

The maintainer can resume an explicitly authorized portal operation with the prepared materials. The record distinguishes preparation, submission, approval and actual publication, with platform identifiers and observed timestamps. It never equates a generated ZIP or completed upload with a live listing. No undocumented submission API is assumed. Existing authorization can cover the workflow; this proposal introduces no mandatory confirmation at every step.

## Responsibilities and interfaces

The proposed `@saga-a2ui/publish` module owns publication inputs, validation, host artifact generation and submission records behind the SAGA CLI. Two host adapters apply their respective formats and rules. Reuse official schemas and validators, including Claude's supported plugin validator, instead of maintaining competing manifest definitions. SAGA adds checks for application/resource consistency and evidence that upstream validators do not establish.

The application owns deployment, hosting, identity, backend effects, listing claims and publisher authority. Publication consumes an endpoint; it does not introduce a hosting platform. Credentials remain in the authorized credential mechanism, with references in local records and no secrets in archives, reports or screenshots.

Publication inputs distinguish the application publisher from credited contributors and the SDK's npm publisher. Preparation preserves that attribution without substituting the tool operator's identity for the intended listing owner; the target publisher and its authority must be confirmed before submission.

Runtime host negotiation and optional [OpenAI MCP extensions](https://developers.openai.com/plugins/build/extensions) belong in `@saga-a2ui/mcp` host adapters. The publication module checks declared support and packages its metadata; it does not implement sidebar behavior, transport or renderer logic. OpenAI's manifest namespace and runtime extension protocol remain separate contracts.

A release record associates source revision, installed SAGA versions, build/archive digests, endpoint deployment identity, tool-definition snapshot, UI resource URIs and resource digests with host-test evidence. If an endpoint cannot establish its deployment identity, the report states that uncertainty. OpenAI may pick up hosted-server changes independently of a new ZIP; the record therefore compares the deployed contract as well as packaged files. The application must preserve live tool/resource compatibility or roll back its deployment. [Remote server review](https://developers.openai.com/plugins/deploy/app-review).

## Failure and recovery

Invalid manifests, missing assets or mismatched resources prevent a ready result for the affected target. Partial generation leaves no apparently complete archive; a rerun replaces generated output only after validation. A host rejection retains its reference and feedback. An uncertain upload outcome requires checking the existing portal record before retrying, preventing duplicate submissions.

Changed tool definitions, deployment identity or resource bytes make affected evidence stale. Rechecking identifies what changed and which host checks need rerunning. A timeout, unavailable validator or changed platform rule produces an unknown or blocked finding, never a pass. Reports record the validator version and documentation date.

Missing publisher access, verification, reviewer credentials or platform approval leaves the handoff pending while other preparation continues. These are platform requirements, not failures to hide or bypass. Claude bundle submission, for example, checks GitHub push access; its publication mode determines whether passing updates can publish automatically. [Claude submission](https://claude.com/docs/plugins/submit).

## Verification outcomes

An accepted implementation would demonstrate these outcomes:

- Given a built fixture and matching endpoint, each target produces valid artifacts referring to the same tools and UI resources. Unchanged inputs reproduce their content digests.
- Default discovery causes zero application tool calls or domain effects. Opted-in fixture tests remain separately identified from real-host observations.
- A missing asset, invalid manifest, secret in output or changed resource prevents a ready claim and identifies the repair.
- Interruption and retry retain the existing submission identity and never duplicate an upload or silently publish.
- Actual ChatGPT web and Claude web runs establish installation, card rendering and supported interactions using the recorded release. Local validators, protocol tests and directory approval do not replace these observations.

## Implementation sequence

After design approval, reconcile additive coverage with CLI1 and CLI2 and consider a further CLI implementation slice, here called CLI3; no new issue is assigned to it. Establish the release-input and evidence interface, then exercise both host adapters with one application before adding portal handoff. Preserve init/demo and the full renderer matrix, including init's fail-closed behavior against overwrites, unsafe symlinks, implicit installs and remote hooks.

Publication tooling is optional developer tooling, and neither it nor external directory approval is a new prerequisite for the [Ansari migration](ansari_adoption.blueprint.md). If the tooling is not ready, a first listing can be prepared through each platform's native flow. The migration's existing gate remains unchanged: the SAGA source must be public and the exact required package versions must install anonymously from public npm. Design approval creates no implementation tickets or publication authority.

## Open decisions

Design review must settle the smallest configuration and durable record format, the supported upstream validator versions, and how application deployment identity is supplied. Portal automation requires a supported interface or an explicitly authorized browser workflow; credentials, publisher ownership and platform review remain outside package generation.

## References

The [reusable MCP connector](reusable_mcp_connector.blueprint.md), [application setup](https://github.com/MachineWisdomAI/saga-a2ui/blob/b10a8882fa5b15ad9a7243f592e5c3dc086d5340/blueprints/features/application_setup.blueprint.md), [package ownership](../../packages/README.md) and [coding standards](../../CODING_STANDARDS.md) define the runtime responsibilities this proposal preserves. Platform sources above were checked on 2026-10-16; implementation must recheck their contracts before fixing a supported recipe.
