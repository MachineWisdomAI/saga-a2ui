# @saga-a2ui/react-mcp-stack

The React stack for an MCP Apps view: it connects one React renderer to one delivery, the host's MCP Apps bridge, so an application writes only its own decisions. Entry points: `.` (`startA2uiView` for an own-catalog A2UI view, `createReactActions`, the authoring exports), `/faithful-card` (`FaithfulCardApp`, `startFaithfulCardApp`, `contentPolicyFromDocument`, `documentContentSecurityPolicies`), `/faithful-card.css`.

The main entry does not import `@saga-a2ui/components`, so an own-catalog bundle contains neither FaithfulCard nor Markdown. The package still declares the components package, so one install makes the `/faithful-card` entry work. React and React DOM are peers, both exactly 19.3.1.

Requires Node >=22.12.0 and a TypeScript-aware bundler; exports are TypeScript source. Apache-2.0, with dependency licenses retained separately.

Release candidates are published under the npm `next` tag. Pin the same exact version of all saga a2ui packages used by your application.

See [the installation recipe](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/release-packages.md).
