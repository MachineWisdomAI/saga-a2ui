# @saga-a2ui/react-mcp-stack

The React stack for an MCP Apps view. It connects one React renderer to one delivery, the host's MCP Apps bridge, so an application writes only its own decisions. Entry points:

- `.`: `startA2uiView` for an own-catalog A2UI view, `createReactActions`, the authoring exports, and `readingProfile`.
- `/faithful-card`: `FaithfulCardApp`, `startFaithfulCardApp`, `CardResultOutcome`, `CardResultReader`, `DeliveredResult` (what the definition's one `result` reader receives), `useHostLink` and `readingProfile`.
- `/faithful-card.css`: the card's stylesheet.
- `/content-policy`: `createContentPolicy` and `embedContentPolicy`, for the server that states the policy the card application reads from its document.
- `/server`: `createServerBudgets`, `registerPublicOperation`, `operationViewFromHtml`, `viewUriForHtml`, `attachRequestLifetime`, and the types `OperationView` and `RequestLifetime`. Node only; no browser entry imports it.

The main entry does not import `@saga-a2ui/components`, so an own-catalog bundle contains neither FaithfulCard nor Markdown. The package still declares the components package, so one install makes the `/faithful-card` and `/content-policy` entries work. `react` and `react-dom` are peers, both exactly 19.3.1.

Requires Node >=22.12.0 and a TypeScript-aware bundler; exports are TypeScript source. Apache-2.0, with dependency licenses retained separately.

## Install

This package is on public npm; release candidates are under the `next` tag. Install the stack with its React peers from the tested release set that [Installing saga a2ui](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/public-install.md) lists, pinning each `@saga-a2ui` sibling to the exact version that set names (patch versions may differ within one major.minor; see the [version policy](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/version-policy.md)), and keep the `@a2ui/markdown-it` override at `0.2.1` in your consumer workspace root.

See [Installing saga a2ui](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/public-install.md) for the verified recipe and [React consumer dependencies](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/react-consumers.md).
