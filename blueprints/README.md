# Blueprints

A Blueprint explains a capability well enough to review its behavior, ownership, main flow and failures before it becomes a collection of implementation tickets. It stays with the code as the readable design throughout delivery.

This workflow applies to future epics. [Authorized playback](features/authorized_playback.blueprint.md) is the first draft. Existing E02/E03 work and holds are unchanged; routine fixes within an accepted design do not need a new epic Blueprint.

## From a specification to delivery

**Spec → Blueprint and diagrams → human design approval → ticket breakdown → human breakdown approval → authorized Helmet delivery**

1. Shape the capability with `to-spec`. Read the accepted design, existing issues and relevant implementation. Keep private discussion and approval provenance in the existing private planning records; bring only the self-contained, publishable design into this repository.
2. Draft a feature Blueprint using the [template](templates/feature.blueprint.md). Apply `mw-writing-tech-specs`, then `mw-writing-for-human-readers`. Use `diagram` for architecture and flow illustrations; keep editable sources and rendered SVG/PNG files in [`diagrams/`](../diagrams/README.md). Present the complete Blueprint and rendered diagrams for human review.
3. Record explicit human design approval in the existing epic record, with the Blueprint path and the Git commit containing the reviewed document and diagrams. Preserve the approval's scope and any unresolved conditions. File creation, a merged documentation PR, AI review and passing checks do not constitute design approval. Without that approval, stop before `to-tickets`.
4. After approval, use `to-tickets`. Each ticket links to the relevant Blueprint sections and has a readable title, outcome and acceptance criteria. Keep detailed worker instructions in tickets. In the existing breakdown review, show which tickets cover each Blueprint outcome and explain genuine blocking relationships. Obtain the human's breakdown approval before delivery. If tickets already exist, reconcile their coverage and add references while preserving issue identities and dependency edges; create no duplicates.
5. Deliver only under the existing Helmet authorization, prerequisite, testing, independent review and acceptance controls. Design approval permits decomposition; it does not authorize dispatch or lift a hold.

For the first authorized-playback draft, the implementation and host-verification tickets already exist. Their reconciliation follows design approval; drafting this Blueprint does not change those tickets or dispatch work.

## Write for the person reviewing the design

Explain the problem and relevant current behavior, then walk through a concrete example. Define unfamiliar terms where they first matter. Describe responsibilities and interfaces, why they are divided that way, material failures, observable verification outcomes and unresolved choices. Include a short implementation sequence showing how the capability comes together, without turning it into a worker checklist.

Distinguish implemented behavior from requirements and proposals. Inspect actual source before describing an interface as existing. An unresolved choice stays visible; prose must not silently choose a mechanism or imply evidence that has not been collected. A reader should be able to explain the behavior, responsible components, request flow, failure handling and verification approach without opening the tickets.

Use stable headings that tickets can link to. Name the feature for its capability in `snake_case`, with matching `feature_name` metadata. Use `status: draft` until the human has approved the reviewed revision; keep the approval receipt in the existing epic, not in a second approval ledger. A status edit alone grants no authority. `date_added` records authorship, not a dated edition or implementation baseline.

## Keep the design useful during delivery

A material change to behavior, architecture, ownership, scope or acceptance requires a Blueprint update and human review before affected work continues. Identify the changed sections and their consequences in the existing epic review. Editorial corrections and implementation choices already allowed by the design do not repeat approval. Keep the reviewed design and affected tickets consistent.

Retain the feature's stable path throughout delivery. If later consolidation moves requirements into module documentation, preserve links and explain where each contract now lives. Do not automatically archive a feature just because its implementation merged. Future user documentation can draw from the Blueprint alongside verified implementation and release behavior; proposed behavior is not a released capability. GitBook and generated documentation are separate work.

## Feature, module and codebase documents

| Kind | Location | Purpose |
| --- | --- | --- |
| Feature | `features/<capability>.blueprint.md` | A capability's behavior, design and verification outcomes, crossing components where needed. |
| Module | `modules/<module>.blueprint.md` | A durable contract for one architectural responsibility, shared by its implementations. Add when there is a real contract to consolidate. |
| Codebase | `codebases/<implementation-path>/codebase.blueprint.md` | Maps a concrete implementation to its module contract. Defer until implementation tracking has a demonstrated use. |

Only feature documents are needed initially. Leave `module_blueprints` empty until the referenced module documents exist; do not invent placeholder modules or packages. Compliance scripts, commit-based implementation baselines, skill installation and further automation are deferred while this document workflow is exercised.

The distinction and stable capability names draw on A2UI's [spec-driven development proposal](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/docs/proposals/spec_driven_development.md) and its [Blueprint skills](https://github.com/a2ui-project/a2ui/tree/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills). SAGA adapts their navigation, feature-authoring and maintenance guidance to this human review workflow. SAGA feature documents may name the concrete TypeScript, Lit and MCP boundaries needed to review a design. Upstream's optional/required lifecycle and hash-compliance workflow are not adopted here. Shared Machine Wisdom and Helmet skills remain unchanged.
