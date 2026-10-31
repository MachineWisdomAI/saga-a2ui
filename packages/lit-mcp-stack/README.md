# @saga-a2ui/lit-mcp-stack

The Lit renderer and MCP Apps delivery in one application dependency. Install the stack plus `lit@^3.3.3`, and import from the stack only: the root starts an application-owned catalog with `startA2uiView`; `/faithful-card` starts a card application with `startFaithfulCardApp`; `/content-policy` supplies content policies; `/server` supplies server composition. The server entry stays out of browser bundles.

The stack declares core, components, MCP and the Lit renderer as dependencies. Your application owns its domain values, catalog, actions, verified identity and authorization.

Requires Node >=22.12.0 and a TypeScript-aware bundler; exports are TypeScript source. Apache-2.0, with dependency licenses retained separately.

Release candidates use the npm `next` tag. Pin exact published SAGA versions. Apply the [consumer-root compatibility and security overrides](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/public-install.md#install-one-stack-plus-framework-peers). Keep A2UI's Zod 3 and MCP's Zod 4 contexts separate.

See [public installation](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/public-install.md) and [release preparation](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/release-packages.md). Source versions and candidate tarballs do not establish registry availability.
