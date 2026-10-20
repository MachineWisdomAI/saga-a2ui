# @saga-a2ui/components

Optional renderer-neutral FaithfulCard content parsing, policy and image consent. Entry point: `/faithful-card`. Preserve the included `THIRD_PARTY_NOTICES.md` when bundling its Markdown parser.

Requires Node >=22.12.0 and a TypeScript-aware bundler; exports are TypeScript source. Apache-2.0, with dependency licenses retained separately.

The prepared prerelease is `0.5.0-rc.1`, intended for the `next` tag. Preparation does not establish npm availability. Install only after the release is announced.

Use matching exact SAGA versions. At the consumer workspace root, pin `@a2ui/markdown-it` to `0.2.1` using your package manager override. React consumers use `@saga-a2ui/react/a2ui`, without direct A2UI dependencies. Keep the A2UI Zod 3 and MCP Zod 4 contexts separate.

See [the installation recipe](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/release-packages.md) and [React consumer dependencies](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/react-consumers.md).
