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
- The private Lit application renders A2UI fixtures and the public answer view. `packages/mcp` (`@saga-a2ui/mcp`), `packages/core` (`@saga-a2ui/core`), `packages/lit` (`@saga-a2ui/lit`) and `packages/react` (`@saga-a2ui/react`, only the optional action-attachment qualification of ACT2 and the optional FaithfulCard text and image-consent slices of REACT3-TEXT and REACT3-IMAGES, not React parity) and `packages/components` (`@saga-a2ui/components`, only the passive FaithfulCard preparation slice of CARD1) are the extracted SDK packages (private, unversioned and unreleased); no other SDK package exists yet. `examples/answer-consumer` (Lit), `examples/pack1-consumer` (the notes application: two separately installed Lit consumers, PACK1, and one React consumer, REACT1, sharing one contract, server and set of actions) and `examples/react-card-consumer` (React) are synthetic applications built outside the workspace from the packed packages; they are development checks, not installation recipes. Use README.md for current build and browser-test commands.
- `apps/lit-host` builds the protected player twice from one controller (REACT2): the Lit view (`playback.html`) and a React view (`playback-react.html`, `src/react/play-control.tsx`; no description card). `e2e/playback-view.spec.ts` runs against both through the `lit` and `react` Playwright projects (`e2e/player-renderer.ts`). The React page uses the application's own React runtime and the `core` and `mcp` packages only; it does not use `@saga-a2ui/react`.
- `templates/` holds maintained starter templates (STARTER1: `templates/lit-node`, the `lit-mcp` stack on the `node` server target; STARTER-EXPRESS #62: `templates/lit-express`, the same stack on the `express` target; STARTER-FASTIFY #64: `templates/lit-fastify`, the same stack on the `fastify` target; STARTER-HONO #63: `templates/lit-hono`, the same stack on the official `@modelcontextprotocol/hono` adapter, qualified by `scripts/starter-hono.test.ts`). A template is not a package and not an example: it is the one source the starter output, the existing-backend snippets and the qualification (`scripts/qualified-starters.ts`, `scripts/starter-qualification.ts`, `scripts/starter.test.ts`, `scripts/starter-express.test.ts`, `scripts/starter-fastify.test.ts`, `scripts/starter-hono.test.ts`, `apps/lit-host/e2e/starter.spec.ts`) all read. Test identities and policy stay in the specifications, never in a template; see `templates/README.md`.
- `scripts/saga.ts` is the `saga init --a2ui-stack <renderer>-mcp --server <target> DIR` command (CLI1). It composes `exportTemplate` and offers only the pairs in its `SUPPORTED_PAIRS` list (today `lit-mcp` on `node`); a further pair adds one row there after its own qualification passes. It creates one new directory and installs and runs nothing.
- `docs/getting-started.md` is the setup guide (GUIDE1) and `docs/attach-to-existing-backend.md` its generated existing-backend recipes. Never edit the generated file by hand: `scripts/guide-recipes.ts` (`npm run guide:recipes`) renders it from the qualified templates in `scripts/qualified-starters.ts`, and `scripts/guide.test.ts` checks that it is current and that every command, snippet, package name and link in both documents is real. A newly qualified server joins the recipes by regenerating; a pair joins `saga init` only through `SUPPORTED_PAIRS`.
- `demo/lit-node` is the standalone synthetic demonstration (DEMO1) of the one qualified pair. `scripts/build-demo.ts` builds it from packed candidate tarballs outside the repository into the download `apps/lit-host/dist/demo`. All synthetic identity, media and business data stay in `demo/lit-node/fixtures`; the clean starter and the SDK packages never import it. Its authentication is local-only and stays visibly so.
- Follow CONTRIBUTING.md for document names: supersedable documents use `YYYY-MM-DD_title_vN.ext`; evergreen guides keep stable names.
- When authoring, approving, implementing, superseding or reconciling a Blueprint, follow [its lifecycle records](blueprints/README.md#lifecycle-and-revision-records). Before submitting implementation PR approval, follow [contribution review](CONTRIBUTING.md#review).

- Before preparing or reviewing a PR, follow [PR descriptions and retained artifacts](docs/change-hygiene.md). Keep disposable evidence ignored; stage retained artifacts through Git LFS and verify their pointers before pushing.
