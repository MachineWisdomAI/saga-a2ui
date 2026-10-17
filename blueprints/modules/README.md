# Module Blueprints

A module Blueprint defines one architectural responsibility: what it owns, what callers can rely on, and where its authority ends. Keep the contract independent of a particular renderer or implementation where the behavior is shared. Concrete implementation details belong in the related codebase Blueprint.

Start from the [module template](../templates/module.blueprint.md) and save it as `<module>.blueprint.md`. Match the `name` field to the filename and use `type: module`. Link related module contracts and the features that explain proposed changes. Define modules around established responsibilities; the Blueprint describes that boundary without requiring a new package.

Maintain the [lifecycle record](../README.md#lifecycle-and-revision-records) as the contract is approved, implemented or replaced. Name each implementation separately when adoption differs across codebases.

A2UI's [Core module Blueprint](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/modules/a2ui_core.blueprint.md) illustrates the format; its architecture is an upstream example, not SAGA's module design. Use the [SAGA coding standards](../../CODING_STANDARDS.md) for SAGA ownership boundaries.
