# Blueprints

SAGA uses the three document types from [A2UI's Blueprint model](https://github.com/a2ui-project/a2ui/tree/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints), described in its [spec-driven development proposal](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/docs/proposals/spec_driven_development.md). Blueprints keep the design readable alongside the code and give implementation issues a shared contract to reference.

| Type | Location and guidance | Describes | Template |
| --- | --- | --- | --- |
| Feature | [`features/`](features/README.md) | A capability or change, including its effects across modules. | [Feature](templates/feature.blueprint.md) |
| Module | [`modules/`](modules/README.md) | One architectural responsibility, its interfaces and required behavior across implementations. | [Module](templates/module.blueprint.md) |
| Codebase | [`codebases/`](codebases/README.md) | A concrete implementation's relationship to its module contract, including supported behavior and gaps. | [Codebase](templates/codebase.blueprint.md) |

```text
blueprints/
  features/<capability>.blueprint.md
  modules/<module>.blueprint.md
  codebases/<implementation-path>/codebase.blueprint.md
  templates/
```

Use stable `snake_case` capability and module names. Codebase paths mirror the implementation's repository-relative path. Blueprint filenames have no date or edition suffix; dated research follows the separate convention in [CONTRIBUTING.md](../CONTRIBUTING.md). Link related Blueprints and use stable headings so tickets can reference the relevant requirements.

## Authoring

Write a self-contained design for human readers: the problem, current behavior, responsibilities, interfaces, representative flow, rationale, failures, verification outcomes and open decisions. Use `mw-writing-tech-specs`, followed by `mw-writing-for-human-readers`. Keep detailed worker instructions in implementation issues. Distinguish existing behavior from a proposal and preserve uncertainties that affect the design.

Make verification outcomes concrete: state the input or condition, expected observable result and boundary being exercised. For example, an image-policy contract could require empty input to produce `img-src 'none'`, populated input to preserve permitted origins, and a mounted frame to load a permitted image while blocking an unlisted origin. The directive and browser behavior are separate claims requiring different evidence.

Use `diagram` when an illustration clarifies the architecture or flow. Store editable sources and rendered SVG/PNG outputs in the repository's `diagrams/` directory, embed the relevant output and inspect it before review. Follow [change hygiene](../docs/change-hygiene.md) for retained artifacts and Git LFS.

Blueprints and linked implementation issues must be usable without private planning context. Keep internal discussion and human approval provenance in the private planning records; publish the approved revision, scope and implementation evidence here. User documentation draws on these designs together with verified implementation and release behavior.

## Lifecycle and revision records

Feature and module front matter uses `status` for the design decision: `draft`, `approved`, `rejected` or `superseded`. A documentation merge or AI review does not change that decision. Keep a short **Status** section near the title; update it when human approval, implementation evidence or a successor changes what the reader can rely on.

| Record | What to write |
| --- | --- |
| Design | The human decision and a permalink to the reviewed repository, Blueprint path and full Git commit SHA, including the reviewed diagrams. Preserve approval conditions. |
| Implementation | `Not started`, `Partial`, `Implemented` or `Unverified`, independently of design status. For each completed scope, record **Blueprint `<design SHA>` implemented at `<code repository>@<landed code SHA>`**, with PR/review and verification links. Name missing scope; several PRs or repositories may need separate entries. |
| Acceptance | Required host, installation, release or human acceptance still open. Source implementation does not satisfy these automatically. |
| Successor | Its path and full revision, `draft` or `approved`, and the scope it proposes to replace. Preserve earlier design-to-code records. A draft leaves the prior approved design current; an approved replacement supersedes only its named scope, even before replacement code lands. |

For a revision at the same path, retain the earlier approved/implemented entry and add the new revision and its decision. Set `status: draft` while the changed design awaits approval and identify the earlier approved baseline explicitly. Use `superseded` for a wholly replaced design; a partial amendment keeps the unaffected contract approved. A rejected proposal remains rejected when a replacement is merely proposed. Editorial and status-only edits preserve the approved design revision; material contract changes need human approval.

Pin an existing reviewed commit, not the moving branch or the latest commit touching the file. A status edit must not try to contain its own future commit SHA. When a newly approved design has just been committed, record that revision in a subsequent status-only commit. After implementation merges, use the actual merge/squash SHA in a follow-up status update; before merge, identify the reviewed candidate and the pending landed SHA instead of claiming completion.

The author or delivery coordinator maintains this section. The reviewer who submits implementation PR approval checks it against the applicable approved design and the PR's evidence, following [contribution review](../CONTRIBUTING.md#review). An implementation PR completing only one slice records that slice, not the whole design. Codebase Blueprints use the same design-to-code records for each associated module/feature; their own prose documents inspected implementation rather than granting design approval.

When reconciling old records, recover the actual human decision and exact reviewed revision. Preserve an explicit approval-evidence gap if those cannot be established; neither merged code nor a favorable AI review supplies retroactive approval. Historical implementation evidence can still be recorded with that limitation. Keep private approval sources outside the SDK; the delivery coordinator supplies a public-safe attestation of decision, revision, scope and conditions in the SDK PR so contributors can review without private access.

## Upstream guidance and SAGA adaptations

The source links are pinned to A2UI revision `1657e70119eaa3b76c2a106ac60c7c4dcfe206e0` so the adopted conventions can be compared with upstream changes.

| A2UI skill | Use in SAGA |
| --- | --- |
| [Blueprint navigator](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-blueprint-navigator/SKILL.md) | Navigate from a feature to its module contracts and their concrete implementations. |
| [Create feature Blueprint](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-create-feature-blueprint/SKILL.md) | Use capability names and explicit module/dependency references. SAGA's template adds a human-readable design flow and review status. |
| [Implement from Blueprint](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-implement-feature-from-blueprint/SKILL.md) | Read the relevant design and implementation context. Delivery still follows the assigned issue and repository review/testing rules. |
| [Blueprint maintenance](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-blueprint-maintenance/SKILL.md) | Consolidate durable behavior into module contracts when appropriate, preserving links from features and tickets. |

SAGA uses readable design sections and may name concrete TypeScript, Lit and MCP boundaries where they matter. Feature paths remain stable through delivery; consolidation must preserve their references. The upstream skills are references, not installed copies. This adoption covers document formats and authoring guidance; it does not install their validator, skill-linking script or [automated compliance workflow](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-blueprint-compliance/SKILL.md).
