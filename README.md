# saga a2ui

**Framework for building agentic apps with A2UI and MCP Apps.**

Safe AGentic Apps — by [Machine Wisdom AI](https://machine-wisdom.ai).

[Quick start](#try-the-podcast-demo) · [Documentation](docs/getting-started.md) · [Blueprints](blueprints/README.md) · **[Adopters](ADOPTERS.md)** · [Contribute](CONTRIBUTING.md)

Build an assistant application around your existing services: render A2UI interfaces, attach local and server actions, and carry verified request identity to the backend. Saga builds on Google's open [A2UI project](https://github.com/a2ui-project/a2ui); MCP Apps provides the integration with the assistant host. Your application owns its data, authentication and authorization.

## Try the podcast demo

The Patreon-style subscriptions and podcast demo shows browsing, content controls and protected playback with **synthetic accounts and media**. It does not connect to Patreon or access anyone's subscriptions. The local host lets you switch accounts, deny access, expire a playback grant and recover with a fresh request. A notes example shows the same action contract outside playback.

From a source checkout, with Node 22.12.0 or newer and npm:

```sh
npm ci
npm run build:demo
cd apps/lit-host/dist/demo
npm install --omit=dev
npm start
```

Open the `Open the demo host page:` address printed by the server. This builds a self-contained Lit/Node demo from local candidate packages. It uses a local fixture host; it does not establish playback support in ChatGPT, Claude or Alexa+. See [demo controls and limitations](demo/lit-node/README.md).

**There is no public npm release yet.** SDK packages are private, unversioned source manifests; the build produces matched candidate tarballs. For your own application, follow [Getting started](docs/getting-started.md) to create a starter or [attach to an existing backend](docs/attach-to-existing-backend.md). Use the exact candidate dependency set, not registry install commands for unreleased packages.

## What Saga provides

| Responsibility | Owner |
| --- | --- |
| A2UI message validation, rendering integration, action binding and view lifecycle | Saga, building on upstream A2UI |
| MCP Apps resources, server/view integration and explicit data-sharing controls | Saga |
| Account verification, domain permissions, backend calls and authoritative effects | Your application |
| App presentation, tool routing and supported host APIs | The assistant host |

A2UI supplies the UI structure, bindings and updates that trusted renderers turn into an application. MCP Apps carries that application into a host. In the rails-and-carriage analogy, A2UI is the rails and your agentic app is the carriage; technically, A2UI messages can travel over MCP.

The source includes `@saga-a2ui/core`, `mcp`, `lit`, `react` and optional `components`. Lit has the full renderer path. React currently provides qualified action attachment and FaithfulCard slices, not renderer parity or a React starter. See [package responsibilities](packages/README.md) and [React dependencies](docs/react-consumers.md).

## Content and action boundaries

Application code selects a trusted content policy. **Standard** permits validated HTTPS links through the host and images from explicitly allowed HTTPS hosts. **Strict** keeps links inert and loads permitted images only after the reader chooses **Show images**; a new result or closed view revokes that consent. Both preserve ordinary Markdown formatting. The optional FaithfulCard preserves supplied answer text and attribution.

Client-side controls do not authorize server effects. Your server authenticates and checks permission on each protected operation. These controls limit particular content and outbound-request paths; they do not prevent an agent from misusing unrelated tools.

Host support depends on the flow. See [observed host behavior and remaining limits](docs/2026-10-19_host-compatibility-observations_v1.md) before choosing a deployment target.

## Documentation and design

- [Getting started](docs/getting-started.md): demo, starter and candidate installation.
- [Change a component and trace requests](docs/actions.md): allowed, denied and unauthenticated action paths.
- [Static source-linked tour](demo/tour/README.md): try allowed, denied and obsolete action outcomes in a browser against a simulated server, with each explanation linked to its source; no backend to run.
- [Development reference](docs/development-reference.md#local-development): build, tests and detailed implementation notes.
- [Candidate updates and rollback](docs/candidate-update-and-rollback.md): keep installed packages and views together.
- [Public installation status](docs/public-install.md): what remains before a public package recipe exists.
- [Blueprints](blueprints/README.md#find-a-design): architecture, contracts and their implementation status.
- [Adopters](ADOPTERS.md): applications using Saga and their current status.

## Why I built Saga

*Younes Abouelnagah, founder of Machine Wisdom AI*

Working on Headspace for Alexa+ inspired Saga. Getting the production integration working took attention away from the application itself, and the player remained bespoke. I wanted a reusable application foundation for the next team building inside an assistant. I chose A2UI for its UI structure, bindings and updates, with MCP Apps providing host integration.

That work followed earlier Gmail Add-on and Apps Script experience, and five years as a Principal Engineer in Roblox Trust and Safety. Those experiences inform how I approach application behavior and its safety boundaries.

Amazon has publicly named Headspace among the brands building Alexa+ experiences with MCP. [Amazon’s announcement](https://developer.amazon.com/zh/alexaplus/blogs/2026/07/alexa-plus-new-ways-to-build-experiences) describes that integration program; Headspace is not a Saga adopter or endorser.

## Machine Wisdom AI and community

[Machine Wisdom AI](https://machine-wisdom.ai) maintains Saga and offers paid production AI engineering and architecture engagements. For help with a project, see the [current engagement options and contact form](https://machine-wisdom.ai). The company site describes availability; this repository makes no support-response commitment.

We welcome small fixes, reproducible bug reports, application examples and improvements to the emerging A2UI and MCP Apps ecosystem. [Open an issue](https://github.com/MachineWisdomAI/saga-a2ui/issues/new/choose) or read [Contributing](CONTRIBUTING.md). Report vulnerabilities through [Security](SECURITY.md).

SDK code is licensed under [Apache-2.0](LICENSE). Preserve [third-party notices](THIRD_PARTY_NOTICES.md).
