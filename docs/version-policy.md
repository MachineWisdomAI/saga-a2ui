# Version policy

The workspace and private Lit host currently have no owned version. Keep them unversioned until a concrete application or SDK release needs an identity; do not introduce placeholder package versions. Document editions follow CONTRIBUTING.md.

## Enroll the first owned version

On a feature branch, introduce the intended initial version in its owning package. Preserve this pre-enrollment guide under ignored `.wise-agents/` and move it out of `docs/version-policy.md` before running the helper: enrollment generates that path and refuses to overwrite different guidance. Then run the MachineWisdom bootstrap and enroll each independently versioned component:

```sh
mw-repo-init.sh --path . --skip-fava
python3 scripts/mw-version.py enroll --repo . --unit apps/lit-host
```

The second command is an example for a versioned Lit host; use the actual component path. The bootstrap discovers a versioned root; for a nested component with an unversioned root, use the installed toolkit helper `mw-version.py enroll --repo . --unit COMPONENT_PATH` first. Enrollment installs the repository-local updater, `.version-policy.json`, guidance and CI check. Review the generated files and reconcile this guide with the generated guidance instead of overwriting it blindly. Use Python 3.11+.

Give each independently released package one version owner. Add lockfile entries and any runtime/resource identifiers that truly mirror that version to its unit. Keep protocol/answer contract versions independent of release versions. Captured artifacts and historical receipts are not mirrors. Never invent a workspace release merely to coordinate independent units.

## Bump enrolled units per PR

Use Conventional Commit titles and the actual PR title/body with the installed updater. One PR gets the largest applicable increment: features are minor; fixes, documentation, tests, CI, chores and dependency changes are patch. Breaking changes are major from 1.0 onward and minor before 1.0. A dependency's own major version alone does not make this project's change breaking.

After implementation and again after updating from current main:

```sh
git fetch origin main
python3 scripts/mw-version.py update --base origin/main --title 'docs: clarify setup' --body-file /path/to/pr-body.md
python3 scripts/mw-version.py check --base origin/main --title 'docs: clarify setup' --body-file /path/to/pr-body.md
```

Replace the example with the actual PR intent. The updater calculates from the base revision rather than accumulating bumps across review rounds. Shared changes outside unit paths affect every enrolled unit unless the adopted policy explicitly excludes them. Run the generated version check for documentation-only PRs too. Make its passing check part of the protected merge requirements after adoption, with authority to configure protection; never claim enforcement before it is configured.

No software bump applies to the current unversioned tree. Introducing a version without enrollment is a review blocker. CI runs `python3 scripts/check-version-enrollment.py` to reject root or direct `apps/*` / `packages/*` npm versions without registered owners or mirrors and the updater/workflow files. Review the generated configuration and passing Version policy result as well; presence alone does not prove a correct bump. A version update never authorizes a tag, release, package publication or deployment.
