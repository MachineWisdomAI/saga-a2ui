# @saga-a2ui/components

Optional renderer-neutral FaithfulCard content parsing, policy and image consent, and the styling surface both renderers emit ([faithful-card-styling.md](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/faithful-card-styling.md)). Entry point: `/faithful-card`. Preserve the included `THIRD_PARTY_NOTICES.md` when bundling its Markdown parser.

Requires Node >=22.12.0 and a TypeScript-aware bundler; exports are TypeScript source. Apache-2.0, with dependency licenses retained separately.

Release candidates are published under the npm `next` tag. Pin the same exact version of all saga a2ui packages used by your application.

Use matching exact SAGA versions. Apply the [consumer-root compatibility and security overrides](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/public-install.md#install-one-stack-plus-framework-peers). React consumers use `@saga-a2ui/react/a2ui`, without direct A2UI dependencies. Keep the A2UI Zod 3 and MCP Zod 4 contexts separate.

See [the installation recipe](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/release-packages.md) and [React consumer dependencies](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/react-consumers.md).
