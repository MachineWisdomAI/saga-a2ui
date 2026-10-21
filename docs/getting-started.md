# Getting started with SAGA A2UI

This guide takes a developer to a running starter or demonstration, or to a SAGA attachment on a backend they already run. It was written on 2026-10-20 against the repository's current source. Every command and snippet in it is checked by `scripts/guide.test.ts` against the tool, template or package it names, and the existing-backend snippets are generated from the maintained templates, not retyped.

The `@saga-a2ui/core`, `@saga-a2ui/components`, `@saga-a2ui/mcp` and `@saga-a2ui/react` packages are published on public npm at `0.1.0-rc.1`. Use those exact versions together for a registry-based application, with the [React consumer dependency configuration](react-consumers.md) when using React. The packages export TypeScript source for use with a bundler.

The Lit starter and local demo below use matched candidate tarballs built from a source checkout, including `@saga-a2ui/lit`, which is not published on npm. Those candidates have versions of the form `0.0.0-candidate.g<12 hex>` and are not a public registry release. Their installation steps remain separate from the published four-package set. See [candidate installation and updates](candidate-update-and-rollback.md).

Three things are separate throughout, and the guide keeps them apart: what is *implemented and qualified in source* (CI runs it), what has been *observed in a named host* (a few receipts, each for one flow), and what is only a *design sketch* in a Blueprint. A design sketch is never setup instructions.

## Which packages do what

Package names are flat under `@saga-a2ui`. There are no aggregate packages: no `@saga-a2ui/genui`, `protocol`, `transport` or `tools`. Groups exist only in the documentation ([package layout](../packages/README.md)).

