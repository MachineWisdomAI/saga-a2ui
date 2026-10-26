# saga a2ui - a framework for building agentic apps with A2UI and MCP

![saga a2ui: the Wyrm dragon and wordmark](assets/brand/readme-banner.png)

**Bring your services to AI assistants and agents, including Alexa+, ChatGPT, Claude and more, with less engineering work.**

saga a2ui combines robust foundations from [Google's A2UI project](https://a2ui.org/) with [Machine Wisdom AI](https://machine-wisdom.ai)'s production and safety expertise, designed to fit your existing API platform.

[Meet the adopters building with saga a2ui](ADOPTERS.md).

## Build the experience your customers need

Your team knows what customers should be able to do with your service. saga a2ui provides the application foundations for turning those tasks into interactive experiences, from browsing content to taking an action through an existing API. The aim is to give your team a head start and reduce the custom application code it has to maintain as these experiences evolve.

A2UI describes the interface, its data bindings and updates, independently of how messages travel between an agent and its host. Delivery can use MCP Apps or [A2A (planned)](https://github.com/MachineWisdomAI/saga-a2ui/issues/198). saga a2ui connects the application model to rendered components, user actions and the application's lifecycle, with an MCP Apps integration. You can build on that foundation while keeping your own services, authentication and business rules.

## What saga a2ui provides

### An interactive UI and actions built in code

Use TypeScript to define an interface, update it as application data changes, and bind a component to a typed action. Define actions that run locally or call your backend, with behavior expressed in code rather than embedded in the A2UI JSON. saga a2ui manages the action's connection to the view, including what happens when a result arrives after the view has changed or closed.

The [action guide](docs/actions.md) follows a notes application through these interactions, showing how the same application contract serves different views.

### Integration with your existing API platform

Start with a Node, Express, Fastify, Hono or Hapi backend, or [add saga a2ui to an existing service](docs/attach-to-existing-backend.md). saga a2ui carries the verified request identity through to your application, where your server checks permissions and performs the operation.

Application processing, MCP integration, components and React bindings have separate packages, so you can choose the parts your application uses and review their dependencies. The [package guide](packages/README.md) explains their responsibilities and how they fit together.

### Content controls for the application you are building

saga a2ui's [FaithfulCard component](docs/react-consumers.md) presents Markdown in a styled card, preserving the supplied answer, including source attribution for RAG agents. It renders that answer directly, without asking the host LLM to paraphrase it for display.

Your application chooses which links may open and which image hosts are allowed. For content that needs more restrictive handling, links can remain inactive and images can wait until the reader chooses to load them. These settings let you adapt the presentation to where your content comes from and what readers should be able to do with it.

## Try the podcast demo

Explore a Patreon-style subscription and podcast experience using synthetic accounts and media. Browse episodes, switch accounts and try protected playback, including denied access and expired playback grants. The demo runs locally and does not connect to Patreon.

From a source checkout, with Node 22.12.0 or newer and npm:

```sh
npm ci
npm run build:demo
cd apps/lit-host/dist/demo
npm install --omit=dev
npm start
```

Open the `Open the demo host page:` address printed by the server. The demo includes its own local host, so you can explore the application without deploying it or connecting an assistant. See the [podcast demo guide](demo/lit-node/README.md) for its controls and setup.

For a browser walkthrough of actions and their implementation, try the [interactive notes tour](demo/tour/README.md). It runs against a simulated server and links each explanation to the source.

## Build your application

Follow [Getting started](docs/getting-started.md) for a starter project or an existing-backend integration. The Lit renderer powers the demo and starter templates; the React integration provides action controls and FaithfulCard.

For Hapi, the [integration map](templates/lit-hapi/README.md#existing-hapi-app-register-an-endpoint) shows how to reuse the [bridge](templates/lit-hapi/server/bridge.ts) in your own app, with a registration example, bridge-owned lifecycle handling and the application’s responsibilities.

The seven-package public release set includes the Lit and React renderers and their MCP stacks. Applications install one stack plus framework peers; packages export TypeScript source for use with a bundler. See [public installation](docs/public-install.md) for registry availability and exact-version recipes, and the [React integration guide](docs/react-consumers.md) for React dependency configuration.

- [Action guide](docs/actions.md): connect interactions to application behavior.
- [Development reference](docs/development-reference.md#local-development): build and test the SDK.
- [Candidate updates and rollback](docs/candidate-update-and-rollback.md): keep installed packages and views together.
- [Host compatibility](docs/2026-10-19_host-compatibility-observations_v1.md): choose a host for your application.
- [Blueprints](blueprints/README.md#find-a-design): explore the architecture and component contracts.
- [Building with saga a2ui](ADOPTERS.md): IASER's Ansari integration and how to share your application.

## Why I built saga a2ui

*Younes Abouelnagah, founder of Machine Wisdom AI*

Working on Headspace for Alexa+ inspired saga a2ui. Getting the production integration working took attention away from the application itself, and the player remained bespoke. I evaluated other approaches, but couldn't find one that fit our existing API platform and the dependency-review requirements we worked within. We built the integration in-house.

I wanted robust application foundations that another team could adopt within the platform it already operated. I chose A2UI for its application model and the engineering behind it, with MCP Apps providing host integration. saga a2ui brings those pieces together with the application behavior I wanted to reuse on the next project.

My perspective on content safety comes from AMP and Gmail Add-ons, alongside five years as a Principal Engineer in Roblox Trust and Safety. That experience informs how saga a2ui handles displayed content and the choices it leaves with the application developer.

[Amazon's announcement of Headspace's Alexa+ integration](https://developer.amazon.com/zh/alexaplus/blogs/2026/07/alexa-plus-new-ways-to-build-experiences) describes the project that inspired this work.

## Work with Machine Wisdom AI

saga a2ui is maintained by [Machine Wisdom AI](https://machine-wisdom.ai) for its clients.

[Talk to Machine Wisdom AI](https://machine-wisdom.ai) about bringing your services to Alexa+, ChatGPT, Claude and more, or join saga a2ui adopters by following the [Quick Start guide](docs/getting-started.md).

We welcome fixes, reproducible bug reports, application examples and contributions to the A2UI and MCP Apps ecosystem. [Open an issue](https://github.com/MachineWisdomAI/saga-a2ui/issues/new/choose) or read [Contributing](CONTRIBUTING.md). Report vulnerabilities through [Security](SECURITY.md).

SDK code is licensed under [Apache-2.0](LICENSE), with [third-party notices](THIRD_PARTY_NOTICES.md) for included work.
