---
feature_name: getting_started_tracks
status: approved
module_blueprints: [action_binding]
dependencies: [application_setup, view_conversation, view_composition, reusable_mcp_connector]
date_added: 2026-10-27
---

# Getting started: a React starter and a tic-tac-toe guide

## Status

- Design: approved by the owner on 2026-10-28 at [`6c3638b3f372c27d12b406a0c4800ea01f93cf24`](https://github.com/MachineWisdomAI/saga-a2ui/blob/6c3638b3f372c27d12b406a0c4800ea01f93cf24/blueprints/features/getting_started_tracks.blueprint.md), including the reviewed diagram ([Mermaid](https://github.com/MachineWisdomAI/saga-a2ui/blob/6c3638b3f372c27d12b406a0c4800ea01f93cf24/diagrams/tic-tac-toe-turn-loop.mmd), [SVG](https://github.com/MachineWisdomAI/saga-a2ui/blob/6c3638b3f372c27d12b406a0c4800ea01f93cf24/diagrams/tic-tac-toe-turn-loop.svg), [PNG](https://github.com/MachineWisdomAI/saga-a2ui/blob/6c3638b3f372c27d12b406a0c4800ea01f93cf24/diagrams/tic-tac-toe-turn-loop.png)).
- Implementation: partial. Blueprint `6c3638b3f372c27d12b406a0c4800ea01f93cf24` implemented for the React/Hono starter scope at `MachineWisdomAI/saga-a2ui@0ad4acba45ea179031bf9d0071946b3d648b9297` ([PR #325](https://github.com/MachineWisdomAI/saga-a2ui/pull/325)). The maintained `templates/react-hono`, qualified CLI pair, stack-aware qualification and generated recipes are landed. [Independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/325#pullrequestreview-5691176422) covered final head `7085eebe5329e8a2f23604697e98a3ce7eb529e3`; [application qualification CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40789828879) passed.
- The same Blueprint's conversation and viewless-operation scope is implemented at `MachineWisdomAI/saga-a2ui@c6cecdfb502f43360010b720d2a63b87c45b6466` ([PR #326](https://github.com/MachineWisdomAI/saga-a2ui/pull/326)). [Independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/326#pullrequestreview-5696385580) approved integrated head `6df6a44b08d28b3131abaf0c6179049fc9a1d6b7`; [application qualification CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40859198727) passed. Viewless operations preserve schema validation, bounded execution, projection and protected identity. [View conversation Status](view_conversation.blueprint.md#status) records its local qualification and host limits. The game, guide tracks and brand work remain outstanding.
- Acceptance: the starter's generated packed output, HTTP identity cases and Chromium lifecycle are qualified; the review records 325 focused checks and 36 browser cases across all six starters, with 141 affected checks for the final documentation repair. The rendered-opening owner review and integrated walkthrough remain outstanding. Claude, ChatGPT and Alexa+ behavior is unverified; the wait cadence and limit remain open for host runs to settle. This source delivery does not publish packages or establish host support.
- This approved design partially amends [application setup](application_setup.blueprint.md) in two places: a qualified React/Hono starter pair, and the split of the setup guide into a short common guide plus two build tracks. The approved application-setup contract stays in force for everything else, including the five Lit pairs, the demo, the CLI's safety behaviour and the generated existing-backend recipes.
- It also approves making `view` optional on [reusable MCP connector](reusable_mcp_connector.blueprint.md) operation declarations, keeping every execution guarantee ([operations without a view](#operations-without-a-view)).

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
+docs/build-tic-tac-toe-with-react.md a ten-minute guide that opens with the finished game
```

The new path for a React developer:

```sh
npx tsx scripts/saga.ts init --a2ui-stack react-mcp --server hono ../my-saga
```

The command creates a clean React starter on Hono from `templates/react-hono`. It installs nothing and runs nothing. The tic-tac-toe guide starts from that output.

**One game, from the guide.**

1. The person asks the assistant for a game of tic-tac-toe. The assistant calls `new_game`, and the host shows the board.
2. The person clicks a square. The board calls `play_move` for X. The server checks the move and stores it, and the board shows it and marks the assistant's turn.
3. If the game is still in progress, the board appends a short move message to the conversation, using [view conversation](view_conversation.blueprint.md). For example: "Your move in tic-tac-toe game `<gameId>`. The board is in your context; if it isn't, read it with get_game. Then play O with play_move."
   - The accepted game travels as the message's `context`, which the assistant receives and the conversation does not show.
   - The message names the game and never restates the board.
   - The assistant takes its turn. It reads `get_game` only if the context is missing, then calls `play_move` for O.
4. The board was already waiting for the assistant's move. It reads the game with `get_game`, shows O's square and gives the turn back to the person.
5. If X's move ends the game, the board instead appends the result as the person, such as "I won our tic-tac-toe game." or "Our tic-tac-toe game ended in a draw.", and starts no wait. New game starts a separate game, and nothing from the old game can change it.

![The person's click and the assistant's tool call reach the same play_move operation; the board learns each move through its own server calls and hands the turn over by appending a message.](../../diagrams/tic-tac-toe-turn-loop.svg)

[Editable Mermaid](../../diagrams/tic-tac-toe-turn-loop.mmd) · [PNG](../../diagrams/tic-tac-toe-turn-loop.png)

Both players' moves go through the same server operation. They reach the board differently, because the host routes a result by who called:

- **The person's move.** The view makes the call, so the result comes back to the calling action's success hook.
- **The assistant's move.** The model makes the call. A host delivers a model call's result to a card it mounts for that call, and MCP Apps sends one tool input and result per mounted view, so the board that is already open is not guaranteed to receive it. The board therefore reads the game itself while it waits.

`play_move` opens no card of its own, so the assistant's move does not add a second board to the conversation.

## Responsibilities and interfaces

### React/Hono starter (`templates/react-hono`)

**Same as `templates/lit-hono`.** The template keeps the clean-starter contract: public status, a protected account operation whose verifier refuses every credential, the bound "Clear the note" local action and no fixtures.

- **Server.** Its `server/` is the `lit-hono` text, with the same Hono 4.13.13, `@hono/node-server` 1.19.17 and `@modelcontextprotocol/hono` 2.0.2 pins.
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

**The tic-tac-toe guide.** It is written for someone building a weekend project or a small product, and readable in about ten minutes. This is a reading goal, not a promise about install or host setup times. In order, it shows:

1. the finished game in an assistant;
2. the shortest way to start it;
3. the layout and the operations;
4. one guided change;
5. connecting it to Claude, ChatGPT and Alexa+.

Optional setup detail sits behind links. New terms are explained where they first appear.

Its last section shows what the separation of A2UI, rendering and delivery allows, without a protocol course. It labels each arrangement as one of three kinds:

| Kind | What it means |
| --- | --- |
| Runnable | The guide's own app runs this way. |
| Straightforward composition | Built from existing packages. |
| Architectural sketch | Needs adapters that do not exist yet. |

The arrangements it covers:

- the same rules and state behind an MCP gateway on one server and an app API on another;
- one A2UI layout rendered by React or Lit in the client;
- a native A2UI host that needs no MCP;
- A2A as a delivery, including `appendMessage` mapped to A2A `message/send`, with its `context` as a data part on that message;
- `GameStore` backed by Workers KV or a Durable Object when moving off a single Node process.

### Tic-tac-toe example (`examples/tic-tac-toe`)

The example is generated with the React/Hono `saga init` and keeps the template's structure. The game is an example, not an adversarial service:

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
  - while the game is in progress, it appends the move message with the game as best-effort `context`, and starts the wait;
  - when X's move ended the game, it appends the result message only;
  - it applies the append's result only while the board still shows the same game and move, because the action's `current()` ends with the hook ([view conversation](view_conversation.blueprint.md#proposed-behavior)).
- **The wait.**
  - The controller owns it. It is a bounded series of `get_game` calls, about every second and a half for up to a minute.
  - It ends on the assistant's move, a new game, teardown or its limit. At the limit, a "Check for the assistant's move" button replaces it.
  - MCP Apps gives a server no way to push to an open view, so this is the mechanism available.
- **`onToolResult`.** It presents the result that opened the card, and any later result a host does deliver to it.
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
| The host cannot take an appended message, or refuses it | The status reads "Tell the assistant it's their move". The wait still runs. |
| The host cannot take the context | The move message is still sent, because the game opts into best effort. The assistant reads `get_game` as the message tells it. |
| X's move wins or fills the board | The board appends the result message, asks for no move and starts no wait. |
| An append settles after New game or a newer move | Its result is ignored; nothing appears on the newer game. |
| The assistant does not move before the wait ends | "Check for the assistant's move" appears. Nothing is retried on the assistant's behalf. |
| A view call fails or times out | The move may or may not have been applied. The card reads the game again before offering the square. |
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
- an in-progress move records the context update, with the game in `structuredContent`, and then the move message, which names the game and contains no board;
- with the context capability withheld, the move message is still recorded;
- a winning X move and a drawing X move each record exactly one result message, no context, and start no wait;
- a failed append that settles after New game shows nothing on the new game;
- an O move made through the fixture and picked up by the wait;
- stale and duplicate refusals;
- a new game that an old request cannot change;
- the unsupported-message instruction;
- the wait's limit.

No test asserts which square an assistant chooses.

**Guide.**
- A document test checks every command, quoted source line and link.
- A cold reader follows it from a clean directory to a played game and the move list.
- They can then explain how a click and an assistant turn use the same game, name the code they would change, and name their next step.

**Hosts.** Claude, ChatGPT and Alexa+ are not run for this design. The guide's host sections say what each host is expected to support, link the [host compatibility guide](../../docs/host-compatibility.md), and state that this game is unverified there until a host run records otherwise.

## Implementation sequence

1. **React/Hono starter.** The template, qualification, CLI row and setup-guide corrections.
2. **View conversation and operations without a view.** One SDK release: `appendMessage` as its own design specifies, and an optional `view` on operation declarations as described above.
3. **Tic-tac-toe example.** The game, its browser checks, and the guide's opening through the first click with a screenshot. The owner reviews this sample before the rest of the guide is written.
4. **The guide.** The rest of the tic-tac-toe guide, the setup-guide split, the Lit notes track and the README's first steps.
5. **The expansion change.** The current brand surfaces change to "Simple Agentic Apps", keeping lowercase framework naming, capitalised Saga for an app, and the existing artwork. Historical records keep their wording.

Steps 1 and 2 are independent. Step 3 needs both.

## Open decisions

1. **The wait's cadence and limit.** The values above are proposals. Host runs decide them.

How `play_move` opens no card is settled: an optional `view` on saga operations, under the three requirements in [operations without a view](#operations-without-a-view).

## References

- [Application setup](application_setup.blueprint.md), [view conversation](view_conversation.blueprint.md), [view composition](view_composition.blueprint.md), [action binding](../modules/action_binding.blueprint.md).
- [Setup guide](../../docs/getting-started.md), [action guide](../../docs/actions.md), [React integration](../../docs/react-consumers.md), [host compatibility](../../docs/host-compatibility.md), [templates](../../templates/README.md).
- MCP Apps (`@modelcontextprotocol/ext-apps` 2.0.3): `AppBridge.sendToolInput`, which is sent once per mounted view, and `App.callServerTool`.
