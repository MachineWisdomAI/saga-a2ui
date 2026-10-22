# @saga-a2ui/react-mcp-stack

The React stack for an MCP Apps view: it connects one React renderer to one delivery, the host's MCP Apps bridge, so an application writes only its own decisions. Entry points:

- `.`: `startA2uiView` for an own-catalog A2UI view, `createReactActions`, the authoring exports, and `readingProfile`.
- `/faithful-card`: `FaithfulCardApp`, `startFaithfulCardApp` (with the optional `classifyResult`, the application's reading of the whole delivered result), `CardResultOutcome`, `useHostLink` and `readingProfile`.
- `/faithful-card.css`: the card's stylesheet.
- `/content-policy`: `createContentPolicy` and `embedContentPolicy`, for the server that states the policy the card application reads from its document.
- `/server`: `createServerBudgets`, `registerPublicOperation`, `operationViewFromHtml`, `viewUriForHtml`, `attachRequestLifetime`, and the types `OperationView` and `RequestLifetime`. Node only; no browser entry imports it.

The main entry does not import `@saga-a2ui/components`, so an own-catalog bundle contains neither FaithfulCard nor Markdown. The package still declares the components package, so one install makes the `/faithful-card` and `/content-policy` entries work. React and React DOM are peers, both exactly 19.3.1.

Requires Node >=22.12.0 and a TypeScript-aware bundler; exports are TypeScript source. Apache-2.0, with dependency licenses retained separately.

Release candidates are published under the npm `next` tag. Pin the same exact version of all saga a2ui packages used by your application.

See [the installation recipe](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/release-packages.md).
