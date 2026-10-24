# @saga-a2ui/react

React renderer integration. Entry points: `/a2ui`, `/actions`, `/faithful-card` (the card, `createFaithfulCardView`, `openFaithfulCardSurface`, `useHostLink`) and `/faithful-card.css`. `react` and `react-dom` are peers, both exactly 19.3.1. `@saga-a2ui/components` is an optional peer: not needed for own-catalog rendering, required for FaithfulCard.

Requires Node >=22.12.0 and a TypeScript-aware bundler; exports are TypeScript source. Apache-2.0, with dependency licenses retained separately.

## Install

This package is on public npm; release candidates are under the `next` tag. Install the tested release set that [Installing saga a2ui](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/public-install.md) lists, and pin each `@saga-a2ui` sibling to the exact version that set names. Packages share a major.minor version but their patch versions may differ ([version policy](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/version-policy.md)). At the consumer workspace root, pin `@a2ui/markdown-it` to `0.2.1` with your package manager's override. Import A2UI surfaces and catalogs from `@saga-a2ui/react/a2ui` and declare no direct `@a2ui/react` or `@a2ui/web_core` dependency. Keep the A2UI Zod 3 and MCP Zod 4 contexts separate.

See [Installing saga a2ui](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/public-install.md) for the verified recipe and [React consumer dependencies](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/react-consumers.md).
