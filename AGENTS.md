# saga-a2ui - AI Agent Instructions

## Project

This repository is a MachineWisdom TypeScript SDK, initially private and intended for a later public release.

## Shared Operating Rules

- Read the repo-local `AGENTS.md` first. Tool-specific files are additive and must not contradict it.
- Follow explicit operator instructions. Treat AI reviewer findings as evidence: verify and classify them before acting. Do not expand scope because a reviewer suggested it.
- Inspect the exact repo, branch, worktrees, and dirty state before editing. Preserve unrelated changes.
- Make tracked edits only on a dedicated worktree or feature branch. Keep the default checkout clean. Never commit or push directly to the default branch; land tracked changes through a pull request.
- Never force-push or amend a pushed commit. Stage explicit paths only; do not use `git add -A` or `git add .`.
- Versioned PRs: use Conventional Commits and the repo-local `docs/version-policy.md` updater before review and after updating from main. When introducing an owned version, enroll through the repo bootstrap. Version updates are separate from publication.
- Resolve exact targets before destructive work. Do not discard changes, delete material data, merge, deploy, publish, post externally, or alter access without authority for that action.
- Never expose secrets. Keep provider credentials and user data within their authorized boundary.
- Treat `~/git/vendor/` checkouts as read-only. Develop in an owned repository or worktree.
- Route ambiguous new builds through `skills-sage` before coding. Use one shaping route; keep GStack/Pocock advice within the accepted outcome. Use `mw-implementation-stages` for multi-stage delivery or a stalled frontier, and `mw-review` for tracked review and non-converging repairs; use repo-local validation and workflow instructions.
- Keep durable non-trivial specs, plans, decisions, status, and handoffs in FAVA Trails. Promote finalized truth and sync it.
- Do not build “shared-something” helper identities. Use shared-all or shared-none; give shared artifacts one owner and one documented repair path.

## Coding Standards

Read [CODING_STANDARDS.md](CODING_STANDARDS.md) before designing, implementing, refactoring, or reviewing code. Use the `codebase-design` skill for module/interface design when available; the repository standards apply without it.

## Repo Notes

- This is the SDK source repository. It is private initially; making it public requires a separate explicit instruction.
- Keep internal plans, customer records and sensitive research out of this repository and its history.
- Apache-2.0 applies to SDK code; preserve third-party notices.
- The plan is approved. Refine one task at a time and keep implementation within the selected ticket. Do not repeat the entire planning process.
- The private Lit application renders a fixed A2UI fixture. `packages/mcp` (`@saga-a2ui/mcp`, private and unreleased) is the first extracted SDK package; no other SDK package exists yet. Use README.md for current build and browser-test commands.
- Follow CONTRIBUTING.md for document names: supersedable documents use `YYYY-MM-DD_title_vN.ext`; evergreen guides keep stable names.

- Before preparing or reviewing a PR, follow [PR descriptions and retained artifacts](docs/change-hygiene.md). Keep disposable evidence ignored; stage retained artifacts through Git LFS and verify their pointers before pushing.
