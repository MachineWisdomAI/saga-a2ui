---
feature_name: view_conversation
status: approved
module_blueprints: [action_binding]
dependencies: [view_composition, reusable_mcp_connector]
date_added: 2026-10-27
---

# A view adds a message to the conversation

## Status

- Design: approved by the owner on 2026-10-28 at [`6c3638b3f372c27d12b406a0c4800ea01f93cf24`](https://github.com/MachineWisdomAI/saga-a2ui/blob/6c3638b3f372c27d12b406a0c4800ea01f93cf24/blueprints/features/view_conversation.blueprint.md), including the reviewed diagram ([Mermaid](https://github.com/MachineWisdomAI/saga-a2ui/blob/6c3638b3f372c27d12b406a0c4800ea01f93cf24/diagrams/view-conversation.mmd), [SVG](https://github.com/MachineWisdomAI/saga-a2ui/blob/6c3638b3f372c27d12b406a0c4800ea01f93cf24/diagrams/view-conversation.svg), [PNG](https://github.com/MachineWisdomAI/saga-a2ui/blob/6c3638b3f372c27d12b406a0c4800ea01f93cf24/diagrams/view-conversation.png)).
- Implementation: Blueprint `6c3638b3f372c27d12b406a0c4800ea01f93cf24` implemented for the core conversation contract, MCP Apps adapter and both stack hosts at `MachineWisdomAI/saga-a2ui@c6cecdfb502f43360010b720d2a63b87c45b6466` ([PR #326](https://github.com/MachineWisdomAI/saga-a2ui/pull/326)). [Independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/326#pullrequestreview-5696385580) approved integrated head `6df6a44b08d28b3131abaf0c6179049fc9a1d6b7`; [application qualification CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/40859198727) passed.
- Acceptance: local qualification covers capability outcomes, optional context, abort settlement before a held host reply, late answers and view teardown. Independent checks include 262 affected tests on the integrated head; unchanged library evidence includes 242 focused checks, 28 Chromium cases through both stacks, affected typechecks and strict packed-consumer qualification. Claude, ChatGPT and Alexa+ runs remain outstanding. Source implementation does not establish real-host support, package publication or deployment.

<!-- Maintain this section using ../README.md#lifecycle-and-revision-records. -->

## Problem and current behavior

A rendered view can reach its application's server but cannot reach the conversation around it. Some apps need both. In a game played with the assistant, the person clicks a square and the server accepts the move, but the assistant does not learn that it is its turn.

Both stacks start a view with `startA2uiView`. Each gives the application's `actions` callback a `ViewHost`:

| Stack | `ViewHost` today |
| --- | --- |
| `@saga-a2ui/react-mcp-stack` | `server`: the server transport ([`start-a2ui-view.tsx`](../../packages/react-mcp-stack/src/start-a2ui-view.tsx)) |
| `@saga-a2ui/lit-mcp-stack` | `server`, and `links` for validated link opening ([`start-a2ui-view.ts`](../../packages/lit-mcp-stack/src/start-a2ui-view.ts)) |

Neither kind of action can reach the conversation:

- **Local action.** It runs in the view and changes only view state.
- **Server action.** Its `call` reaches the application's server through `App.callServerTool`, which the host proxies.

The reply to a view-initiated call returns to the calling action. MCP Apps hosts do not add it to the conversation. The assistant also acts only when given a turn, so a view that changes shared state leaves the assistant unaware until the person types into the chat.

The MCP Apps bridge the stacks depend on (`@modelcontextprotocol/ext-apps` 2.0.3) already supports this. `App.sendMessage` sends `ui/message`, a message with role `"user"` that the host adds to the conversation, and the host advertises it through its `message` capability. `App.updateModelContext` sends `ui/update-model-context`: information that the host passes to the model with the next user message, advertised as `updateModelContext`. The stacks construct `App` privately, and the consumer boundary forbids applications from importing the bridge (`scripts/consumer-boundary.ts`). So an application has no supported way to add a message.

## Proposed behavior

```diff
 actions: (host) => {
   const play = Action.server<ActionButtonActivation, CallToolResult>('play-square', host.server)
     .input((event) => ({square: Number(event.read('index'))}))
     .run(({params, call}) => call('play_move', {...game.current(), ...params, player: 'X'}))
     .onSuccess(({result, current}) => {
       if (!current()) return;
       const game = board.present(result);
-      // The assistant does not know the person moved.
+      const shown = {gameId: game.gameId, moveNumber: game.moveNumber};
+      const handOver =
+        game.status === 'playing'
+          ? host.conversation.appendMessage(TEXT.yourMove(game.gameId), {
+              // best effort: the move message tells the assistant to read get_game if the board is missing
+              context: {text: TEXT.boardForAssistant(game), data: {game}, bestEffort: true},
+            })
+          : host.conversation.appendMessage(TEXT.result(game)); // reports the result, asks for no move
+      void handOver.then((result) => {
+        if (!board.isShowing(shown)) return; // a newer game or move is on screen
+        if (result.outcome !== 'appended') board.say(TEXT.tellTheAssistant);
+      });
     })
     .build();
```

**The flow:**

1. The person clicks a square. The server accepts the move, and the action presents the new board.
2. **If the game is still in progress**, the action appends a short move message: "Your move in tic-tac-toe game `<gameId>`. The board is in your context; if it isn't, read it with get_game. Then play O with play_move." The accepted game travels as the message's `context`, which the assistant receives but the conversation does not show. The message names the game; it never restates the board, because the server owns the state.
3. **If X's move ended the game**, the action instead appends the result, as the person: "I won our tic-tac-toe game." or "Our tic-tac-toe game ended in a draw." It asks for no move. Every draw ends on X's move, because X moves first on nine squares. An O win arrives through the assistant's own call and needs no message.
4. The host shows the message as if the person had typed it, and the assistant takes its turn.
5. If nothing was appended, the result says so, and the application tells the person what to type.

**Why the action rechecks with its own identity.** The hook starts the append and does not wait for it. A host may wait for the person to confirm the message, and a success hook has a five-second budget ([action defaults](../../docs/actions.md)). The action's `current()` is true only while the runtime waits for this hook ([action guide](../../docs/actions.md)). It is already false when the append settles. So the application compares its own `{gameId, moveNumber}` with what the board shows. A late failure for an old game or move never appears on a newer one.

The capability follows the shape of host links. A delivery-neutral contract lives in `@saga-a2ui/core`, the MCP Apps implementation lives in `@saga-a2ui/mcp/view`, and each stack places an instance on `ViewHost`.

![The application's action calls appendMessage, optionally with context, on the core contract; the MCP Apps implementation sends ui/update-model-context and then ui/message when the host supports them; a future A2A delivery would send one message/send with the context as a data part.](../../diagrams/view-conversation.svg)

[Editable Mermaid](../../diagrams/view-conversation.mmd) · [PNG](../../diagrams/view-conversation.png)

## Responsibilities and interfaces

**Contract (proposed, `@saga-a2ui/core/conversation`).**

```ts
export type RequestOutcome = 'denied' | 'unavailable' | 'failed';

export type AppendResult =
  | {readonly outcome: 'appended'; readonly context?: RequestOutcome} // context set only when best effort skipped it
  | {readonly outcome: RequestOutcome; readonly stage: 'context' | 'message'}; // nothing appended

export interface Conversation {
  /**
   * Adds a message to the conversation as the person, which gives the assistant its turn.
   * `context` is information for that turn that the conversation does not show. By default the
   * message is sent only if the context was accepted; `bestEffort: true` sends it regardless.
   */
  appendMessage(
    text: string,
    options?: {
      readonly role?: 'user';
      readonly context?: {
        readonly text: string;
        readonly data?: Record<string, unknown>;
        readonly bestEffort?: boolean; // default false
      };
    },
  ): Promise<AppendResult>;
}

export const NO_CONVERSATION: Conversation; // every call resolves {outcome: 'unavailable', stage: ...}
```

| Outcome | Meaning |
| --- | --- |
| `appended` | The host accepted the message. It does not show that the assistant replied, or what it said. |
| `denied` | The host refused the request, for example because the person declined or a policy blocked it. |
| `unavailable` | The host advertises no capability for the request, or the view has ended. That request was not sent. |
| `failed` | The request could not complete, for example because the connection was lost or it timed out. |

`stage` says which request stopped the append. `context` on an appended result says why a best-effort context was skipped.

**Context blocks the message by default.** When `context` is present and cannot be delivered, because it is unsupported, refused, failed or the view ended, the message is not sent. The result is `{outcome, stage: 'context'}`, so the application knows nothing reached the conversation.

With `bestEffort: true`, the application opts in to sending the message anyway. The result is `{outcome: 'appended', context: <why it was skipped>}`. An application should opt in only when the assistant has another way to get the information. The tic-tac-toe game opts in because its move message names `get_game`.

**One verb, not two.** Context is a parameter of the message, not a separate request.
- An MCP Apps host "will typically defer sending the context to the model until the next user message… Only the last update is sent" (`ext-apps` 2.0.3 `App.updateModelContext`).
- So context without a following message has no effect the application can rely on.
- A2A carries both in one `message/send`.

The verbs describe the conversation, not one delivery protocol:

| Delivery | `appendMessage` sends | Status |
| --- | --- | --- |
| MCP Apps | With `context`: `ui/update-model-context` first, `text` as a content block and `data` as `structuredContent`, only when `getHostCapabilities().updateModelContext` is present. Then `ui/message` with role `"user"` and one text content block, only when `getHostCapabilities().message` is present. | Proposed |
| A2A | One `message/send` with a `Message` of role `"user"` in the view's current `contextId`. `context` would become a data part on that message. | Not proposed; the [A2A delivery issue](https://github.com/MachineWisdomAI/saga-a2ui/issues/198) owns it |

**Trust.** Context comes from the view. It is a snapshot that helps the assistant, not authority. The server still validates every move, including its `expectedMoveNumber`.

`role` defaults to `'user'` and is the only accepted value. MCP Apps permits only that role. A2A's other role, `'agent'`, belongs to the agent, and the type widens only if a delivery needs it.

Capabilities are read at call time, as host links do, so the instance can exist before the bridge has connected.

**MCP Apps implementation (`@saga-a2ui/mcp/view`).** `conversationFromApp(app, signal)` sits beside `hostLinksFromApp`. It sends the context request, then the message, never in parallel. Once the view's lifetime signal has aborted, it resolves `unavailable`, including while a request is outstanding, so an ended view hears no late outcome.

**Stacks.** `ViewHost` gains a readonly `conversation: Conversation` in both stacks, built from the same `App` and lifetime signal as the existing members. React and Lit get it in the same release.

**Application.** It owns everything about the conversation:

- whether to append, what the text says, and what context goes with it;
- whether a context failure may be skipped (`bestEffort`);
- what the person sees when nothing was appended, shown only while the same state is on screen;
- never treating `appended` as the assistant having acted.

Its server stays authoritative over application state. An appended message is a prompt, not a command, and it authorizes nothing.

## Failure and recovery

| Trigger | Observable result and recovery |
| --- | --- |
| The host does not advertise `message` | `{outcome: 'unavailable', stage: 'message'}`. Nothing is sent. The application shows its own instruction, such as "Tell the assistant it's their move". |
| The context cannot be delivered (unsupported, refused or failed) | By default, `{outcome, stage: 'context'}`: the message is not sent, and the application shows its instruction. With `bestEffort`, the message is sent and the result is `{outcome: 'appended', context}`. |
| The host refuses the message | `denied` at the message stage; the application shows the same instruction. No retry, because a repeated message would ask the assistant twice. |
| The request rejects or times out | `failed`; whether the host showed the message is unknown. The application shows the instruction and does not retry automatically. |
| The view ends while a request is outstanding | `unavailable`. No later request is sent. |
| The outcome settles after the application moved on, for example to a new game | The application's own identity check finds different state on screen and ignores the outcome. |
| The assistant does not respond, or responds without acting | Outside this capability. The application keeps its own state consistent and offers the person a way to continue. |

## Verification outcomes

- **Message only.**
  - A fixture that advertises `message` and accepts the request records one `ui/message` with role `user` and the exact text, and the outcome is `appended`.
  - No context request is made.
- **With context.** The fixture records `ui/update-model-context` with `text` as content and `data` as `structuredContent`, and then `ui/message`, in that order.
- **Context fails, default.** The context capability is withheld, refused (`isError`) or rejected.
  - Nothing reaches `ui/message`.
  - The result is `{outcome: 'unavailable' | 'denied' | 'failed', stage: 'context'}`.
- **Context fails, best effort.** The same three cases.
  - Only `ui/message` is recorded.
  - The result is `{outcome: 'appended', context: <that outcome>}`.
- **Message refused or failing.** An `isError` answer resolves `denied` and a rejected request resolves `failed`, both at the message stage. A missing `message` capability resolves `unavailable` at the message stage.
- **Ended view.** Aborting the lifetime before or during either request resolves `unavailable`, sends nothing further and ignores the late answer.
- **Parity.** The same cases pass through `ViewHost.conversation` from both stacks, in Chromium against the local MCP Apps host fixture (`apps/lit-host/e2e/host-fixture`).
- **Exports and boundary.** Each package's `exports.test.ts` lists the new entries, and consumer code reaches the capability without importing the bridge.

These are local checks. Whether Claude, ChatGPT or Alexa+ show the message, and how their assistants respond, needs host runs. The design claims neither.

## Implementation sequence

1. Add the contract to `@saga-a2ui/core` and the MCP Apps implementation with its unit tests.
2. Add `ViewHost.conversation` to both stacks. Add fixture handlers that record context updates and messages in order, and that can withhold, refuse or fail each one. Add the browser cases.
3. Document it in the [React integration guide](../../docs/react-consumers.md) and the development reference.

This release bumps the package versions. The [getting-started tracks](getting_started_tracks.blueprint.md) design uses it for the tic-tac-toe example.

## Open decisions

None in the design. Host behaviour is missing verification, not an open design choice.

## References

- [View composition](view_composition.blueprint.md) for the stacks and `startA2uiView`.
- [Action binding](../modules/action_binding.blueprint.md) for actions, hooks and currentness.
- `@saga-a2ui/core/host-links` and `@saga-a2ui/mcp/view` `hostLinksFromApp`: the pattern this follows.
- MCP Apps `App.sendMessage`, `App.updateModelContext` and the host `message` and `updateModelContext` capabilities in `@modelcontextprotocol/ext-apps` 2.0.3. A2A `message/send`, `Message.role` and data parts.
