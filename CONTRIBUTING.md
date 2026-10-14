# Contributing

Work in a feature branch or dedicated worktree and open a pull request. Keep each change focused on one useful, verifiable outcome. Refine the task immediately before implementation and update later work from what the slice teaches us.

Read [AGENTS.md](AGENTS.md) for repository rules and [CODING_STANDARDS.md](CODING_STANDARDS.md) for package ownership, module interfaces, and TypeScript design. Use normal TypeScript and renderer tools. Record the checks actually run; package installation, local rendering and real-host behavior are separate evidence.

Use README.md for current build, test and dependency commands. Do not publish placeholder packages. When a package gains an owned version, enroll it with the MachineWisdom version-policy tooling and document the resulting release process.

Keep private customer material, credentials, business records and internal planning out of this repository, including its history. Contributions must have appropriate redistribution rights; retain third-party license obligations.

Name documents expected to be superseded `YYYY-MM-DD_title_vN.ext`, for example `2026-10-13_binding-design_v1.md`. Start at `v1`; when a new edition supersedes it, use the new edition date and increment the document version, retain the previous edition, and update links to the current one. Ordinary corrections stay in the same edition. Keep evergreen files such as README.md, CONTRIBUTING.md, CODING_STANDARDS.md, SECURITY.md and AGENTS.md at stable names. Document versions are separate from package versions.

New clones can install the local default-branch and force-push guards with the installed MachineWisdom helper:

```sh
mw-git-guard.sh install --repo .
```

GitHub branch protections apply independently of these local hooks.

## Epic acceptance

This repository owns SDK source, implementation issues, pull requests and contributor documentation. The separate private backstage repository holds internal planning and acceptance records; it is not a contributor destination. SDK issues and PRs must contain enough non-confidential context to implement and review the work without backstage access.

For an epic acceptance PR, the First Officer coordinates the following gates and records evidence against the exact final code revisions:

1. Run `codex-security:security-diff-scan` in a Daybreak cloud session on the latest epic code. Follow confirmed or plausible findings through `codex-security:fix-finding` with Hermes Helmet, then run `codex-security:validation` again in Daybreak on the repaired candidate. Account for every finding and coverage gap; record a no-findings result when no repair is needed. Scan and validate subsequent code changes before acceptance.
2. Independently review [coding standards](CODING_STANDARDS.md), including the refactor step of red-green-refactor, and verify required checks after changes. Record a justified no-change result when no refactor is needed.
3. Review engineering designs with `mw-writing-tech-specs` and human-facing documentation with `mw-writing-for-human-readers`, preserving technical meaning, evidence and approval state.
4. Run `retro` over the epic's delivery and review history. Record code, writing and process improvements with their disposition: applied, deferred to a follow-up, rejected with a reason, or awaiting a decision. Revalidate affected gates after accepted changes.
5. Review the closeout evidence and merge only after current-head reviews, required checks and acceptance gates pass, within the operator's authority. An explicit hold for human acceptance blocks merging until lifted.

Contributors provide reproducible checks and clear documentation; the First Officer owns the specialist security sessions, orchestration and acceptance decision. Missing required evidence leaves acceptance open. Keep security-sensitive details in authorized private channels and include only safe summaries in SDK PRs. Package publication, production deployment and repository visibility changes require their own authority.