| Group | Package | State |
| --- | --- | --- |
| Core | `@saga-a2ui/core` | Implemented. Renderer-independent action contract (`/actions`), the A2UI v0.9 message session (`/protocols/a2ui/v0_9`) and the Zod 3 alias for catalog schemas (`/protocols/a2ui/zod3`). |
| Delivery | `@saga-a2ui/mcp` | Implemented. `/server` (protected operations, verified request identity, one request lifetime), `/view` (the view's connection) and `/policy`. |
| GenUI renderers | `@saga-a2ui/lit`, `@saga-a2ui/react` | Lit is the full renderer. React is a qualification slice only: direct action attachment and the optional FaithfulCard slices, not React parity. A `@saga-a2ui/lynx` package does not exist; Lynx delivery is retired (see below). |
| Components | `@saga-a2ui/components` | Implemented, optional. Only the passive FaithfulCard slice. An application with its own catalog installs none of it. |
| Tooling | none | No tooling package is implemented. `@saga-a2ui/publish` is a proposal in the draft [host publication design](../blueprints/features/host_publication.blueprint.md); there is no such command. `saga init` is a script in this repository, not a package. |

Renderer packages keep independent maturity and peers. The starter uses `core`, `lit` and `mcp`.

## Component, definition, template and instance

Attaching behavior needs five words to mean one thing each. They are the vocabulary of the [action binding design](../blueprints/modules/action_binding.blueprint.md#component-terminology); the notes example (`examples/pack1-consumer/src/notes-surface.ts`) shows all of them:

| Word | What it is | In the notes example |
| --- | --- | --- |
| Component type | A kind of control the application's catalog allows | `ActionButton` |
| Definition | One ID-bearing entry in the layout | `row-archive`, a child of `note-actions` |
| Template | A definition repeated once per data item | `{ componentId: 'note-row', path: '/notes' }` repeats the whole row |
| Rendered instance | One component the renderer created from a definition | The Archive button of the second note's row |
| Data item | The value that instance currently shows | `/notes/1`, read with `event.read('id')` |

The layout gives the markup its IDs and structure and **names no action**. Behavior is decided by application code. A reusable fluent action definition (`Action.local(...)` or `Action.server(...)`, finished with `.build()`) holds no pending state, so one definition can be attached to every instance. Setup finds instances by the layout's own ID (`watchById`), and `bindAction('activate', definition)` attaches the definition to that exact instance (or renderer-owned handle). Each attachment keeps its own state, so two rows pending at once stay apart. Discovery happens at setup, once per presented surface; nothing looks an action up by a string at activation time, and no handler-name table, event bus or registry exists.

The `bind-action` snippet in the [generated recipes](attach-to-existing-backend.md) is the starter's own attachment.

## Install the packages from a candidate

The project `saga init` creates, and every recipe, depends on `@saga-a2ui/*` packages pinned to the exact candidate version of the commit that produced them. A package manager resolves those pins only from that candidate's tarballs, so a plain `npm install` cannot resolve those commit-specific candidate versions from the public registry.

Build the candidate from the checkout that ran `saga init`, then install the tarballs the project uses in one command:

```sh repository
npm ci
npm ci --prefix apps/lynx-fixture
npm run build
npm run candidate:pack -- --out candidate-out
```

The second line is needed because the root build still builds the retained Lynx fixture, which has its own lockfile; it is historical evidence, not a Lynx recipe. The pack writes `candidate-out/packages/saga-a2ui-<package>-<version>.tgz` for the five packages. Then, in the project `saga init` created:

```sh
npm install ./PATH/candidate-out/packages/saga-a2ui-core-VERSION.tgz ./PATH/candidate-out/packages/saga-a2ui-lit-VERSION.tgz ./PATH/candidate-out/packages/saga-a2ui-mcp-VERSION.tgz
```

Replace `PATH` and `VERSION` with your files; the version is the one in the project's `package.json`. A plain `npm install` cannot retrieve these candidate versions from npm; install their tarballs instead. The published `0.1.0-rc.1` versions do not replace the matched candidate set required by this Lit starter. Install every package of the combination you use together, from the same candidate, and keep the `@a2ui/markdown-it` override in your root `package.json` (the starter carries it). [Candidates: contents, update, rollback](candidate-update-and-rollback.md) is the authority for the matched set, the update sequence and rollback; do not update one package alone. CI also uploads each candidate as a workflow artifact.

## Start from the demo

The demonstration is a synthetic, local-only application of one qualified pair, built from packed candidate tarballs outside the repository. It is the fastest way to see the workflow: browse, descriptions at both content levels, protected Play, and the notes actions. It is **not a starter** and not a release download; no hosted copy exists.

```sh repository
npm ci
npm run build:demo
```

```sh demo
npm install --omit=dev
npm start
```

The first block writes `apps/lit-host/dist/demo`; run the second inside it. Open the `Open the demo host page:` address it prints. Node 22.12.0 or newer is required. See the [demonstration README](../demo/lit-node/README.md) for the controls, the environment variables and what each shows.

## Create a new project

`saga init` is a script in this repository, run from a checkout. It creates one new directory from the maintained starter template and installs nothing, runs no package manager and no hook, and never changes anything that already exists.

```sh repository
npx tsx scripts/saga.ts --help
npx tsx scripts/saga.ts init --a2ui-stack lit-mcp --server hono ./my-app
```

`--a2ui-stack` names a renderer plus MCP delivery (`lit-mcp`), never a combined word, and `--server` names the server target. The command prints the next steps; run them inside the new directory, with the candidate tarballs named in the install step as described above:

```sh project
cd my-app
npm install
npm run build
npm start
```

`npm run typecheck` checks the view and the server. `npm start` prints two endpoint addresses: `/status/mcp` is public and reads no credential; `/account/mcp` is protected. **The protected endpoint refuses every credential until you replace `server/verifier.ts`.** The starter ships no identity provider and no account, sample data or test verifier. The [template README](../templates/lit-hono/README.md) lists the files that are yours.

### HTTP defaults

For a new HTTP application, use **stateless MCP** and **prepare the built view once at startup**. A tool invocation does not need a server-side conversation session. Keep conversation history in your application when the product needs it; keep request timeouts, cancellation and verified identity scoped to each request.

The Hono target above supplies routing and middleware through the official `@modelcontextprotocol/hono` adapter. Its Node adapter runs Hono on Node.js: choosing Hono replaces hand-written HTTP plumbing, not the JavaScript runtime. Express and Fastify remain supported choices for an existing backend.

For a modern MCP endpoint, the upstream `createMcpHandler` export from `@modelcontextprotocol/server` accepts a server factory and owns per-request transport creation and cleanup. Its default compatibility path also serves older HTTP clients statelessly. Do not add `Mcp-Session-Id`, a session map, an idle-session sweeper or an SSE replay store to a simple request/answer app. The maintained starter transports likewise use `sessionIdGenerator: undefined`; they do not retain MCP sessions.

Keep deployment work outside that factory:

```text
startup
  read the built HTML
  apply any deployment revision stamp
  validate the view and compute viewUriForHtml(finalHtml)
  retain one immutable OperationView
  open the HTTP listener

HTTP request
  create a server and transport for this request
  register operations with the prepared OperationView
  handle the request with its own identity and lifetime
  release request resources when the response finishes or disconnects
```

Hash the exact UTF-8 HTML bytes that the resource serves, after all stamping. Reuse those bytes and their URI for discovery, tool results and resource reads. Reading, stamping and fingerprinting unchanged HTML on every request adds work and risks inconsistent resource identity. Restart after rebuilding the view. Answer-specific data and answer fingerprints still belong to the individual tool call.

The CLI creates a new directory; it does not migrate an existing application. To move an existing server to Hono, generate a separate Hono starter as a reference or print its snippets, then adapt its HTTP layer while preserving your application's operations, renderer and policy. A Lit starter does not require an existing React application to change renderer.

### Unqualified pairs are refused

`saga init` offers only the pairs CI qualifies and that its own list names: `lit-mcp` on `node`, `express`, `fastify` and `hono`. Asking for another pair exits with status 1 before anything is written, and the message lists the four supported ones:

```sh repository
npx tsx scripts/saga.ts init --a2ui-stack react-mcp --server node ./my-app
```

A template directory existing does not add a pair, and a *qualified* template is not automatically *offered*: the [pair table](attach-to-existing-backend.md#which-pairs-have-a-recipe) shows which pairs have a qualified template and which of them `saga init` offers today (all four). `hapi` has no qualified template, and React has no starter, template or `saga init` pair.

## Attach to an existing backend

Attaching SAGA to a server you already run is a documented integration you make in your own source. **No command performs it, and the CLI never edits an existing application.** The recipes are in [Attach SAGA to an existing backend](attach-to-existing-backend.md). That document is generated from the same maintained, CI-qualified template files `saga init` copies, so an authentication or server snippet is the starter's own text, and a server that is not yet qualified has no recipe. To print the same snippets yourself:

```sh repository
npx tsx scripts/starter-snippets.ts
npx tsx scripts/starter-snippets.ts --template lit-express
```

Additional server slices add their own recipe by joining the qualified inventory and regenerating the recipes (`npm run guide:recipes`); `scripts/guide.test.ts` fails until they do. Hapi is the required slice that has no recipe yet. For Hapi in particular, route authentication does not yet reach the identity hook, so no Hapi identity handoff is described here.

## Content policy

A view that shows supplied Markdown (the optional FaithfulCard) does so under one **trusted content policy** that the application chooses in its own server code. Neither the model nor the supplied content sets it.

- **Standard** permits validated HTTPS links through the host, and images from explicitly allowed HTTPS hosts.
- **Strict** keeps every link inert, shows blocked fragments as accessible placeholders (or inert text) that the reader can reveal as text, and loads a permitted image only after the reader chooses **Show images**. Consent is revoked by a new result or by closing the view.

Both keep ordinary formatting and both retain server authorization and data-sharing checks. The starter itself shows no Markdown: its view is served with the closed policy `CLOSED_VIEW_CSP` from `@saga-a2ui/mcp/policy`, which allows no network or external resource. Ansari's branding and presentation rules stay with Ansari.

### Rebuild and resource matching

A view is served as an MCP App resource whose address is `ui://sha256/<digest>.html`, the SHA-256 of the exact bytes served. A view that embeds a policy has an address that depends on that policy, so **changing the policy or rebuilding the view changes the address**. Rebuild the view from the installed packages, restart the server so it serves the rebuilt view, and pair a server only with the view built beside it. A view that meets a result it does not understand shows that the view and its server are from different builds instead of rendering it. `npm run candidate:identity` prints the identities for a given policy.

## Identity and the evidence behind it

The application authenticates the request and its server decides what the account may see; SAGA carries the verified result. In the starter, `server/listener.ts` verifies the request, hands the result to the transport, and the operation reads it with `identityOf`. No tool argument can name an account, a prior call authorizes nothing, and two overlapping requests each see their own identity.

**Synthetic versus real identity.** The demonstration's sign-in choices are fixed public development credentials printed in the source (`apps/lit-host/src/mcp/dev-auth.ts`). They prove nothing about a person, the page and the process say so, and the process refuses `NODE_ENV=production`. They are not a model for production. A real host uses its supported authentication through your own `OAuthTokenVerifier`, and a loopback run says nothing about it.

**Evidence is several different things.** A claim is only as wide as the check that supports it:

| Evidence | It shows | It does not show |
| --- | --- | --- |
| Invocation | An action ran against an instance, with its prerequisites, hooks and outcome | That the control was visible, or that a host delivers the gesture |
| Rendering | A view displayed content under a policy in the local host fixture | Rendering in ChatGPT, Claude or Alexa+ |
| Authentication | A request with an accepted, refused or absent credential was admitted or refused | An OAuth or DCR flow, or any real identity provider |
| Audio | The local audio clock advanced | Audio in a remote host |

Named-host receipts exist for a few specific flows and are recorded in [host compatibility observations](2026-10-19_host-compatibility-observations_v1.md). The starter, the demonstration and this guide have not been run in an actual assistant host.

## Actions

The attachment above is the whole of what this guide teaches. [Change a component and trace allowed and denied requests](actions.md) is where the details belong: it changes a component and its action, then traces input, prerequisites, verified identity, authorization, delivery and cleanup, with every case run. This section is the short version.

The verified **non-playback** example is the notes application: `examples/pack1-consumer/src/notes-actions.ts` defines Archive once and `notes-view.ts` attaches it to each rendered row. The demonstration serves it behind the starter's own authentication, and its README shows each outcome:

- **Asynchronous prerequisites.** Checking that the session is still valid is a prerequisite that runs before the handler. If it refuses, no protected request is sent.
- **Outcome hooks.** Success, failure and cancellation each have a hook that reports what that outcome establishes. A timeout or an unreadable reply is *unknown*, not "nothing happened".
- **Application resource ownership.** A hold the application takes for a press is given back on every non-success end and handed to its owner only after the server confirms. The application owns it, not the binding.

Two limits matter before you rely on a client-side control:

- **A client check does not authorize a protected server operation.** The server decides again for every protected request; a prerequisite only saves a request.
- **Cancellation does not undo remote effects.** Closing a view stops the client waiting. It does not tell the server to stop, and an applied write stays applied. Uncertain writes are not retried automatically.

Defaults, kept separate: action work 30 seconds and each hook or cleanup 5 seconds; server operations 3 seconds inside a 10-second request budget that starts before authentication. Invalid explicit settings fail, and a stage never resets its parent's budget.

## What is implemented and what is not

| Area | Implemented, qualified in source | Not done or not shown |
| --- | --- | --- |
| Shared action contract | `@saga-a2ui/core/actions`, with the opt-in Lit and React `ActionButton` controls; Play runs on it | A registry or handler-name table, which do not exist |
| Lit | The full renderer, installed from packed tarballs; the starter, demonstration and notes example | Windows |
| React | **Direct action attachment** (`@saga-a2ui/react/actions`, ACT2) and the optional FaithfulCard text and image-consent slices, from the same tarballs; the notes browse and Play run through React in a local fixture host | **Installed parity** (E15): no React starter, template, CLI pair, demonstration or authenticated-recipe is claimed |
| Server targets | `node`, `express`, `hono`, `fastify` qualified with `lit-mcp` | `hapi`; no full matrix; `saga init` offers `node`, `express`, `fastify` and `hono`; the standalone demonstration is the Node application only |
| Lynx | Nothing. Lynx delivery was retired on 2026-10-19; `apps/lynx-fixture` and the Lynx proposals in the Blueprints are **historical** designs and evidence, with no delivery promise, no recipe and no adapter | Any current Lynx setup |

A renderer is qualified by running its own lifecycle, not by declaring that it could: a type declaration that compiles is not a working setup claim, and no renderer is forced through a Lit-specific lifecycle (custom elements and `createA2uiAppElement`). React attaches through its own provider and hook; the shared contract is renderer-neutral.

<!-- react -->
### React applications

Use SAGA's React A2UI entry point for public surface and catalog APIs. Do not add direct dependencies on `@a2ui/react` or `@a2ui/web_core`, or import their catalog or surface APIs yourself:

```ts
import {A2uiSurface, Catalog, type ReactCatalogComponent} from '@saga-a2ui/react/a2ui';
```

`@saga-a2ui/react/a2ui` is the supported surface. Keep React and React DOM as your declared peers, pin `@a2ui/markdown-it` 0.2.1 at the consumer root, and keep the separate Zod majors apart: [the React consumer dependency guide](react-consumers.md) is the recipe. Any later React pair exposure keeps its own renderer qualification.
<!-- /react -->

## Friction recorded while writing this guide

These are recorded, not hidden, and none is a gate. No developer other than the author has followed this guide yet; non-author availability is not a new acceptance requirement.

- `saga init` prints a plain `npm install`, but the candidate pins it writes cannot be resolved from a registry, so the reader has to name the tarballs. Building the matching candidate takes a full `npm run build`.
- Four server templates qualify, and `saga init` offers all four. The standalone demonstration is still the Node application only, so `saga demo` refuses `express`, `hono` and `fastify`.
- The existing-backend snippets call starter files that are not shown inline (`server/authenticate.ts`, `server/identity.ts`, `server/verifier.ts`, `server/authorization.ts`). The reader must read them in the template.
- The Lit starter and demonstration are built from a checkout. The four public packages include their own READMEs; their React integration recipe is in [Installing the React renderer with MCP](react-consumers.md).
- Checking the demo commands needs the built download (`npm run build:demo`) to exist first.

## Where to go next

- The attach recipes: [Attach SAGA to an existing backend](attach-to-existing-backend.md).
- The command that creates a project, and its safety rules: `scripts/saga.ts` and the "Creating a project with `saga init` (CLI1)" section of the [development reference](development-reference.md#creating-a-project-with-saga-init-cli1).
- The action contract in depth: the [action binding design](../blueprints/modules/action_binding.blueprint.md) and [The action contract across the current codebase (ACT7)](development-reference.md#the-action-contract-across-the-current-codebase-act7).
- The design this guide implements: the [application setup Blueprint](../blueprints/features/application_setup.blueprint.md).
