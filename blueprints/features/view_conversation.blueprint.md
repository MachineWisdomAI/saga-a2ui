---
feature_name: view_conversation
status: draft
module_blueprints: [action_binding]
dependencies: [view_composition, reusable_mcp_connector]
date_added: 2026-10-27
---

# A view adds a message to the conversation

## Status

- Design: draft awaiting human approval.
- Implementation: not started.

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

The MCP Apps bridge the stacks depend on (`@modelcontextprotocol/ext-apps` 2.0.3) already supports this. `App.sendMessage` sends `ui/message`, a message with role `"user"` that the host adds to the conversation, and the host advertises it through its `message` capability. The stacks construct `App` privately, and the consumer boundary forbids applications from importing the bridge (`scripts/consumer-boundary.ts`). So an application has no supported way to add a message.

## Proposed behavior

```diff
 actions: (host) => {
   const play = Action.server<ActionButtonActivation, CallToolResult>('play-square', host.server)
     .input((event) => ({square: Number(event.read('index'))}))
     .run(({params, call}) => call('play_move', {...game.current(), ...params, player: 'X'}))
     .onSuccess(({result, current}) => {
       if (!current()) return;
       game.present(result);
-      // The assistant does not know the person moved.
+      if (game.isAssistantsTurn())
+        void host.conversation.appendMessage(game.describeLastMove()).then((outcome) => {
+          if (outcome !== 'appended') game.say(TEXT.tellTheAssistant);
+        });
     })
     .build();
```

The hook starts the append and does not wait for it. A host may wait for the person to confirm the message, and a success hook has a five-second budget ([action defaults](../../docs/actions.md)). The application handles the outcome when it arrives.

The flow:

1. The person clicks a square. The server accepts the move, and the action presents the new board.
2. The action appends one message, such as "I played X in row 1, column 2. Your move."
3. The host shows it in the conversation as if the person had typed it, and the assistant takes its turn.
4. If the host cannot take an appended message, the outcome says so and the application tells the person what to type.

The capability follows the shape of host links. A delivery-neutral contract lives in `@saga-a2ui/core`, the MCP Apps implementation lives in `@saga-a2ui/mcp/view`, and each stack places an instance on `ViewHost`.

![The application's action calls appendMessage on the core contract; the MCP Apps implementation sends ui/message when the host advertises message support; a future A2A delivery would send message/send in the current context.](../../diagrams/view-conversation.svg)

[Editable Mermaid](../../diagrams/view-conversation.mmd) · [PNG](../../diagrams/view-conversation.png)

## Responsibilities and interfaces

**Contract (proposed, `@saga-a2ui/core/conversation`).**

```ts
export type AppendOutcome = 'appended' | 'denied' | 'unavailable' | 'failed';

export interface Conversation {
  /** Adds a message to the conversation as the person, which gives the assistant its turn. */
  appendMessage(text: string, options?: {readonly role?: 'user'}): Promise<AppendOutcome>;
}

export const NO_CONVERSATION: Conversation; // every call resolves 'unavailable'
```

| Outcome | Meaning |
| --- | --- |
| `appended` | The host accepted the message. It does not show that the assistant replied, or what it said. |
| `denied` | The host refused it, for example because the person declined or a policy blocked it. |
| `unavailable` | The host advertises no message capability, or the view has ended. Nothing was sent. |
| `failed` | The request could not complete, for example because the connection was lost or it timed out. |

The verbs describe the conversation, not one delivery protocol:

| Delivery | `appendMessage` sends | Status |
| --- | --- | --- |
| MCP Apps | `ui/message` with role `"user"` and one text content block, only when `getHostCapabilities().message` is present | Proposed |
| A2A | `message/send` with a `Message` of role `"user"` in the view's current `contextId` | Not proposed; the [A2A delivery issue](https://github.com/MachineWisdomAI/saga-a2ui/issues/198) owns it |

`role` defaults to `'user'` and is the only accepted value. MCP Apps permits only that role. A2A's other role, `'agent'`, belongs to the agent, and the type widens only if a delivery needs it.

The capability is read at call time, as host links do, so the instance can exist before the bridge has connected.

**MCP Apps implementation (`@saga-a2ui/mcp/view`).** `conversationFromApp(app, signal)` sits beside `hostLinksFromApp`. It resolves `unavailable` once the view's lifetime signal has aborted, including while a request is outstanding, so an ended view hears no late outcome.

**Stacks.** `ViewHost` gains a readonly `conversation: Conversation` in both stacks, built from the same `App` and lifetime signal as the existing members. React and Lit get it in the same release.

**Application.** It owns everything about the conversation:

- whether to append and what the text says;
- what the person sees when the outcome is not `appended`;
- never treating `appended` as the assistant having acted.

Its server stays authoritative over application state. An appended message is a prompt, not a command, and it authorizes nothing.

**Not included.** `updateModelContext`, which updates the model's context without starting a turn, is not proposed. The current examples do not need it, and A2A has no equivalent. It can follow under a general name when an application needs it.

## Failure and recovery

| Trigger | Observable result and recovery |
| --- | --- |
| The host does not advertise `message` | `unavailable`; nothing is sent. The application shows its own instruction, such as "Tell the assistant it's their move". |
| The host refuses the message | `denied`; the application shows the same instruction. No retry, because a repeated message would ask the assistant twice. |
| The request rejects or times out | `failed`; whether the host showed the message is unknown. The application shows the instruction and does not retry automatically. |
| The view ends while the request is outstanding | `unavailable`; the action's currentness checks keep the outcome from reaching a retired view. |
| The assistant does not respond, or responds without acting | Outside this capability. The application keeps its own state consistent and offers the person a way to continue. |

## Verification outcomes

- **Capability present.** A host fixture that advertises `message` and accepts the request: one `ui/message` with role `user` and the exact text is recorded; the outcome is `appended`.
- **Capability absent.** No request is sent; the outcome is `unavailable`.
- **Host refusal.** An `isError` answer resolves `denied`; a rejected request resolves `failed`.
- **Ended view.** Aborting the lifetime before or during the request resolves `unavailable`, and the late answer is ignored.
- **Parity.** The same cases pass through `ViewHost.conversation` from both stacks, in Chromium against the local MCP Apps host fixture (`apps/lit-host/e2e/host-fixture`).
- **Exports and boundary.** Each package's `exports.test.ts` lists the new entries, and consumer code reaches the capability without importing the bridge.

These are local checks. Whether Claude, ChatGPT or Alexa+ show the message, and how their assistants respond, needs host runs. The design claims neither.

## Implementation sequence

1. Add the contract to `@saga-a2ui/core` and the MCP Apps implementation with its unit tests.
2. Add `ViewHost.conversation` to both stacks. Add a fixture handler that records messages and can withhold the capability, and add the browser cases.
3. Document it in the [React integration guide](../../docs/react-consumers.md) and the development reference.

This release bumps the package versions. The [getting-started tracks](getting_started_tracks.blueprint.md) design uses it for the tic-tac-toe example.

## Open decisions

None in the design. Host behaviour is missing verification, not an open design choice.

## References

- [View composition](view_composition.blueprint.md) for the stacks and `startA2uiView`.
- [Action binding](../modules/action_binding.blueprint.md) for actions, hooks and currentness.
- `@saga-a2ui/core/host-links` and `@saga-a2ui/mcp/view` `hostLinksFromApp`: the pattern this follows.
- MCP Apps `App.sendMessage` and the host `message` capability in `@modelcontextprotocol/ext-apps` 2.0.3. A2A `message/send` and `Message.role`.
