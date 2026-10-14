# Contributing

Work in a feature branch or dedicated worktree and open a pull request. Keep each change focused on one useful, verifiable outcome. Refine the task immediately before implementation and update later work from what the slice teaches us.

Read [AGENTS.md](AGENTS.md) for repository rules and [CODING_STANDARDS.md](CODING_STANDARDS.md) for package ownership, module interfaces, and TypeScript design. Use normal TypeScript and renderer tools. Record the checks actually run; package installation, local rendering and real-host behavior are separate evidence.

Use README.md for current build, test and dependency commands. Do not publish placeholder packages. Follow [the version policy](docs/version-policy.md) when introducing an owned version and for every subsequent bump.

Keep private customer material, credentials, business records and internal planning out of this repository, including its history. Contributions must have appropriate redistribution rights; retain third-party license obligations.

Name documents expected to be superseded `YYYY-MM-DD_title_vN.ext`, for example `2026-10-13_binding-design_v1.md`. Start at `v1`; when a new edition supersedes it, use the new edition date and increment the document version, retain the previous edition, and update links to the current one. Ordinary corrections stay in the same edition. Keep evergreen files such as README.md, CONTRIBUTING.md, CODING_STANDARDS.md, SECURITY.md and AGENTS.md at stable names. Document versions are separate from package versions.

New clones can install the local default-branch and force-push guards with the installed MachineWisdom helper:

```sh
mw-git-guard.sh install --repo .
```

GitHub branch protections apply independently of these local hooks.

## Review

This repository owns SDK source, implementation issues, pull requests and contributor documentation. The separate private backstage repository holds internal planning and acceptance records; it is not a contributor destination. SDK issues and PRs must contain enough non-confidential context to implement and review the work without backstage access.

Every code PR must meet [CODING_STANDARDS.md](CODING_STANDARDS.md) and pass relevant checks on the reviewed commit. Reviewers inspect the changed code and affected interfaces, not just test results. Material standards violations require a bounded correction before approval even when CI passes; stylistic preferences remain non-blocking. Refactoring belongs in the implementation's red–green–refactor cycle.

Provide reproducible checks, clear documentation and any acceptance evidence required by the issue. Preserve explicit human acceptance and merge holds. Package publication, production deployment and repository visibility changes require their own authority.

## PR descriptions and artifacts

Follow [change hygiene](docs/change-hygiene.md) for concise PR descriptions, proportional evidence collection and Git LFS storage. Retain only evidence that supports a specific acceptance claim; keep disposable captures ignored.
