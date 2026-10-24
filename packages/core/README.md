# @saga-a2ui/core

Renderer-independent actions and A2UI v0.9 decoding. Entry points: `/actions`, `/actions/action-button-schema`, `/delivered-result` (the neutral whole-result type a delivery hands a view), `/host-links`, `/protocols/a2ui/v0_9`, `/protocols/a2ui/zod3`.

Requires Node >=22.12.0 and a TypeScript-aware bundler; exports are TypeScript source. Apache-2.0, with dependency licenses retained separately.

## Install

This package is on public npm; release candidates are under the `next` tag. Install the tested release set that [Installing saga a2ui](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/public-install.md) lists, and pin each `@saga-a2ui` sibling to the exact version that set names. Packages share a major.minor version but their patch versions may differ ([version policy](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/version-policy.md)). At the consumer workspace root, pin `@a2ui/markdown-it` to `0.2.1` with your package manager's override. For React/MCP applications, install and import from `@saga-a2ui/react-mcp-stack`; it supplies the renderer and delivery dependencies. Lower-level renderer integrations use `@saga-a2ui/react/a2ui` without direct A2UI dependencies. Keep the A2UI Zod 3 and MCP Zod 4 contexts separate.

See [Installing saga a2ui](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/public-install.md) for the verified recipe and [React consumer dependencies](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/react-consumers.md).
