# saga a2ui

**Bring your services to AI assistants and agents, including Alexa+, ChatGPT, Claude and more, with less engineering work.**

Saga combines robust foundations from [Google's A2UI project](https://a2ui.org/) with [Machine Wisdom AI](https://machine-wisdom.ai)'s production and safety expertise, designed to fit your existing API platform. It is a framework for building agentic apps with A2UI and MCP Apps.

## Build the experience your customers need

Your team knows what customers should be able to do with your service. Saga provides the application foundations for turning those tasks into interactive experiences, from browsing content to taking an action through an existing API. The aim is to give your team a head start and reduce the custom application code it has to maintain as these experiences evolve.

A2UI describes the interface, its data bindings and updates. Saga connects that model to rendered components, user actions and the application's lifecycle, with MCP Apps providing the connection to the host. You can build on that foundation while keeping your own services, authentication and business rules. The [host compatibility guide](docs/2026-10-19_host-compatibility-observations_v1.md) describes the workflows tested in individual assistants.

## What Saga provides

### Interfaces and actions built on A2UI

Render an interface from A2UI messages and update it as application data changes. Bind a button to a typed action that runs locally or calls your backend. Saga manages the action's connection to the view, including what happens when a result arrives after the view has changed or closed.

The [action guide](docs/actions.md) follows a notes application through these interactions, showing how the same application contract serves different views.

### Integration with your existing API platform

Start with a Node, Express, Fastify or Hono backend, or [add Saga to an existing service](docs/attach-to-existing-backend.md). Saga carries the verified request identity through to your application, where your server checks permissions and performs the operation.

Application processing, MCP integration, components and React bindings have separate packages, so you can choose the parts your application uses and review their dependencies. The [package guide](packages/README.md) explains their responsibilities and how they fit together.

### Content controls for the application you are building

Saga's [FaithfulCard component](docs/react-consumers.md) presents Markdown in a styled card, preserving the supplied answer and its source attribution. It renders that answer directly, without asking the host LLM to paraphrase it for display.

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

The [core](https://www.npmjs.com/package/@saga-a2ui/core), [MCP](https://www.npmjs.com/package/@saga-a2ui/mcp), [React](https://www.npmjs.com/package/@saga-a2ui/react) and [components](https://www.npmjs.com/package/@saga-a2ui/components) packages are available on npm at `0.1.0-rc.1`. They export TypeScript source for applications that use a bundler. See the [React integration guide](docs/react-consumers.md) for imports and dependency configuration.

- [Action guide](docs/actions.md): connect interactions to application behavior.
- [Development reference](docs/development-reference.md#local-development): build and test the SDK.
- [Candidate updates and rollback](docs/candidate-update-and-rollback.md): keep installed packages and views together.
- [Blueprints](blueprints/README.md#find-a-design): explore the architecture and component contracts.
- [Building with Saga](ADOPTERS.md): IASER's Ansari integration and how to share your application.

## Why I built Saga

*Younes Abouelnagah, founder of Machine Wisdom AI*

Working on Headspace for Alexa+ inspired Saga. Getting the production integration working took attention away from the application itself, and the player remained bespoke. I evaluated other approaches, but couldn't find one that fit our existing API platform and the dependency-review requirements we worked within. We built the integration in-house.

I wanted robust application foundations that another team could adopt within the platform it already operated. I chose A2UI for its application model and the engineering behind it, with MCP Apps providing host integration. Saga brings those pieces together with the application behavior I wanted to reuse on the next project.

My perspective on content safety comes from AMP and Gmail Add-ons, alongside five years as a Principal Engineer in Roblox Trust and Safety. That experience informs how Saga handles displayed content and the choices it leaves with the application developer.

[Amazon's announcement of Headspace's Alexa+ integration](https://developer.amazon.com/zh/alexaplus/blogs/2026/07/alexa-plus-new-ways-to-build-experiences) describes the project that inspired this work.

## Work with Machine Wisdom AI

[Machine Wisdom AI](https://machine-wisdom.ai) maintains Saga and offers production AI engineering and architecture engagements. If you are bringing an existing service to AI assistants and agents, [get in touch about your project](https://machine-wisdom.ai).

We welcome fixes, reproducible bug reports, application examples and contributions to the A2UI and MCP Apps ecosystem. [Open an issue](https://github.com/MachineWisdomAI/saga-a2ui/issues/new/choose) or read [Contributing](CONTRIBUTING.md). Report vulnerabilities through [Security](SECURITY.md).

SDK code is licensed under [Apache-2.0](LICENSE), with [third-party notices](THIRD_PARTY_NOTICES.md) for included work.
