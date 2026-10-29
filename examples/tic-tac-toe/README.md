# Tic-tac-toe

A game of tic-tac-toe between a person and an AI assistant, inside the chat. The person clicks squares on a board shown by the host; the assistant plays O by calling the same server operation. It was generated with `saga init --a2ui-stack react-mcp --server hono` and keeps the template's structure: [`templates/react-hono`](../../templates/react-hono). The guide [Build tic-tac-toe with React](../../docs/build-tic-tac-toe-with-react.md) walks through it.

This is an example, not a starter and not a service. It has no sign-in and no database: games live in memory, expire after a short time, and are named by an unguessable identifier that anyone who holds it may play.

## Run it

From the repository root (Node 22.23.3 or newer):

```sh
npm ci
npm run build:tic-tac-toe
node apps/lit-host/dist/tic-tac-toe/server.mjs
```

`build:tic-tac-toe` ([`scripts/build-tic-tac-toe.ts`](../../scripts/build-tic-tac-toe.ts)) packs the SDK packages, installs them into a clean copy of this directory and builds it with the example's own `npm run build` configuration, so the build uses no source alias. It also builds `apps/lit-host/dist/tic-tac-toe-guided` with the guided change applied. Neither is a published artifact. A host connects to the printed endpoint; no host has been run against this game.

## What is where

| File | Holds |
| --- | --- |
| `server/rules.ts` | The rules, as pure functions: X first, alternating turns, the eight lines, the draw, no move after the end. |
| `server/game-store.ts` | `GameStore`, and a bounded in-memory map of short-lived games. A move is checked against the game and applied in one step. |
| `server/operations.ts` | The four operations, declared with `registerPublicOperation`: `new_game` and `show_game` open the board; `get_game` and `play_move` have no view. |
| `server/listener.ts`, `server/main.ts`, `server/endpoint.ts` | HTTP hosting, from the template. The game has no identity, so the template's sign-in files are removed. |
| `src/contract.ts` | The wire contract the server and the board share. |
| `src/surface.ts`, `src/catalog.tsx` | The board's layout and the components it may use. |
| `src/controller.ts` | Which game the board shows (`present`), the status line, and the bounded wait for the assistant's move. |
| `src/actions.ts`, `src/view.tsx` | The square action and the other two, and where each is attached. |
| `guided-change/move-list.patch` | The guide's change: a move list bound to the game's `history`. It touches only `src/surface.ts` and `src/catalog.tsx`. |

## Tests

- `scripts/tic-tac-toe-rules.test.ts`: the rules and the store (every line, the draw, turn order, refusals that leave a game unchanged, one of two requests with the same move number).
- `scripts/tic-tac-toe.test.ts`: the example keeps the template, imports no MCP Apps module, builds from the packed packages, starts, and takes the guided change.
- `apps/lit-host/e2e/tic-tac-toe.spec.ts`: the board in Chromium on the local MCP Apps host fixture. No test asserts which square an assistant chooses.
- `scripts/tic-tac-toe-document.test.ts`: the guide's commands, quoted source, sentences and links against this example.
