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

## Codebase Design

Keep changes small enough for a maintainer learning TypeScript and frontend development to read and explain. Use the `codebase-design` skill when designing or restructuring modules and their interfaces, when available; the following rules apply in every environment.

- A **module** has an interface and an implementation. Its **interface** includes accepted inputs, invariants, ordering, errors, and configuration. A **seam** is where behavior can be replaced through an interface; an **adapter** supplies that behavior. Seek **depth**: useful behavior behind a small interface, with knowledge and fixes kept local.
- Introduce a module when it hides meaningful complexity from callers. Keep simple operations direct; extract when there is a concrete responsibility or actual variation, rather than adding pass-through wrappers or anticipating future adapters. A private function can be enough.
- Prefer descriptive names, ordinary control flow, and explicit intermediate values where they clarify intent. Explain non-obvious invariants and library constraints in comments. PR descriptions should explain why unfamiliar TypeScript or frontend mechanisms are needed.
- Keep unchecked external data as `unknown` until validated at the ingestion seam. Give normalization and validation one clear owner, using public library schemas or processor validation where they satisfy the contract. Add application checks for demonstrated gaps; keep wire-shape checks out of rendering logic.
- Make input types match the supported protocol versions and payload forms. Prefer named public library types over reconstructing equivalent types. Check authored fixtures with a type annotation or `satisfies`. Type assertions do not validate data: replace `as unknown as T` escapes with compatible types or validation; isolate any necessary interop assertion and explain the invariant that makes it safe.
- After validation, narrow to the message variant and use its typed fields. `Array.isArray` is appropriate for unchecked input or a supported single-or-array interface; repeated nested shape checks on validated values suggest a missing contract. Distinguish skipping an unrelated message variant from rejecting a malformed message, and preserve documented failure behavior.
- Separate pure decisions from effects where useful; accept dependencies when callers or tests need to vary them. Test observable behavior through the same interface callers use, including relevant invalid input and recovery. Keep real browser tests for rendering and lifecycle behavior.
- During review, trace each new abstraction, assertion, and defensive check to a current requirement or library constraint. Simplify what adds no useful behavior, while preserving supported input forms, safety checks, and failure semantics. Keep unrelated refactors separate.

## Repo Notes

- This is the SDK source repository. It is private initially; making it public requires a separate explicit instruction.
- Keep internal plans, customer records and sensitive research out of this repository and its history.
- Apache-2.0 applies to SDK code; preserve third-party notices.
- The plan is approved. Refine one task at a time and keep implementation within the selected ticket. Do not repeat the entire planning process.
- The private Lit application renders a fixed A2UI fixture. No SDK packages exist yet. Use README.md for current build and browser-test commands.
- Follow CONTRIBUTING.md for document names: supersedable documents use `YYYY-MM-DD_title_vN.ext`; evergreen guides keep stable names.
