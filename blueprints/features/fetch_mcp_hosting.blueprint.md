---
feature_name: fetch_mcp_hosting
status: approved
module_blueprints: []
dependencies: [reusable_mcp_connector, request_view_lifetimes]
date_added: 2026-10-30
---

# Host an MCP application through Fetch

## Status

- Design: approved by human review on 30 October 2026 at [revision `eb2f0c2cd3cf9216c5b3dbb17d09830283863c05`](https://github.com/MachineWisdomAI/saga-a2ui/blob/eb2f0c2cd3cf9216c5b3dbb17d09830283863c05/blueprints/features/fetch_mcp_hosting.blueprint.md), including its referenced diagrams. This records design approval, not implementation or release acceptance.
- Implementation: Partial. The shared Fetch entry (`createMcpFetchApp`, [guide](../../docs/fetch-mcp-hosting.md)) landed in [`f1fbac0882302cbf024100b462e08abd06a5bdc1`](https://github.com/MachineWisdomAI/saga-a2ui/commit/f1fbac0882302cbf024100b462e08abd06a5bdc1) and is qualified from source and packed packages in the `workerd` runtime and behind a Node listener. Existing operation registration and request-lifetime attachment remain implemented. The hosted game's consumption is separate scope.
- Acceptance: Package publication, a published-registry installation and any deployed endpoint remain open. This design does not establish a deployed endpoint.

## Problem and current behavior

An application can already register operations through the SDK, but the maintained Tic Tac Toe example starts a loopback Node listener. A hosted Workers application needs the same operations behind a Fetch handler, without copying HTTP composition into every consumer.

[Ansari's public fetch application](https://github.com/iaser-ai/ansari/blob/3a072dac1b0f80ebb672e3039f7940c336ec99fd/apps/mcp/src/server/fetch-app.ts) demonstrates the reusable portion: the official stateless MCP handler, official Hono host/origin validation, a selected route and a server factory. Its backend, logging, environment parsing and deployment remain application decisions. The SDK's existing `attachRequestLifetime` already handles server closure; extracting hosting must reuse it.

## Proposed behavior

Today an application assembles that HTTP composition itself. The proposed `createMcpFetchApp` supplies it through `@saga-a2ui/mcp/server/http`, re-exported by each renderer stack's matching server entry. A Worker passes the returned `fetch` function the incoming request. A Node application can place the same handler behind its chosen listener. Neither use starts a port or reads environment variables inside the shared handler.

The application prepares its immutable view and store adapter, then supplies a factory that creates one `McpServer` for each protocol request. The SDK starts that server's operation/request lifetime, passes it into the factory and attaches the existing close handling. Tool registration remains the application's existing `registerPublicOperation` or protected-operation composition. The official handler owns transports, protocol negotiation, JSON/SSE response delivery and transport cleanup.

![Existing MCP ownership: application operations surround SDK validation and view delivery.](../../diagrams/reusable-mcp-connector.svg)

The diagram's explicit-public-operation branch is the game path. Fetch hosting changes how requests reach registration; it does not change the handler, result or view responsibilities. [Editable diagram](../../diagrams/reusable-mcp-connector.mmd) · [PNG](../../diagrams/reusable-mcp-connector.png).

## Responsibilities and interfaces

| Owner | Interface and responsibility |
| --- | --- |
| Application | Supplies `createServer(lifetime)`, an exact endpoint path, explicit host/origin allowlists, optional budget settings and JSON or SSE response mode. It owns bindings, identity verification, backend effects, view bytes and storage. |
| Shared Fetch entry | Returns `fetch(Request)` and asynchronous `close()`. Installs the official validators and delegates the configured route to the official stateless handler. No registry, arbitrary upstream forwarding or process-global current-request state is introduced. |
| Server factory | Registers operations with the supplied lifetime and returns a fresh server. It does not subclass the server to finish timers. A factory failure finishes the lifetime it received. |
| Platform/listener | Owns network admission, the request body arriving, socket/server timeouts and shutdown. The SDK does not add a custom body reader or connection-teardown implementation. |

The path defaults to `/mcp`; the game selects `/tic-tac-toe/mcp`. Validate configuration before handling traffic. Allowlists are explicit arrays: trim and deduplicate entries, preserve an explicitly empty list, and add no implicit localhost entries. Missing host/origin settings are configuration errors. An absent Origin header follows the official middleware's behavior; an Origin-bearing request must pass the configured rule. Environment-to-settings precedence stays in the application.

The ordinary SDK operation/request budget begins when the server factory is entered. It is not a promise that a stalled body has an SDK-enforced arrival deadline. Use maintained upstream body-size controls and the platform's network bounds; a stronger body-arrival guarantee requires upstream support, not a second transport implementation.

## Failure and recovery

An unlisted Host or Origin is rejected by the official middleware before a game operation runs. An unrelated path returns not-found. Factory failure, transport closure and closing a server before connection all release the created lifetime; repeated cleanup must not finish it twice. The shared close operation delegates shutdown to the official handler and preserves the existing safe operation failures.

Content-free diagnostics may report a fixed failure kind. The adapter must not print tool arguments, responses, credentials or an upstream exception. A canceled local wait does not establish that a remote backend effect stopped.

## Verification outcomes

Exercise the public Fetch interface in a real Workers test runtime and behind an installed Node consumer. Both must discover tools, call an operation and retrieve its declared view using the same application composition. Cover configured route selection, permitted/rejected Host and Origin, absent Origin, JSON/SSE delivery, server-factory failure and cleanup before/after transport connection. Refused requests invoke no application effect.

Reuse existing lifetime and operation tests for their unchanged contracts. Qualify clean public imports from packed packages, including the stack re-export and the absence of a Node listener/filesystem startup dependency. These are planned checks; real Claude/ChatGPT rendering belongs to the hosted application design.

## Implementation sequence

Extract only the demonstrated Fetch composition over the maintained handler and existing lifetime helper. Qualify it with an installed Workers consumer and an installed Node consumer, then consume it in the hosted game. Preserve the separate local tutorial listener and its familiar npm/Vite workflow. Package publication remains separate from source implementation.

## References

[Reusable MCP connector](reusable_mcp_connector.blueprint.md), [request/view lifetimes](request_view_lifetimes.blueprint.md), [package ownership](../../packages/README.md), [existing lifetime attachment](../../packages/mcp/src/server/request-closure.ts) and [hosted Tic Tac Toe](hosted_tic_tac_toe.blueprint.md).
