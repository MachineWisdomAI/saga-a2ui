---
feature_name: getting_started_tracks
status: approved
module_blueprints: [action_binding]
dependencies: [application_setup, view_conversation, view_composition, reusable_mcp_connector]
date_added: 2026-10-27
---

# Getting started: a React starter and a tic-tac-toe guide

## Status

- Message UX amendment: on 2026-10-29 the owner requested **Your turn** without an identifier or instructions in the visible message, explicit Send guidance, and a card control that reveals its game ID. The amendment is recorded at [`63430da8bbb3cf19364ed4c885c0946e0e0d751d`](https://github.com/MachineWisdomAI/saga-a2ui/blob/63430da8bbb3cf19364ed4c885c0946e0e0d751d/blueprints/features/getting_started_tracks.blueprint.md). The game and move instructions remain in hidden context, which must succeed before sending the short turn message. **New game** prepares **Let’s play a new game.** Blueprint `63430da8bbb3cf19364ed4c885c0946e0e0d751d` implemented at `MachineWisdomAI/saga-a2ui@fee90dac2eba1c1354fd8e2f7fd5fff953f43557` ([PR #347](https://github.com/MachineWisdomAI/saga-a2ui/pull/347)); verification and host limits are recorded below.

- Recovery amendment: the owner approved a fresh card for each **New game** on 2026-10-29. The amended behavior is recorded at [`49205a6b9342ebf3f1770bb9541386a13d623edd`](https://github.com/MachineWisdomAI/saga-a2ui/blob/49205a6b9342ebf3f1770bb9541386a13d623edd/blueprints/features/getting_started_tracks.blueprint.md): a prepared conversation request opens the new card; remounted cards read their current game; a confirmed move whose reply was lost gets its missing handoff. This is a bounded amendment to the approved tutorial, with host confirmations still permitted. Blueprint `49205a6b9342ebf3f1770bb9541386a13d623edd` implemented at `MachineWisdomAI/saga-a2ui@fee90dac2eba1c1354fd8e2f7fd5fff953f43557` ([PR #347](https://github.com/MachineWisdomAI/saga-a2ui/pull/347)). The reproduced lost-reply path is repaired; the original intermittent missing-message incident and the cause of the historical duplicate `new_game` calls remain unproven.
- Recovery and message verification: [independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/347#pullrequestreview-5706266467) approved exact head `887db7a13b1797dd5764d1cf5b17e7d210340e8f`; [full CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40972097860) passed. The reviewer independently passed all 24 game Chromium cases, seven controller cases, 135 documentation checks, affected typechecks and the packed game build. Regressions cover saved-result restoration, confirmed-move handoff after a lost reply, refusal to send a short message when context fails, duplicate New game activation, Send guidance and game-ID disclosure. A failed current-game read keeps squares disabled until the card can be reopened and read successfully; no read-retry control was added.
- Short-message host qualification on 2026-10-29 used the amended move-list app, public npm `0.9.0-rc.1` packages and a Quick Tunnel. Claude Desktop → Code opened two separate cards. An X move in the older card followed by **Your turn** and Send led to O in that same game while the newer board remained empty; repeating on the newer card played O there. The older-card reply made extra context/tool lookups, including two failed calls, before choosing correctly. ChatGPT web Pro sent **Your turn** automatically and completed X→O on its original card after one initial display retry. Both hosts showed the Send hint and revealed the game ID on request. Neither required a typed turn clarification or board refresh during play. The tested HTML SHA256 is `fe700b1cc74536770d6138f7fa162d4a8181dd45e61f6a4db50d77e18ddd4f0d`.
- Earlier recovery qualification, before the message amendment, completed a nine-move draw and restored played and completed cards in Claude Desktop → Code. ChatGPT opened a separate new card while preserving the old board; each card needed an initial display retry. These observations remain evidence for unchanged recovery behavior, not first-load reliability. The repaired examples and guide need no new SDK release. Temporary test connections were removed or uninstalled and the task's server and tunnel stopped; the reader's app was preserved. The original intermittent incidents remain unresolved, and these checks do not constitute personal acceptance by the owner.
- Design: approved by the owner on 2026-10-28 at [`6c3638b3f372c27d12b406a0c4800ea01f93cf24`](https://github.com/MachineWisdomAI/saga-a2ui/blob/6c3638b3f372c27d12b406a0c4800ea01f93cf24/blueprints/features/getting_started_tracks.blueprint.md), including the reviewed diagram ([Mermaid](https://github.com/MachineWisdomAI/saga-a2ui/blob/6c3638b3f372c27d12b406a0c4800ea01f93cf24/diagrams/tic-tac-toe-turn-loop.mmd), [SVG](https://github.com/MachineWisdomAI/saga-a2ui/blob/6c3638b3f372c27d12b406a0c4800ea01f93cf24/diagrams/tic-tac-toe-turn-loop.svg), [PNG](https://github.com/MachineWisdomAI/saga-a2ui/blob/6c3638b3f372c27d12b406a0c4800ea01f93cf24/diagrams/tic-tac-toe-turn-loop.png)).
- Implementation: source scope and integrated local qualification are complete in the revisions below; final human acceptance remains pending. Blueprint `6c3638b3f372c27d12b406a0c4800ea01f93cf24` implemented for the React/Hono starter scope at `MachineWisdomAI/saga-a2ui@0ad4acba45ea179031bf9d0071946b3d648b9297` ([PR #325](https://github.com/MachineWisdomAI/saga-a2ui/pull/325)). The maintained `templates/react-hono`, qualified CLI pair, stack-aware qualification and generated recipes are landed. [Independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/325#pullrequestreview-5691176422) covered final head `7085eebe5329e8a2f23604697e98a3ce7eb529e3`; [application qualification CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40789828879) passed.
- The same Blueprint's conversation and viewless-operation scope is implemented at `MachineWisdomAI/saga-a2ui@c6cecdfb502f43360010b720d2a63b87c45b6466` ([PR #326](https://github.com/MachineWisdomAI/saga-a2ui/pull/326)). [Independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/326#pullrequestreview-5696385580) approved integrated head `6df6a44b08d28b3131abaf0c6179049fc9a1d6b7`; [application qualification CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40859198727) passed. Viewless operations preserve schema validation, bounded execution, projection and protected identity. [View conversation Status](view_conversation.blueprint.md#status) records its local qualification and host limits. The completed guide tracks are recorded below.
- The same Blueprint's public brand-copy scope is implemented at `MachineWisdomAI/saga-a2ui@d298ea4851477a0434e0b559c8217262ad74b3e1` ([PR #329](https://github.com/MachineWisdomAI/saga-a2ui/pull/329)): the README and development-reference introductions expand the framework name as Simple Agentic Apps. [Independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/329#pullrequestreview-5696728696) approved head `a80a163132c8b32980c462c23360a45a05f9cb85`; 126 local documentation checks and [documentation CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40863086431) passed. Framework/app naming and visual identity are unchanged. This records the public source scope; integrated local qualification is recorded below.
- The same Blueprint's tic-tac-toe example and draft guide-opening scope is implemented at `MachineWisdomAI/saga-a2ui@5dca1ca938a2dd0d30cec099524f62133e859c80` ([PR #332](https://github.com/MachineWisdomAI/saga-a2ui/pull/332)). [Independent re-review](https://github.com/MachineWisdomAI/saga-a2ui/pull/332#pullrequestreview-5697664117) approved head `686ac2c09eadcceca03253a02cb67b184a21d86e`; [application qualification CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40872570654) passed. Local qualification covers the rules and atomic move checks, both view-opening and viewless operations, conversation hand-over, bounded waiting, stale responses and a reproducible move-list change. The re-review observed 164 affected checks and 23 game Chromium cases plus an independent recovery regression that failed before repair and passed after it. The owner explicitly delegated acceptance of the inspected rendered opening on 2026-10-29; that editorial checkpoint is satisfied. The full guide is recorded below; integrated local qualification is recorded below.
- The same Blueprint's full guide and setup-track split is implemented at `MachineWisdomAI/saga-a2ui@738b37e57c3b21f679c5f9d848ad9fce76d0335f` ([PR #335](https://github.com/MachineWisdomAI/saga-a2ui/pull/335)). [Independent writing and technical re-review](https://github.com/MachineWisdomAI/saga-a2ui/pull/335#pullrequestreview-5698787382) approved head `15c02bb53830b5e348246064f1c4a4a4bb1b0f93`; [application qualification CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40885358159) passed. The common setup guide now leads to the complete React game guide and a Lit track whose six moved sections are unchanged. Commands, quoted source, links and recipe freshness passed 171 documentation checks; eight packed-example checks passed with `TMPDIR=/private/tmp` to avoid the review machine's temporary-path alias, and the guided move-list Chromium walkthrough passed. Normal and guided packed builds were tracked-clean at the reviewed source. These are source and local-fixture observations, not an assistant-host run.
- Integrated local qualification of the complete walkthrough was run on `MachineWisdomAI/saga-a2ui@0e9452be7c9a571c8644fe9fbca512dc592e9537`, the revision on which every scope above had landed, before this record was written. Outside the checkout, the real `saga init --a2ui-stack react-mcp --server hono` created a starter. The five React-side candidate tarballs (`0.0.0-candidate.g0e9452be7c9a`, a private candidate and not a registry release) installed into it, and `npm run typecheck`, `npm run build` and `npm start` passed. Over HTTP MCP, `/status/mcp` listed `get_status` with its view and `/account/mcp` refused a request without a credential. Built with the guide's own commands (`npm run build -w apps/lit-host`, then `npm run build:tic-tac-toe`), the example and the guided move-list build each started and printed the guide's endpoint line. Each listed four operations, with a view on `new_game` and `show_game` and none on `get_game` or `play_move`, and each played a whole game to an X win while the post-game move was refused with no change. In Chromium on the local host fixture, all 23 cases of `apps/lit-host/e2e/tic-tac-toe.spec.ts` passed: click and keyboard moves, a win and a draw each appending one result message, New game, stale and duplicate refusals, recovery, the bounded wait, an O move made through the server and picked up by the board, and the move list. A fixture-played O move is not evidence of an AI opponent in a real host. 171 documentation checks, 110 packed-example and starter checks and the repository typecheck passed. A cold read by a reader with no repository context placed the main path at about 11 minutes (about 2,000 words of prose, with code skimmed) and about 16 minutes with the host and design sections. The reader could say what saga handles, which files to change, how a click and the assistant's turn share one game, and the commands for a new app. Its confusions led to three wording fixes in the guide and the setup guide, and the guide now also says that the wait's pace and limit are provisional defaults. The setup guide, both tracks, the README and the generated recipes agree on commands, links, package claims and the Simple Agentic Apps naming, and the private brand guidance inspected for this record agrees with them. This records local, installed qualification only: no package was published and no host was run.
- Acceptance: the starter's generated packed output, HTTP identity cases and Chromium lifecycle are qualified; the review records 325 focused checks and 36 browser cases across all six starters, with 141 affected checks for the final documentation repair. The rendered-opening editorial checkpoint is satisfied; the integrated clean-directory walkthrough is recorded in the entry above, and human programme acceptance remains outstanding. The integrated record and guide clarifications landed at `MachineWisdomAI/saga-a2ui@776678c134c6188eae65e0dff2fb082def057959` ([PR #337](https://github.com/MachineWisdomAI/saga-a2ui/pull/337)). [Independent writing and technical review](https://github.com/MachineWisdomAI/saga-a2ui/pull/337#pullrequestreview-5699626971) approved head `7951796e9437739396d7492d646b74cf0427c400`; [documentation CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40893384416) passed, with application CI correctly skipped for this documentation-only change. That review independently repeated the full source build and candidate pack, a fresh CLI export and matched five-tarball installation, generated-app typecheck/build/start and HTTP public-view/protected-401 checks. It also observed 171 documentation checks and three representative Chromium cases (keyboard board, win message and guided move list), reusing the unchanged full game qualification. Claude, ChatGPT and Alexa+ behavior is unverified; the wait cadence and limit remain open for host runs to settle. This source delivery does not publish packages or establish host support.
- This approved design partially amends [application setup](application_setup.blueprint.md) in two places: a qualified React/Hono starter pair, and the split of the setup guide into a short common guide plus two build tracks. The approved application-setup contract stays in force for everything else, including the five Lit pairs, the demo, the CLI's safety behaviour and the generated existing-backend recipes.
- It also approves making `view` optional on [reusable MCP connector](reusable_mcp_connector.blueprint.md) operation declarations, keeping every execution guarantee ([operations without a view](#operations-without-a-view)).

- On 2026-10-29, the owner approved replacing the tutorial's checkout-based walkthrough with a progressive npm/Vite app, complete files, and Claude or ChatGPT from the first card. The approved scope includes exact RC versions under `next`, a local unauthenticated server through a Quick Tunnel, a prerequisite glossary, and a separate explanation of alternative architectures. Host confirmations are allowed; manual turn prompts and board refreshes are not. This amendment also replaces the one-minute wait limit with continued reads while the assistant has the turn. The owner approved these requirements before delegating the final writing and autonomous delivery; the coordinator recorded them in [`c093f9cd62a37819dfe0a5be0e221f8f6f60e171`](https://github.com/MachineWisdomAI/saga-a2ui/blob/c093f9cd62a37819dfe0a5be0e221f8f6f60e171/blueprints/features/getting_started_tracks.blueprint.md). This is an attestation of the approved scope, not a claim that the owner inspected that later commit. The earlier design-to-code records remain historical. The implementation and public installation are recorded below.

- Tutorial amendment `c093f9cd62a37819dfe0a5be0e221f8f6f60e171` implemented at `MachineWisdomAI/saga-a2ui@c7044a77acae1acc189a2b1a2824d2734c683b64` ([PR #341](https://github.com/MachineWisdomAI/saga-a2ui/pull/341)). [Independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/341#pullrequestreview-5703782702) approved head `19c5fa1ddd62db2e286f2af9ebba9eeddb2ce8dd`; [documentation and application CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40939124084) passed. Qualification covers 134 documentation checks, nine packed-game/tutorial cases, six controller cases, repository and example typechecks, and all 23 game browser cases. The complete-file chapters build the first card, game and move-list extension without filling gaps from repository source. Delayed confirmation no longer ends the board's wait; consecutive connection failures still do.

- Host acceptance on 2026-10-29: through a Cloudflare Quick Tunnel, both Claude and ChatGPT rendered the first card and completed nine-move draws on their original boards, with move history. Claude required Send confirmations for generated messages; ChatGPT sent them automatically. Neither required typed turn prompts or board refreshes. A delayed Claude confirmation exceeded the old one-minute limit and still resumed automatically. Both hosts required one initial display retry, so this establishes recovered rendering, not first-load reliability. The final numbering correction was checked in Claude; it and the connection-error wording do not change the demonstrated successful turn path. The temporary connections were removed and the local server and tunnel stopped. Alexa+ was not tested for this tutorial.

- Public installation on 2026-10-29: all seven RC packages from SDK source `228be11269826ddc84efd623d1543e9803807706` are published under `next`: React stack `0.8.1-rc.1`, six siblings `0.8.0-rc.1`. [PR #340's publication receipt](https://github.com/MachineWisdomAI/saga-a2ui/pull/340) records anonymous registry integrity matching the tested tarballs and strict anonymous lower-level, React-stack, Lit-stack and server-only installation/typechecking. No `latest` tag changed. An independent reader used only the guide and its references, a fresh app directory, and public npm on Node 24.22.1 / npm 11.19.1. Strict installation and all three milestones' typecheck, build, server startup and HTTP tool/resource checks passed without app changes; the game and extension each completed an O win over HTTP. All 20 final files match the guide's code fences. That reader did not test a host; the host observations are recorded separately above. The install still reports 10 inherited audit findings (nine high, one critical), as the guide warns. This completes the delegated tutorial checks; it does not claim personal playtesting or programme acceptance by the owner.


- On 2026-10-29, the owner corrected the tutorial's teaching approach: manually copying project configuration and HTTP plumbing is not a learning milestone. The owner authorized the bounded SDK/starter repair and tutorial rewrite while excluding repository reorganization and general CLI distribution work. The approved approach uses Vite's published React/TypeScript generator and a reusable local MCP listener, then explains the application's operations, React components, bindings and turns. Complete code remains available for reference; it must not replace explanation. The coordinator attests to that instruction, recorded at [`b547c315c1e36712a493317e7ff86cd3437f3a5f`](https://github.com/MachineWisdomAI/saga-a2ui/blob/b547c315c1e36712a493317e7ff86cd3437f3a5f/blueprints/features/getting_started_tracks.blueprint.md), and retains responsibility for final writing, review, release and qualification. This is an attestation of the approved scope, not a claim that the owner inspected that later commit. Implementation and acceptance are recorded below.

- The approved generated-setup amendment's SDK scope is implemented at `MachineWisdomAI/saga-a2ui@01dea30bdfc2fcdf06f88695d61f3242543c4159` ([PR #343](https://github.com/MachineWisdomAI/saga-a2ui/pull/343)). [Independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/343#pullrequestreview-5705138590) approved head `016d69c65ec449ce9acff02077b7131abae22ab3`; [full CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40956647615) passed, including candidate qualification and update/rollback rehearsal. `startLocalMcpServer` is available through the MCP package and both stacks' `/server/node` entry. The coordinator verified that all seven merged-source `0.9.0-rc.1` tarballs match the reviewed bytes and pass strict lower-level, React-stack-only, Lit-stack-only and server-only installation/typechecking, including the new entry. All seven packages are published under `next`; anonymous public registry integrity matches the qualified tarballs, and strict anonymous lower-level, React-stack-only, Lit-stack-only and server-only installations/typechecks pass. `latest` tags are unchanged.

- Generated-setup amendment `b547c315c1e36712a493317e7ff86cd3437f3a5f` implemented for the tutorial and example at `MachineWisdomAI/saga-a2ui@9ebad1bf818f0f24549ba94f1ec4b9563746b034` ([PR #344](https://github.com/MachineWisdomAI/saga-a2ui/pull/344)). [Independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/344#pullrequestreview-5705521209) approved head `3c399f96f901a0c40a7921af74233a8954ab7e63`; [full CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40960731760) passed, including candidate qualification and update/rollback rehearsal. The guide starts with pinned Vite generation, teaches the app-specific code with edit-and-observe exercises, and keeps complete files as references. Qualification covers 135 documentation checks, 44 packed tutorial/game/rules checks, affected typechecks and 23 game Chromium cases.

- Revised-guide acceptance on 2026-10-29: an independent reader used only the guide and its references, a fresh Vite-generated directory and anonymous public npm on Node 24.22.1 / npm 11.19.1. All three milestones and both first-card exercises passed typecheck, build, startup and HTTP tool/resource checks without app fixes or a source checkout. All 22 final files match the guide; all 268 lockfile resolutions point to public npm. The documented 10 inherited audit findings remain. Using that reader's preserved outputs through a Cloudflare Quick Tunnel, Claude and ChatGPT each rendered the first card and completed one click-driven X→O cycle on the original board with both moves in the list. Claude required Send confirmation; neither host required a typed turn prompt or board refresh. ChatGPT's first card and both game cards needed an initial display retry. Earlier Claude attempts also included response regeneration and reconnection; the final run used the unchanged build and normal startup and recovered with the card's Retry button. This qualifies recovered rendering, not first-load reliability. The temporary Claude connector was removed, the ChatGPT plugin uninstalled, and the server and tunnel stopped. Earlier full-game and delayed-confirmation observations above remain historical evidence for unchanged game behavior. This completes the delegated tutorial checks, not personal playtesting or programme acceptance by the owner. General CLI distribution and repository reorganization remain outside this amendment.

<!-- Maintain this section using ../README.md#lifecycle-and-revision-records. -->

## Problem and current behavior

A developer who looks at saga a2ui for ten minutes should come away knowing what they could build, and how. Today they meet package structure, protocol terms and contributor workflow before they see an app.

| What they read | What they meet first |
| --- | --- |
| The [setup guide](../../docs/getting-started.md) | Published packages, candidate tarballs, HTTP defaults and evidence boundaries, all before a running app |
| The [action guide](../../docs/actions.md) | The notes application, which is thorough but long |

React has a published stack and a [complete application example](../../docs/react-consumers.md#follow-a-complete-react-application), but no starter. The CLI's [supported-pair table](../../scripts/saga.ts) offers only `lit-mcp`, and its tests assert that `react-mcp` is refused.

Nothing shows an assistant taking part in an app. Every current example is driven either by a view control or by a single tool call.

The brand expansion is changing from "Safe Agentic Apps" to "Simple Agentic Apps". The framework is still **saga a2ui**, and **saga** once context is clear. An app built with it is still a **Saga**.

## Proposed behavior

```diff
 docs/getting-started.md      install, init, run, attach, troubleshoot
-                              + Lit composition, actions, React caveats, evidence
+docs/build-notes-with-lit.md         the Lit composition material, leading into actions.md
+docs/build-tic-tac-toe-with-react.md a progressive npm/Vite tutorial played in Claude or ChatGPT
```

The reader creates a new app directory and installs the pinned packages from npm. The guide supplies complete files for three milestones: a welcome card, a playable game, and a move list. The first card opens in Claude or ChatGPT through a local server and a Cloudflare Quick Tunnel. No SDK checkout is needed.

The qualified React/Hono source starter remains available through `saga init`; the tutorial does not depend on the source CLI.

**One game, from the guide.**

1. The person asks the assistant for a game of tic-tac-toe. The assistant calls `new_game`, and the host shows the board.
2. The person clicks a square. The board calls `play_move` for X. The server checks the move and stores it, and the board shows it and marks the assistant's turn.
3. If the game is still in progress, the board shares the game ID, board and move instructions as hidden `context` through [view conversation](view_conversation.blueprint.md). After that succeeds, it prepares **Your turn**. In Claude, the person clicks **Send** in the chat box; ChatGPT sends it automatically. The card explains what to do when a message waits in the chat box.
   - The visible message contains no identifier or instructions. **Show game ID** reveals the identifier on the card when the person needs it.
   - If the host cannot accept the context, the board reports the failure and sends no turn message.
   - The assistant calls `play_move` for O in the game identified by that context. It can read `get_game` when it needs the current state.
4. The board was already waiting for the assistant's move. It reads the game with `get_game`, shows O's square and gives the turn back to the person.
5. If X's move ends the game, the board instead appends the result as the person, such as "I won our tic-tac-toe game." or "Our tic-tac-toe game ended in a draw.", and starts no wait. **New game** appends a prepared request for the assistant to call `new_game` and open a fresh card, subject to the host's confirmation. Each card retains its own game identity; the old game cannot replace the new one.

When a host remounts a card with a saved tool result, the view reads that game's current state before offering squares. A lost move reply also triggers a read. If the returned history confirms X's clicked square at the expected move number and the game has not advanced beyond it, the board sends the missing turn or result message without replaying the move. Unconfirmed message delivery is reported and is not retried automatically.

![The person's click and the assistant's tool call reach the same play_move operation; the board learns each move through its own server calls and hands the turn over by appending a message.](../../diagrams/tic-tac-toe-turn-loop.svg)

[Editable Mermaid](../../diagrams/tic-tac-toe-turn-loop.mmd) · [PNG](../../diagrams/tic-tac-toe-turn-loop.png)

Both players' moves go through the same server operation. They reach the board differently, because the host routes a result by who called:

- **The person's move.** The view makes the call, so the result comes back to the calling action's success hook.
- **The assistant's move.** The model makes the call. A host delivers a model call's result to a card it mounts for that call, and MCP Apps sends one tool input and result per mounted view, so the board that is already open is not guaranteed to receive it. The board therefore reads the game itself while it waits.

`play_move` opens no card of its own, so the assistant's move does not add a second board to the conversation.

## Responsibilities and interfaces

### React/Hono starter (`templates/react-hono`)

**Same as `templates/lit-hono`.** The template keeps the clean-starter contract: public status, a protected account operation whose verifier refuses every credential, the bound "Clear the note" local action and no fixtures.

- **Server.** Its `server/` is the `lit-hono` text, with the same Hono 4.13.13, `@hono/node-server` 2.1.5 and `@modelcontextprotocol/hono` 2.0.2 pins.
  - The one exception is the view-artifact check in `operations.ts`, which looks for `<starter-app` today. It becomes a marker each template declares.
  - The Hono qualification's byte-identity rules extend to the React copy, so a server fix lands in both templates.
- **View.** `src/` is the same application written against `@saga-a2ui/react-mcp-stack`, as `.tsx`. It uses the `react-jsx` setting and `react`/`react-dom` 19.3.1. Its `template.json` names `react-mcp`, `hono` and the five React-side SDK packages.
- **CLI.** One `SUPPORTED_PAIRS` row exposes it, after its qualification passes. `saga demo` stays Lit/Node-only.

**Qualification and checks that assume Lit change to read the template's stack:**

- the starter qualification's stack-import and page-marker checks;
- the browser spec's teardown selector;
- the snippet extractor, which reads `.ts` only today, and the recipe fence language;
- the packed set in the offered-pair test;
- the boundary scan's required-template list;
- the stack-import units;
- the tests and guides that state "no React starter".

The generated existing-backend guide gains a React/Hono recipe by regeneration. The version policy counts `templates/react-*/**` as product, as it already does for Lit templates.

### Setup guide and two tracks

| Document | Keeps or gains | Owner and check |
| --- | --- | --- |
| `docs/getting-started.md` | What every app needs, whatever its renderer: prerequisites, published and candidate installs, `saga init` with the offered pairs, HTTP defaults, attaching to an existing backend, troubleshooting, and a choice of the two tracks | GUIDE1; `scripts/guide.test.ts` keeps checking its commands, packages and links |
| `docs/build-notes-with-lit.md` | The current Lit composition and actions overview, moved, not rewritten. It leads into [the action guide](../../docs/actions.md). | The moved assertions move with it |
| `docs/build-tic-tac-toe-with-react.md` | The guide below | A sibling document test checks its commands, quoted source and links against the example |

The README's first steps point to the two tracks. The repository-wide documentation cleanup is separate work. Where both touch the same file, they coordinate, and neither waits for the other.

**The tic-tac-toe guide.** A reader builds and plays the app in their own directory. A prerequisite glossary gives each tool or library a one-sentence explanation and an official learning link. npm installs exact published versions, and Vite builds the React view and Node server. Each milestone provides complete files and commands with a named working directory.

The reader connects either Claude or ChatGPT at the first milestone, then adds the game and plays through a result. The guide explains the architecture they are using: the server owns the game, both players call the same move operation, and the board reads the game while waiting for O. A final change adds the move list. Host setup and confirmation instructions are checked in both products. A host's initial display retry is reported separately from turn behavior.

[Alternative architectures](../../docs/tic-tac-toe-architecture-options.md) explains a separate backend, another renderer, a native A2UI host, A2A delivery, and hosted storage. Each distinguishes available parts from missing adapters or proposed work. The main tutorial stays with the implemented React game. The README and common setup guide point to the React and Lit tracks.

### Tic-tac-toe example (`examples/tic-tac-toe`)

The example keeps the React/Hono starter's structure and imports SAGA through the React MCP stack only. The game is an example, not an adversarial service:

- Voice-first hosts need the assistant to place X when the person says their move, so `play_move` is callable by the model for either player.
- The server still enforces the rules for both players.

**State.** `GameStore` holds each game as `{board, turn, moveNumber, status, winner, line, history, expiresAt}`.
- It is keyed by an unguessable random `gameId`, bounded in count, with entries expiring after a short time.
- There is no database, sign-in or external service.
- The store is an interface, so a deployment can replace the in-memory map.

**Rules.** A pure module owns the rules, with deterministic tests: empty board, alternating turns, X first, eight winning lines, draw on a full board, and no move after the game ends.

**Operations.**

| Name | Called by | Opens a card | Input | Returns |
| --- | --- | --- | --- | --- |
| `new_game` | Assistant | Yes | — | A new game |
| `show_game` | Assistant | Yes | `gameId` | Opens or reopens a card with the current game |
| `get_game` | Assistant or board | No | `gameId` | The current game |
| `play_move` | Assistant or board | No | `gameId`, `square` 0–8, `player` X or O, `expectedMoveNumber` | The game after the move |

All four are saga operations declared through `registerPublicOperation`. `get_game` and `play_move` simply omit `view` (see [operations without a view](#operations-without-a-view)):

```diff
 play_move:  input, output, handle, project, failures
-            view: boardView
 get_game:   input, output, handle, project, failures
-            view: boardView
 show_game:  input, output, handle, project, failures, view: boardView
```

The assistant needs a server read that opens no card. A host delivers a model call's result to a card mounted for that call, so reading through `show_game` would add a board to the conversation on every turn. Neither the app nor its server can push a result to the model: `AppBridge.sendToolResult` is the host's own notification to its view.

Every result carries the whole game as structured content, plus a short text for the model. `play_move`'s description tells the model four things:
- it plays O;
- it may place X only when the person states their move in conversation;
- if the board is not in its context, it reads it with `get_game`;
- where a card cannot call the server, it calls `show_game` to display the board.

**Board view.**
- **Layout.** One status line, three rows of three square buttons and a New game button, declared with `defineSurface`.
- **Squares.**
  - They are native buttons, so they work from the keyboard.
  - Names such as "Row 1, column 2, empty".
  - Each is enabled only when it is empty, the game is in play and it is X's turn.
- **Displaying a game.** One `present(game)` validates every game the board receives. It ignores a game older than the one shown, and follows a newer game when one arrives.
- **The square action.** One server action is bound to every square:
  - its subject is the game and move number, so an old completion cannot reach a newer board;
  - it calls `play_move` for X;
  - on success it presents the game;
  - while the game is in progress, it shares the game as required hidden `context`, appends **Your turn**, and starts the wait;
  - when X's move ended the game, it appends the result message only;
  - it applies the append's result only while the board still shows the same game and move, because the action's `current()` ends with the hook ([view conversation](view_conversation.blueprint.md#proposed-behavior)).
- **The wait.**
  - The controller owns it. It reads `get_game` every 1.5 seconds for the first 40 reads, then every 5 seconds while O has the turn.
  - It ends on the assistant's move, game expiry or teardown. A new card owns a separate wait. Forty consecutive failed reads stop the wait and offer "Check for the assistant's move". A successful read resets that failure count. A delayed host confirmation alone does not stop the wait.
  - MCP Apps gives a server no way to push to an open view, so this is the mechanism available.
- **`onToolResult`.** It selects the game from the result and reads its current state before offering squares, including when the host replays an old result on remount.
- **The guided change** adds a move list bound to the game's `history`. It changes the layout and catalog only.

### Operations without a view

An operation's execution guarantees should not depend on whether it presents a card. `@saga-a2ui/mcp/server` already keeps the two apart:

- **`execute()`** owns the request and operation time limits, cancellation, output validation and failure projection.
- **`register()`** declares the tool with its input and output contracts and annotations, so the MCP server validates input before the handler runs. It also attaches the view, which is the only view-specific step.

So `view` becomes optional on operation declarations:

```text
saga operation
  validate input
  execute within request and operation limits
  validate and project the result
  return success or a declared failure
    with view    → attach the UI resource
    without view → return data and text
```

Three requirements govern it:

1. **Identical execution guarantees.** Omitting `view` preserves input validation, budgets, cancellation handling and safe failures exactly. The tool is declared with the same input and output contracts and annotations, the same `execute()` path runs, and a protected operation still requires its identity resolver and sign-in failure text.
2. **No UI association.** A viewless operation registers no view resource. It attaches no UI-resource metadata to its tool definition, or to any result, whether successful or failed.
3. **One consumer interface.** The tutorial declares all four operations through saga. Any underlying plain MCP tool registration stays inside `@saga-a2ui/mcp`, and the example imports no MCP Apps server API.

The change lands in step 2's SDK release. It amends the operation declaration described by the [reusable MCP connector](reusable_mcp_connector.blueprint.md), whose other guarantees are unchanged.

## Failure and recovery

| Trigger | Observable result and recovery |
| --- | --- |
| The square is occupied, it is not that player's turn, or the game has ended | `play_move` refuses with no effect and returns the current game. The board shows it and says why. |
| A stale card or a repeated request sends an old `expectedMoveNumber` | Refused with no effect. The card shows the current game, so no extra move is applied and a newer game is untouched. |
| The `gameId` is unknown or expired | Refused. The card offers New game. |
| The host cannot take an appended message, refuses it, or does not confirm it | The status distinguishes unavailable messaging, refusal and an unconfirmed response, and offers the game identifier through **Show game ID**. The wait still runs. An uncertain message is not resent automatically. |
| The host cannot take the context | The card reports that it could not share the game. It does not send an ambiguous turn message; the wait can still observe a later server move. |
| X's move wins or fills the board | The board appends the result message, asks for no move and starts no wait. |
| An append settles after a newer move | Its result is ignored. An append on an old card cannot change a different card's game. |
| Forty consecutive game reads fail | The board reports the connection failure and offers "Check for the assistant's move". It never repeats a move on the assistant's behalf. |
| A move call fails or times out | The card reads the game without replaying the move. If the read confirms the clicked move, it sends its missing handoff. If the read fails, the squares remain disabled. |
| The host remounts a card with an old result | The card reads that game's current state before enabling squares. New game opens a separate card, so each saved result identifies its own game. |
| The host shows the assistant's move in a new card | Both cards read the same game. An older card refuses its stale moves and catches up. |
| `react-mcp` on another server is requested | `saga init` refuses and lists the supported pairs, as today. |

## Verification outcomes

**Starter.**
- The real CLI generates `react-mcp`/`hono` into a new directory outside the workspace.
- Packed SDK packages and exact peers install there with no source alias.
- The output typechecks, builds and starts.
- Over HTTP MCP, the public, protected, missing-credential and concurrent-identity cases pass as for the Lit pairs.
- In Chromium, the operation's result reaches the React view, Clear the note works without a server call, and teardown leaves the container empty.
- Destination refusal, interruption and no-implicit-install still hold, and the five Lit pairs are unchanged.

**Operations without a view.** The same declaration is registered with and without `view`, and the two are compared:
- Invalid input, refusal, an absent record, an over-budget handler, cancellation, an asynchronous or malformed projection and invalid output give the same failures from both.
- The viewless tool's definition and every one of its results carry no `_meta.ui`, and the server lists no resource for it.
- A protected declaration without `view` still refuses a missing identity.
- The example's server and view import no `@modelcontextprotocol/ext-apps` module, and the boundary scan passes.

**Rules.** Deterministic tests cover wins on every line, the draw, turn order, and refusal of occupied, out-of-turn and post-game moves without changing the stored game.

**Game view.** In Chromium, on the local MCP Apps host fixture:
- clicking and keyboard moves;
- an in-progress move records the context update, with the game in `structuredContent`, and then **Your turn**, with no identifier, board or instructions in the visible message;
- with the context capability withheld, the card reports failure and sends no turn message;
- a winning X move and a drawing X move each record exactly one result message, no context, and start no wait;
- New game prepares one request for a fresh card, even if clicked twice while confirmation is pending;
- an O move made through the fixture and picked up by the wait;
- stale and duplicate refusals;
- Send guidance is visible, and **Show game ID** reveals only the current card’s identifier without a server call;
- distinct feedback for unavailable messaging, refusal and unconfirmed delivery;
- restoration from a saved empty result, and no playable squares after a failed restoration read;
- one missing handoff after a confirmed move's reply is lost, and no handoff when the move never reached the server;
- a host confirmation delayed for several minutes, followed by O appearing in the existing board;
- recovery after consecutive failed reads, and cancellation when the view retires.

No test asserts which square an assistant chooses.

**Guide.**
- Document tests assemble every milestone from its complete files in a fresh directory, typecheck and build it, compare the final source with the maintained example, and check local links.
- A cold reader follows it from a clean directory to a played game and the move list.
- They can then explain how a click and an assistant turn use the same game, name the code they would change, and name their next step.

**Hosts.** Both Claude and ChatGPT must render the first card, complete a game, and show the move list through a Cloudflare Quick Tunnel. X clicks generate the handoff; any host confirmation may be accepted, but the tester does not type turn prompts or refresh the board. The existing board must show O and the final result. Initial display retries are recorded explicitly. Alexa+ is outside this tutorial's acceptance scope.

**Public installation.** Publish the tested seven-package RC under `next`, verify registry integrity against the qualified tarballs, and install the pinned versions in a fresh app. A separate cold reader follows only the guide and its references, using public npm and no SDK checkout. Local tarball qualification alone does not satisfy this check.

## Generated setup and the local listener

The tutorial starts with the standard Vite React/TypeScript generator. It explains the changes that make a Vite app run in an MCP host; it does not ask readers to recreate generated project configuration. Each lesson traces one meaningful application change and gives the reader an observable result in Claude or ChatGPT. The first card teaches a server result, a React component and the binding between them before the guide adds the game.

The SDK supplies `startLocalMcpServer` through the MCP package and both stacks' `/server/node` entries. Its caller selects a port and supplies `createServer(lifetime)`, which builds a fresh MCP server for one request. Application state and rendered view bytes remain with the caller. The returned listener exposes its URL and an idempotent `close()`; process signals remain application-owned.

This optional listener preserves the tutorial's existing transport behavior: loopback binding at `/mcp`, local Host and Origin validation, a 1 MiB body limit, one request deadline covering body reading and response delivery, operation budgets, and cancellation on shutdown. It provides no authentication. Existing backends and maintained starter pairs retain their own hosting contracts. The node entry stays outside browser and renderer module graphs.

This repair does not create a SAGA CLI package, move repositories or examples, retire the local host fixture, or change publication tooling. The new package version must be published and installed from the registry before the revised guide relies on it. Source tests qualify the listener's behavior; a fresh generated app qualifies the reader's commands.

## Implementation sequence

1. **React/Hono starter.** The template, qualification, CLI row and setup-guide corrections.
2. **View conversation and operations without a view.** One SDK release: `appendMessage` as its own design specifies, and an optional `view` on operation declarations as described above.
3. **Tic-tac-toe example.** The game, its browser checks, and the guide's opening through the first click with a screenshot. The owner reviews this sample before the rest of the guide is written.
4. **The guide.** The rest of the tic-tac-toe guide, the setup-guide split, the Lit notes track and the README's first steps.
5. **The expansion change.** The current brand surfaces change to "Simple Agentic Apps", keeping lowercase framework naming, capitalised Saga for an app, and the existing artwork. Historical records keep their wording.

Steps 1 and 2 are independent. Step 3 needs both.

## Open decisions

The tutorial's wait behavior is specified above. Host qualification must show that a delayed confirmation still allows O to appear without a refresh.

How `play_move` opens no card is settled: an optional `view` on saga operations, under the three requirements in [operations without a view](#operations-without-a-view).

## References

- [Application setup](application_setup.blueprint.md), [view conversation](view_conversation.blueprint.md), [view composition](view_composition.blueprint.md), [action binding](../modules/action_binding.blueprint.md).
- [Setup guide](../../docs/getting-started.md), [action guide](../../docs/actions.md), [React integration](../../docs/react-consumers.md), [host compatibility](../../docs/host-compatibility.md), [templates](../../templates/README.md).
- MCP Apps (`@modelcontextprotocol/ext-apps` 2.0.3): `AppBridge.sendToolInput`, which is sent once per mounted view, and `App.callServerTool`.
