# Build the notes application with Lit

This is the Lit track. It starts after the [setup guide](getting-started.md): you have installed the packages or built the candidate tarballs, and you know which renderer and server you are using. The React track is [Build tic-tac-toe with React](build-tic-tac-toe-with-react.md); it builds a different application, so you do not need this page to follow it.

The track is organised around the notes application (`examples/pack1-consumer`): a list of notes, each with an Archive control that the server authorizes. It shows how a Lit view is composed with the stack, how identity reaches an operation, and where the evidence for each claim stops. Run the demonstration first to see the finished application, read how the view is composed, then continue to the [action guide](actions.md), which changes a component and traces allowed and denied requests.

## Start from the demo

The demonstration is a synthetic, local-only application of one qualified pair, built from packed candidate tarballs outside the repository. It is the fastest way to see the workflow: browse, descriptions at both content levels, protected Play, and the notes actions. It is **not a starter** and not a release download; no hosted copy exists.

Use a source checkout with Node 22.23.3 or newer (the repository toolchain minimum). From its root:

```sh repository
npm ci
npm run build:demo
```

```sh demo
npm install --omit=dev
npm start
```

The first block writes `apps/lit-host/dist/demo`; run the second inside it. Open the `Open the demo host page:` address it prints. The generated demo itself requires Node 22.12.0 or newer. Choose Alice in the local host page, open Notes, and press Archive on a note. The row reports the archive result. End the notes session and try another Archive: the prerequisite refuses and no archive request is sent. These are synthetic local credentials, not a production identity flow.

See the [demonstration README](../demo/lit-node/README.md) for the controls, the environment variables and what each shows.

## Compose a view with a stack

An application installs one stack plus its framework peers and writes only what is its own. The stack connects to the host, holds a result that arrives before the view is ready (the latest wins), gives each result to the application, and ends the view once, before the connection ends, when the host tears it down, `dispose()` runs or the page goes away. A raw `pagehide` listener is not needed for any of that; the application keeps one only for behavior that is its own.

The Lit starter's composition is this. It is excerpted line for line from `templates/lit-node/src/view.ts`, and `scripts/guide.test.ts` fails when a line stops being there or when the call omits an option `createLitActions` requires. The layout is in `surface.ts` and the catalog in `catalog.ts`. `requireElement`, `say`, `show` and `retire` are the application's own helpers in the same file: what a result means and what ending the view takes with it. `retire` ends only what the application owns. The surface owns the discovery and the bindings made in `attach`, and ends them when it leaves the page, before the stack calls `onTeardown`.

```ts
import {
  ActionButton,
  createLitActions,
  startA2uiView,
} from '@saga-a2ui/lit-mcp-stack';

const view = startA2uiView({
  container: requireElement('starter-app'),
  layout: starterSurface,
  catalog: starterCatalog,
  identity: { name: 'saga-starter-view', version: '0.0.0' },
  actions: createLitActions({
    attach: (surfaceView) => {
      surfaceView.watchById(
        CLEAR_ID,
        ActionButton,
        (handle) => void handle.bindAction('activate', actions.clearNote),
      );
    },
    onSetupError: () => say(PROBLEM_TEXT),
  }),
  onToolResult: (result, running) => show(result, running.surface),
  onTeardown: retire,
});
await view.ready;
```

`attach` runs once for each presented surface and binds the application's action to the control it finds. `onSetupError` is required: it receives the error of a setup that throws, and the page shows only the safe fallback while the text goes to your callback. In `show`, `surface.update({ headline })` validates the data against the layout and applies it in place: the mounted controls, their bindings and focus survive, and a rejected update changes nothing. A card application states a validated definition instead (`FaithfulCardApp.define(...)`) and starts it with `startFaithfulCardApp` from `@saga-a2ui/lit-mcp-stack/faithful-card` or `@saga-a2ui/react-mcp-stack/faithful-card`. Neither stack asks the application to write A2UI messages, to import the MCP Apps bridge, or to order the handshake; the repository's consumer boundary scan (`scripts/consumer-boundary.test.ts`) fails a template, example or view module that does. The catalog is written against the stack's own exports too (`A2uiLitElement`, `basicCatalog`, `Catalog`, `CommonSchemas`, `z`), so an application that installs the stack names no upstream renderer or schema package.

A stack's installed tree includes `@saga-a2ui/components` and `markdown-it` as its declared dependencies; the emitted bundle of an application that uses only the main entry does not (the card entry is where they are used). The [React consumer dependency guide](react-consumers.md) has the React recipe and the registry-versus-candidate distinction.

## Content policy

A view that shows supplied Markdown (the optional FaithfulCard) does so under one **trusted content policy** that the application chooses in its own server code. Neither the model nor the supplied content sets it.

- **Standard** permits validated HTTPS links through the host, and images from explicitly allowed HTTPS hosts.
- **Strict** keeps every link inert, shows blocked fragments as accessible placeholders (or inert text) that the reader can reveal as text, and loads a permitted image only after the reader chooses **Show images**. Consent is revoked by a new result or by closing the view.

Both keep ordinary formatting and both retain server authorization and data-sharing checks. The starter itself shows no Markdown: its view is served with the closed policy `CLOSED_VIEW_CSP` from `@saga-a2ui/mcp/policy`, which allows no network or external resource. Ansari's branding and presentation rules stay with Ansari.

