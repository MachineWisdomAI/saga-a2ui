# @saga-a2ui/lit

Lit renderer integration for SAGA A2UI. Entry points: the root mounts an application's own A2UI catalog; `/actions` attaches actions to rendered controls; `/faithful-card` supplies the optional FaithfulCard element. Components is optional for own-catalog rendering and required for FaithfulCard.

Applications connecting Lit to MCP normally install `@saga-a2ui/lit-mcp-stack` and the Lit peer, and import from the stack only. Lower-level integrations may use this renderer directly with matching SAGA packages.

Requires Node >=22.12.0 and a TypeScript-aware bundler; exports are TypeScript source. Apache-2.0, with dependency licenses retained separately.

Release candidates use the npm `next` tag. Pin exact published SAGA versions. At the consumer root, override `@a2ui/markdown-it` to `0.2.1`; keep A2UI's Zod 3 and MCP's Zod 4 contexts separate.

See [public installation](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/public-install.md) and [release preparation](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/release-packages.md). Source versions and candidate tarballs do not establish registry availability.
