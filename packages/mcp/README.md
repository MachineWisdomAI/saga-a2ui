# @saga-a2ui/mcp

MCP and MCP Apps delivery. Separate `/server`, `/view` and `/policy` exports keep server and browser responsibilities explicit. The application owns HTTP hosting, authentication and backend authorization. The `/server/http` export (`createMcpFetchApp`) serves its operations through a standard `fetch(Request)` function for a Worker or a Node listener of its choice; see [Fetch hosting](../../docs/fetch-mcp-hosting.md). The `/view` export owns the lifetime of a view (`runToolResultView`), the host link request (`hostLinksFromApp`), the conversation (`conversationFromApp`, which adds a message with optional context), its own sizing (`startOwnSizing`) the reading profile of the host (`readingProfile`) and the mapping of a tool result onto core's neutral `DeliveredResult` (`deliveredResultFromToolResult`, which interprets nothing); it depends on `@saga-a2ui/core` for the host link and delivered result contracts and on no renderer.

Requires Node >=22.12.0 and a TypeScript-aware bundler; exports are TypeScript source. Apache-2.0, with dependency licenses retained separately.

Release candidates are published under the npm `next` tag. Pin the same exact version of all saga a2ui packages used by your application.

Use matching exact SAGA versions. Apply the [consumer-root compatibility and security overrides](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/public-install.md#install-one-stack-plus-framework-peers). React consumers use `@saga-a2ui/react/a2ui`, without direct A2UI dependencies. Keep the A2UI Zod 3 and MCP Zod 4 contexts separate.

See [the installation recipe](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/release-packages.md) and [React consumer dependencies](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/react-consumers.md).
