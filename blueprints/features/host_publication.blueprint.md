---
feature_name: host_publication
status: draft
module_blueprints: []
dependencies: []
date_added: 2026-10-16
---

# Prepare an application for host publication

Draft awaiting human design review.

## Problem and current behavior

A working SAGA application still needs host-specific packaging, listing materials and submission evidence before people can discover it in ChatGPT or Claude. Publishing an npm library does not publish an application to either directory.

The current [workspace scripts](../../package.json) build and test the Lit prototype. [CLI1](https://github.com/MachineWisdomAI/saga-a2ui/issues/26) and [CLI2](https://github.com/MachineWisdomAI/saga-a2ui/issues/29) own the planned SAGA CLI's init/demo commands and renderer matrix. Publication preparation would extend that single CLI. No CLI, `@saga-a2ui/publish` package or publication configuration schema is implemented today.

## Proposed behavior

An application maintainer supplies a built release, its already deployed HTTPS MCP endpoint, intended hosts and listing materials. Illustrative commands `saga publish check` and `saga publish prepare` validate those inputs and produce host artifacts, a concise findings report and a resumable submission record. Command names and configuration remain design proposals.

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

After design approval, reconcile additive coverage with CLI1/CLI2 and consider a CLI3 implementation slice; no new issue is assigned here. Establish the release-input and evidence interface, then exercise both host adapters with one application before adding portal handoff. Preserve init/demo and the full renderer matrix, including init's fail-closed behavior against overwrites, unsafe symlinks, implicit installs and remote hooks.

Publication tooling and external directory approval are not new prerequisites for the [Ansari migration](ansari_adoption.blueprint.md). Its existing public SAGA repository and exact-version public npm installation gate remains unchanged. This draft creates no implementation tickets or approval claims.

## Open decisions

Design review must settle the smallest configuration and durable record format, the supported upstream validator versions, and how application deployment identity is supplied. Portal automation requires a supported interface or an explicitly authorized browser workflow; credentials, publisher ownership and platform review remain outside package generation.

## References

The [reusable MCP connector](reusable_mcp_connector.blueprint.md), [package ownership](../../packages/README.md) and [coding standards](../../CODING_STANDARDS.md) define the runtime responsibilities this proposal preserves. Platform sources above were checked on 2026-10-16; implementation must recheck their contracts before fixing a supported recipe.
