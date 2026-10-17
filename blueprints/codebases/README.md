# Codebase Blueprints

A codebase Blueprint describes how one concrete implementation meets its associated module contract. Record the implementation path, supported behavior, relevant design choices, known gaps and verification evidence. It gives a reader the connection between an architectural contract and the code that realizes it.

Start from the [codebase template](../templates/codebase.blueprint.md). Store it at `<implementation-path>/codebase.blueprint.md` within this directory, mirroring the repository-relative implementation path. Set `codebase_path` to that path and `associated_module` to an existing module Blueprint's name. Claim a feature in `implemented_features` only when its behavior has been verified; proposed work belongs in a feature Blueprint.

Use the [lifecycle record](../README.md#lifecycle-and-revision-records) to connect each approved contract revision with the landed implementation SHA, supported scope and verification. Preserve earlier mappings when the contract changes; a proposed successor does not invalidate the existing implementation record.

The format follows A2UI's [codebase example](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/codebases/typescript/a2ui_agent/codebase.blueprint.md) and [navigator](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-blueprint-navigator/SKILL.md). Upstream also records `module_blueprint_commit` for baseline comparison. Leave that field absent unless a review establishes the implementation's alignment with that module revision; a hash alone does not prove conformance. Automated baseline reporting is not part of this workflow.
