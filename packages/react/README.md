# @saga-a2ui/react

React renderer integration. Entry points: `/a2ui`, `/actions`, `/faithful-card` (the card, `createFaithfulCardView`, `openFaithfulCardSurface`, `useHostLink`), `/faithful-card.css`. React and React DOM peers are both exactly 19.3.1. Components is optional for own-catalog rendering and required for FaithfulCard.

Requires Node >=22.12.0 and a TypeScript-aware bundler; exports are TypeScript source. Apache-2.0, with dependency licenses retained separately.

Release candidates are published under the npm `next` tag. Pin the same exact version of all saga a2ui packages used by your application.

Use matching exact SAGA versions. At the consumer workspace root, pin `@a2ui/markdown-it` to `0.2.1` using your package manager override. React consumers use `@saga-a2ui/react/a2ui`, without direct A2UI dependencies. Keep the A2UI Zod 3 and MCP Zod 4 contexts separate.

See [the installation recipe](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/release-packages.md) and [React consumer dependencies](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/react-consumers.md).
