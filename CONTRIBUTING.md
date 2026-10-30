# Contributing

Work in a feature branch or dedicated worktree and open a pull request. Keep each change focused on one useful, verifiable outcome. Refine the task immediately before implementation and update later work from what the slice teaches us.

Read [AGENTS.md](AGENTS.md) for repository rules and [CODING_STANDARDS.md](CODING_STANDARDS.md) for package ownership, module interfaces, and TypeScript design. Use normal TypeScript and renderer tools. Record the checks actually run; package installation, local rendering and real-host behavior are separate evidence.

Use [Getting started](docs/getting-started.md) for setup and the [development reference](docs/development-reference.md#local-development) for build and test commands. Do not publish placeholder packages. Follow [the version policy](docs/version-policy.md) when introducing an owned version and for every subsequent bump.

Keep private customer material, credentials, business records and internal planning out of this repository, including its history. Contributions must have appropriate redistribution rights; retain third-party license obligations.

New clones can install the local default-branch and force-push guards with the installed MachineWisdom helper:

```sh
mw-git-guard.sh install --repo .
```

GitHub branch protections apply independently of these local hooks.

## Documentation

This section owns what belongs in current SDK documentation and how it is named. Classify the material before choosing where it goes; each kind has one destination:

| Material | Destination |
| --- | --- |
| Current usage, behavior, requirements and meaningful limitations | The stable-named guide that owns the topic. Edit it in place; Git preserves earlier text. |
| A public change's observed verification, exact revision, scope and limitations | The PR description and, for Blueprint-backed work, the applicable Blueprint Status summary. A reader without private access can assess the claim. |
| Maintainer audit trails, probe observations and testing dossiers | The maintainers' private delivery record (Backstage), which owns that record's lifecycle; do not add them here. Keep current guides useful without them. |
| Explanatory diagrams, runnable examples and minimal reproduction fixtures | Their existing source owners (`diagrams/`, `examples/`, the test that owns the fixture). Their purpose distinguishes them from a delivery dossier. |

Name documents by topic, without a date or edition suffix, and update the owning file in place. Keep README.md, CONTRIBUTING.md, CODING_STANDARDS.md, SECURITY.md, AGENTS.md, guides and Blueprints at stable names. An observation's date belongs in the sentence that states it. Document names are separate from package versions. Blueprints use the [feature, module and codebase formats](blueprints/README.md); Git revisions preserve their history.

A document is finished when its examples and links resolve, and the check that covers it (for example `npm run test:headless` for guides with quoted source) passes. Evidence rules are in [change hygiene](docs/change-hygiene.md#evidence).

## Report a problem or propose a feature

Use the [issue forms](https://github.com/MachineWisdomAI/saga-a2ui/issues/new/choose). A bug report is most useful with a small reproduction, expected and actual behavior, the source commit or candidate version, and the host and renderer involved. Remove credentials and private user data from logs. Use [SECURITY.md](SECURITY.md) for vulnerabilities.

For a feature, describe the application problem and a concrete use case. Discuss larger changes before implementing them so maintainers can confirm scope. Documentation fixes and small bug fixes can go straight to a PR. No private planning tools or commercial relationship are required to contribute; maintainer responses depend on availability.

## Review

This repository owns SDK source, code PRs, public Blueprints and diagrams, contributor documentation, and community bug reports and feature requests. Maintainers track all internal delivery work, including implementation tickets, in the private Backstage repository. Public reports remain here even when maintainers coordinate a fix privately.

A public PR explains the problem, scope, design and verification independently. Link a community issue when one exists; an internal change does not need a public delivery ticket or a private-record link. Contributors can propose and review changes without Backstage access or Machine Wisdom tools.

After an authorized merge, maintainers record the landed revision and applicable Blueprint evidence here, and acceptance in their private delivery record. Resolve a community report with a public explanation, PR link and any remaining limits. Use a closing keyword only when the PR fully resolves that public report; otherwise close it explicitly after verification. A code merge alone does not complete private host or human acceptance.

Every code PR must meet [CODING_STANDARDS.md](CODING_STANDARDS.md) and pass relevant checks on the reviewed commit. Reviewers inspect the changed code and affected interfaces, not just test results. Material standards violations require a bounded correction before approval even when CI passes; stylistic preferences remain non-blocking. A PR that adds glue to a consumer (a template, example, `apps/lit-host` view module or starter output) is a standards violation unless the SDK lacks the export, in which case the export is the fix. Refactoring belongs in the implementation's red–green–refactor cycle.

When a Blueprint applies, the reviewer submitting **Approve** verifies its [lifecycle record](blueprints/README.md#lifecycle-and-revision-records): human approval covers the design revision and scope being implemented, the visible status agrees with the decision, and the changed behavior satisfies the relevant requirements with observed evidence. Use the coordinator's public-safe approval attestation; contributors need no private repository access. Missing approval evidence, a stale draft label on the applicable approved design, or an unsupported implementation/supersession claim blocks that implementation approval until corrected. Name the design revision, reviewed code head, covered scope and remaining gaps in the review. An unrelated draft or a documentation PR presenting an unapproved design does not trigger this implementation gate.

Before approval, identify the delivery coordinator responsible for recording the landed code SHA. The final merge SHA is unavailable before merge: review the candidate evidence and proposed completion scope, then have that coordinator submit the status update after the protected merge. Closeout is complete when the actual merged revision and evidence are recorded. Status-only changes preserve the design approval and require ordinary documentation review; they do not repeat human design approval. Material design changes return for that approval before affected implementation proceeds.

Provide reproducible checks, clear documentation and any acceptance evidence required by the issue. Preserve explicit human acceptance and merge holds. Package publication, production deployment and repository visibility changes require their own authority.

## PR descriptions and artifacts

Follow [change hygiene](docs/change-hygiene.md) for concise PR descriptions, [evidence](docs/change-hygiene.md#evidence) and Git LFS storage.
