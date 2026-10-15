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

Use `diagram` when an illustration clarifies the architecture or flow. Store editable sources and rendered SVG/PNG outputs in the repository's `diagrams/` directory, embed the relevant output and inspect it before review. Follow [change hygiene](../docs/change-hygiene.md) for retained artifacts and Git LFS.

Blueprints and linked implementation issues must be usable without private planning context. Keep internal discussion, audit chronology and approval provenance in the private planning records. User documentation draws on these designs together with verified implementation and release behavior.

## Upstream guidance and SAGA adaptations

The source links are pinned to A2UI revision `1657e70119eaa3b76c2a106ac60c7c4dcfe206e0` so the adopted conventions can be compared with upstream changes.

| A2UI skill | Use in SAGA |
| --- | --- |
| [Blueprint navigator](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-blueprint-navigator/SKILL.md) | Navigate from a feature to its module contracts and their concrete implementations. |
| [Create feature Blueprint](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-create-feature-blueprint/SKILL.md) | Use capability names and explicit module/dependency references. SAGA's template adds a human-readable design flow and review status. |
| [Implement from Blueprint](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-implement-feature-from-blueprint/SKILL.md) | Read the relevant design and implementation context. Delivery still follows the assigned issue and repository review/testing rules. |
| [Blueprint maintenance](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-blueprint-maintenance/SKILL.md) | Consolidate durable behavior into module contracts when appropriate, preserving links from features and tickets. |

SAGA uses readable design sections and may name concrete TypeScript, Lit and MCP boundaries where they matter. Feature paths remain stable through delivery; consolidation must preserve their references. The upstream skills are references, not installed copies. This adoption covers document formats and authoring guidance; it does not install their validator, skill-linking script or [automated compliance workflow](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-blueprint-compliance/SKILL.md).
