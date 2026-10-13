# Contributing

Work in a feature branch or dedicated worktree and open a pull request. Keep each change focused on one useful, verifiable outcome. Refine the task immediately before implementation and update later work from what the slice teaches us.

Read AGENTS.md for repository rules. Use normal TypeScript and renderer tools. Record the checks actually run; package installation, local rendering and real-host behavior are separate evidence.

The first code change establishes build, test and dependency commands. Do not publish placeholder packages. When a package gains an owned version, enroll it with the MachineWisdom version-policy tooling and document the resulting release process.

Keep private customer material, credentials, business records and internal planning out of this repository, including its history. Contributions must have appropriate redistribution rights; retain third-party license obligations.

Name documents expected to be superseded `YYYY-MM-DD_title_vN.ext`, for example `2026-10-13_binding-design_v1.md`. Start at `v1`; when a new edition supersedes it, use the new edition date and increment the document version, retain the previous edition, and update links to the current one. Ordinary corrections stay in the same edition. Keep evergreen files such as README.md, CONTRIBUTING.md, SECURITY.md and AGENTS.md at stable names. Document versions are separate from package versions.

New clones can install the local default-branch and force-push guards with the installed MachineWisdom helper:

```sh
mw-git-guard.sh install --repo .
```

GitHub branch protections apply independently of these local hooks.