### Rebuild and resource matching

A view is served as an MCP App resource whose address is `ui://views/<filename>.<32-character-sha256-prefix>.html`, the SHA-256 of the exact bytes served. A view that embeds a policy has an address that depends on that policy, so **changing the policy or rebuilding the view changes the address**. Rebuild the view from the installed packages, restart the server so it serves the rebuilt view, and pair a server only with the view built beside it. A view that meets a result it does not understand shows that the view and its server are from different builds instead of rendering it. `npm run candidate:identity` prints the identities for a given policy.

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

Named-host receipts exist for a few specific flows and are recorded in [host compatibility observations](host-compatibility.md). The starter, the demonstration and this guide have not been run in an actual assistant host.

## Actions

The attachment above is the whole of what this guide teaches. [Change a component and trace allowed and denied requests](actions.md) is where the details belong: it changes a component and its action, then traces input, prerequisites, verified identity, authorization, delivery and cleanup, with every case run. This section is the short version.

The verified **non-playback** example is the notes application: `examples/pack1-consumer/src/notes-actions.ts` defines Archive once and `notes-view.ts` attaches it to each rendered row. The demonstration serves it behind the starter's own authentication, and its README shows each outcome:

- **Asynchronous prerequisites.** Checking that the session is still valid is a prerequisite that runs before the handler. If it refuses, no protected request is sent.
- **Outcome hooks.** Success, failure and cancellation each have a hook that reports what that outcome establishes. A timeout or an unreadable reply is *unknown*, not "nothing happened".
- **Application resource ownership.** A hold the application takes for a press is given back on every non-success end and handed to its owner only after the server confirms. The application owns it, not the binding.

Two limits matter before you rely on a client-side control:

- **A client check does not authorize a protected server operation.** The server decides again for every protected request; a prerequisite only saves a request.
- **Cancellation does not undo remote effects.** Closing a view stops the client waiting. It does not establish that the host forwarded cancellation or that the server stopped, and an applied write stays applied. Uncertain writes are not retried automatically.

Defaults, kept separate: action work 30 seconds and each hook or cleanup 5 seconds; server operations 3 seconds inside a 10-second request budget that starts before authentication. Invalid explicit settings fail, and a stage never resets its parent's budget.

## What is implemented and what is not

| Area | Implemented, qualified in source | Not done or not shown |
| --- | --- | --- |
| Shared action contract | `@saga-a2ui/core/actions`, with the opt-in Lit and React `ActionButton` controls; Play runs on it | A registry or handler-name table, which do not exist |
| Lit | Published renderer and MCP stack: typed surfaces, actions and FaithfulCard applications; packed-consumer checks cover the starter, demonstration and notes example | Starter and local fixture results do not establish every application or host combination; Windows is not qualified here |
| React | Published renderer and MCP stack: typed surfaces, actions and FaithfulCard applications; packed-consumer and browser checks cover own-catalog notes and branded answer cards. Bounded notes observations in Claude/ChatGPT are recorded in [host compatibility](host-compatibility.md) | One generated React starter, `react-mcp` on Hono; no other React server pair and no React demonstration. Qualification of a particular application and host remains specific to its built artifact; no complete host matrix is claimed |
| Server targets | `node`, `express`, `hono`, `fastify`, `hapi` qualified with `lit-mcp`; `hono` qualified with `react-mcp` | No full matrix; `saga init` offers those six pairs; the standalone demonstration is the Lit and Node application only |
| Lynx | Nothing. Lynx delivery was retired on 2026-10-19; `apps/lynx-fixture` and the Lynx proposals in the Blueprints are **historical** designs and evidence, with no delivery promise, no recipe and no adapter | Any current Lynx setup |

A renderer is qualified by running its own lifecycle, not by declaring that it could: a type declaration that compiles is not a working setup claim, and no renderer is forced through a Lit-specific lifecycle (custom elements and `createA2uiAppElement`). React attaches through its own provider and hook; the shared contract is renderer-neutral.

<!-- react -->
### React applications

For MCP delivery, use `@saga-a2ui/react-mcp-stack` and its exports, as in the [complete React application](react-consumers.md#follow-a-complete-react-application). If you deliberately compose below the stack, use SAGA's React A2UI entry point for public surface and catalog APIs. Do not add direct dependencies on `@a2ui/react` or `@a2ui/web_core`, or import their catalog or surface APIs yourself:

```ts
import {A2uiSurface, Catalog, type ReactCatalogComponent} from '@saga-a2ui/react/a2ui';
```

`@saga-a2ui/react/a2ui` is the supported surface. Keep React and React DOM as your declared peers, pin `@a2ui/markdown-it` 0.2.1 at the consumer root, and keep the separate Zod majors apart: [the React consumer dependency guide](react-consumers.md) is the recipe. Any later React pair exposure keeps its own renderer qualification.
<!-- /react -->

## Where to go next

- Change a component and trace allowed and denied requests: the [action guide](actions.md). It is the next step of this track.
- Install, create a project, serve over HTTP or attach to an existing backend: the [setup guide](getting-started.md).
- Build a different application with the React stack: [Build tic-tac-toe with React](build-tic-tac-toe-with-react.md).
- Where each host has been observed to work: [host compatibility](host-compatibility.md).
