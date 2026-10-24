# saga-a2ui - AI Agent Instructions

## Project

This repository is the MachineWisdom TypeScript SDK. It is public and licensed Apache-2.0; preserve third-party notices. Changing repository visibility, publishing a package version or deploying needs its own explicit instruction.

Keep internal plans, customer records and sensitive research out of this repository and its history.

## Shared Operating Rules

- Read the repo-local `AGENTS.md` first. Tool-specific files are additive and must not contradict it.
- Follow explicit operator instructions. Treat AI reviewer findings as evidence: verify and classify them before acting. Do not expand scope because a reviewer suggested it.
- Inspect the exact repo, branch, worktrees, and dirty state before editing. Preserve unrelated changes.
- Make tracked edits only on a dedicated worktree or feature branch. Keep the default checkout clean. Never commit or push directly to the default branch; land tracked changes through a pull request.
- Never force-push or amend a pushed commit. Stage explicit paths only; do not use `git add -A` or `git add .`.
- Versioned PRs: follow `docs/version-policy.md` before review and after syncing main. Docs, tests, CI, and development checks alone need no bump. Use Conventional Commits; enroll owned versions through bootstrap. Publication stays separate.
- Resolve exact targets before destructive work. Do not discard changes, delete material data, merge, deploy, publish, post externally, or alter access without authority for that action.
- Never expose secrets. Keep provider credentials and user data within their authorized boundary.
- Treat `~/git/vendor/` checkouts as read-only. Develop in an owned repository or worktree.
- Route ambiguous new builds through `skills-sage` before coding. Use one shaping route; keep GStack/Pocock advice within the accepted outcome. Use `mw-implementation-stages` for multi-stage delivery or a stalled frontier, and `mw-review` for tracked review and non-converging repairs; use repo-local validation and workflow instructions.
- Keep durable non-trivial specs, plans, decisions, status, and handoffs in FAVA Trails. Promote finalized truth and sync it.
- Do not build “shared-something” helper identities. Use shared-all or shared-none; give shared artifacts one owner and one documented repair path.

## Before you commit

Do this in every development checkout or worktree, including automated worker checkouts.

1. If the pinned root tools are missing, install them with `npm ci --workspaces=false --ignore-scripts`.
2. Install the formatting hook: `npm run hooks:install`.
3. Verify it: `npm run hooks:check`. Continue only when it prints `SAGA formatter hook verified`.

Preserve the existing pre-commit and pre-push safety guards. Linked worktrees share hooks, but each committing worktree needs its own root dependencies. The hook formats whole staged source and configuration files, so keep the formatting baseline current to avoid unrelated formatting hunks. Installation details and troubleshooting: [formatting and hooks](docs/development-reference.md#formatting-and-hooks).

Optional: `npm run lint -- PATH...` gives advisory correctness feedback (pinned actionlint setup is in the same reference). Treat findings and analyzer failures as evidence to assess in ordinary review, not as a repair loop.

## Where to look

Open the document whose trigger matches your task before acting. Each owns its topic; do not restate it elsewhere.

| When you | Read |
| --- | --- |
| Design, implement, refactor or review code | [CODING_STANDARDS.md](CODING_STANDARDS.md); use the `codebase-design` skill for module and interface design when available |
| Build, run, test, or need to know what CI runs | [Local development](docs/development-reference.md#local-development), [CI checks](docs/development-reference.md#ci-checks-and-release-qualification), [repository verification](docs/development-reference.md#repository-verification) |
| Prepare or review a PR, or handle an issue or ticket | [CONTRIBUTING.md](CONTRIBUTING.md#before-you-open-a-pull-request) and [its review rules](CONTRIBUTING.md#review) |
| Write a PR description, collect evidence, or retain an artifact | [docs/change-hygiene.md](docs/change-hygiene.md) |
| Change or check a version | [docs/version-policy.md](docs/version-policy.md) |
| Author, approve, implement, supersede or reconcile a Blueprint | [Blueprint lifecycle records](blueprints/README.md#lifecycle-and-revision-records) |
| Add or change a package, dependency direction or published state | [packages/README.md](packages/README.md); package states are also in [Status](docs/development-reference.md#status) |
| Add or change a starter template | [templates/README.md](templates/README.md) |
| Change `saga publish` or its handoff record | [scripts/publish/README.md](scripts/publish/README.md) |
| Change `saga init` or `saga demo` | [The `saga` command](docs/development-reference.md#the-saga-command) |
| Name a new document | [CONTRIBUTING.md](CONTRIBUTING.md): supersedable documents use `YYYY-MM-DD_title_vN.ext`; evergreen guides keep stable names |

## Repository Rules

- Work on one task at a time within the selected ticket. The plan is approved: do not repeat the planning process.
- SDK issues are for community bug reports and feature requests. All internal delivery tickets, including implementation work, belong in Backstage; code checkouts and PRs remain here. Public PRs and Blueprint evidence must stand alone without private records. Before submitting implementation PR approval, follow [contribution review](CONTRIBUTING.md#review).
- Consumer code (templates, examples, demos and `apps/lit-host` view modules) holds application meaning only. If the SDK lacks an export a consumer needs, add the export; never add glue to the consumer. `scripts/consumer-boundary.test.ts` enforces this. A supported lower-level use takes one reviewed `// saga-boundary: <rule> <reason>` on that line, never a file-wide disable. The scanned and excluded paths are listed in [Package boundaries](docs/development-reference.md#package-boundaries).
- Never edit `docs/attach-to-existing-backend.md` by hand. Regenerate it with `npm run guide:recipes`; `scripts/guide.test.ts` checks that it is current and that every command, snippet, package name and link in it and in `docs/getting-started.md` is real. A newly qualified server joins the recipes by regenerating; a pair joins `saga init` only through `SUPPORTED_PAIRS` in `scripts/saga.ts`, after its own qualification passes.
- `docs/actions.md` quotes source that `scripts/guide-actions-document.test.ts` checks against the files it names. A qualified Hapi template must add its identity-handoff trace to the guide; the document test fails until it does. The guide's confirmation and audit prerequisites are qualification source in `scripts/guide-actions/guarded-archive.ts`, not part of the notes example or an SDK export.
- A template is the one source that starter output, existing-backend snippets and qualification all read. Test identities and policy stay in the specifications, never in a template.
- `saga publish` and `saga publish handoff` are optional tooling (see [scripts/publish/README.md](scripts/publish/README.md)). They deploy, upload and submit nothing, and local Desktop or Code packaging is never reported as web distribution.
- `demo/lit-node` and `demo/tour` hold synthetic data only, in `demo/lit-node/fixtures`. The clean starter and the SDK packages never import them. The demonstration's authentication is local-only and must stay visibly so. A simulated tour answer is not server or host evidence.
- `examples/answer-consumer`, `examples/pack1-consumer` and `examples/react-card-consumer` are synthetic applications built outside the workspace from packed packages. They are development checks, not installation recipes. Use `npm run release:pack` for the release set and the candidate tooling (`candidate:*`) for private qualification copies.
