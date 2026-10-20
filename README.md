# saga a2ui

**Framework for building agentic apps with A2UI and MCP Apps.**

Safe AGentic Apps — by [Machine Wisdom AI](https://machine-wisdom.ai).

Saga helps teams build and maintain agentic apps around their existing services. It brings together UI rendering, user interactions and backend actions, so you can spend more time on what your application does.

Saga builds on Google's open [A2UI project](https://github.com/a2ui-project/a2ui). A2UI describes the interface and its updates; MCP Apps connects it to the assistant host. Your application supplies the data and decides who can use it.

## What Saga provides

**Interactive interfaces built on A2UI.** Render messages from your application, update the view as data changes, and connect buttons to typed actions. Saga manages the view lifecycle and action bindings.

**Actions connected to your services.** Handle an interaction locally or send it to your backend. Carry the verified request identity through to the server, where your application checks permissions and performs the operation. The same application contract can serve multiple views.

**MCP Apps integration.** Serve application resources and connect the server and view to an assistant host. Start with a Node, Express, Fastify or Hono backend, or [add Saga to an existing service](docs/attach-to-existing-backend.md).

**Answer cards with sources.** The optional FaithfulCard displays answer text with its attribution. You choose which links can open and which image hosts are allowed. A stricter display option keeps links inactive and lets the reader choose whether to load images.

The [core](https://www.npmjs.com/package/@saga-a2ui/core), [MCP](https://www.npmjs.com/package/@saga-a2ui/mcp), [React](https://www.npmjs.com/package/@saga-a2ui/react) and [components](https://www.npmjs.com/package/@saga-a2ui/components) packages are available on npm at `0.1.0-rc.1`. They export TypeScript source for applications that use a bundler. The Lit renderer powers the demo and starter templates; React provides action controls and FaithfulCard. See [package responsibilities](packages/README.md) and the [React integration guide](docs/react-consumers.md) for the available APIs.

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

To build your own application, follow [Getting started](docs/getting-started.md). For a browser walkthrough of actions and their source code, try the [interactive notes tour](demo/tour/README.md). The [host compatibility guide](docs/2026-10-19_host-compatibility-observations_v1.md) covers deployment behavior in different assistants.

## Documentation and design

- [Getting started](docs/getting-started.md): demo, starter and candidate installation.
- [Change a component and trace requests](docs/actions.md): allowed, denied and unauthenticated action paths.
- [Static source-linked tour](demo/tour/README.md): try allowed, denied and obsolete action outcomes in a browser against a simulated server, with each explanation linked to its source; no backend to run.
- [Development reference](docs/development-reference.md#local-development): build, tests and detailed implementation notes.
- [Candidate updates and rollback](docs/candidate-update-and-rollback.md): keep installed packages and views together.
- [Release packages](docs/release-packages.md): package exports, dependencies and installation requirements.
- [Blueprints](blueprints/README.md#find-a-design): architecture, contracts and their implementation status.
- [Adopters](ADOPTERS.md): meet the teams building with Saga.

## Why I built Saga

*Younes Abouelnagah, founder of Machine Wisdom AI*

Working on Headspace for Alexa+ inspired Saga. Getting the production integration working took attention away from the application itself, and the player remained bespoke. I wanted a reusable application foundation for the next team building inside an assistant. I chose A2UI for its UI structure, bindings and updates, with MCP Apps providing host integration.

That work followed earlier Gmail Add-on and Apps Script experience, and five years as a Principal Engineer in Roblox Trust and Safety. Those experiences inform how I approach application behavior and its safety boundaries.

Amazon has publicly named Headspace among the brands building Alexa+ experiences with MCP. [Amazon’s announcement](https://developer.amazon.com/zh/alexaplus/blogs/2026/07/alexa-plus-new-ways-to-build-experiences) describes that integration program; Headspace is not a Saga adopter or endorser.

## Machine Wisdom AI and community

[Machine Wisdom AI](https://machine-wisdom.ai) maintains Saga and offers paid production AI engineering and architecture engagements. For help with a project, see the [current engagement options and contact form](https://machine-wisdom.ai).

We welcome small fixes, reproducible bug reports, application examples and improvements to the emerging A2UI and MCP Apps ecosystem. [Open an issue](https://github.com/MachineWisdomAI/saga-a2ui/issues/new/choose) or read [Contributing](CONTRIBUTING.md). Report vulnerabilities through [Security](SECURITY.md).

SDK code is licensed under [Apache-2.0](LICENSE). Preserve [third-party notices](THIRD_PARTY_NOTICES.md).
