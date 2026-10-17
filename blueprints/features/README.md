# Feature Blueprints

A feature Blueprint describes a capability or change that may cross module boundaries. Explain the user-visible outcome, the end-to-end flow, affected contracts, failure behavior and verification outcomes. Keep the short implementation sequence readable without turning it into a task checklist.

Start from the [feature template](../templates/feature.blueprint.md) and save it as `<capability>.blueprint.md`. Match `feature_name` to the filename. List existing module names in `module_blueprints` and prerequisite feature names in `dependencies`; link their documents in the prose. An empty list makes no claim that a corresponding contract exists.

This format adapts A2UI's [feature-authoring skill](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-create-feature-blueprint/SKILL.md). Maintain design approval, implementation revisions and successors using the [lifecycle record](../README.md#lifecycle-and-revision-records); merging a document does not approve or implement its behavior.
