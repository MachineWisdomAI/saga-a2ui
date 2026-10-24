# Package layout

Each package has its own directory here. Follow [the coding standards](../CODING_STANDARDS.md) for module and file placement and for typed strategies and visitors.

## Package names

Package names are flat under the `@saga-a2ui` scope.

| Directory | Package | Registry status |
| --- | --- | --- |
| `core/` | `@saga-a2ui/core` | Public npm |
| `components/` | `@saga-a2ui/components` | Public npm |
| `mcp/` | `@saga-a2ui/mcp` | Public npm |
| `react/` | `@saga-a2ui/react` | Public npm |
| `react-mcp-stack/` | `@saga-a2ui/react-mcp-stack` | Public npm |
| `lit/` | `@saga-a2ui/lit` | Private and unversioned |
| `lit-mcp-stack/` | `@saga-a2ui/lit-mcp-stack` | Private and unversioned |

Five packages are published on public npm: core, components, MCP, React and the React stack. Their source manifests are at `0.7.6-rc.1`. A source version can run ahead of the registry, and a manifest's `publishConfig` only says where a package would be published. The registry's own listing shows what exists there, and [Installing saga a2ui](../docs/public-install.md) gives the versions and tags to install and the recipe verified against them. Local candidate builds exist for all seven packages, including the private Lit packages; see [candidate contents, update and rollback](../docs/candidate-update-and-rollback.md).

`@saga-a2ui/lynx` is retired and has no directory (see [GenUI renderers](#genui-renderers)). Tooling packages take a name only when implemented, and `@saga-a2ui/publish` remains a proposal. There are no aggregate `protocol`, `transport`, `genui` or `tools` packages, and no `a2a` package before a working consumer needs one.

Names are flat because of how npm names work. A scoped name has the form `@scope/name` (see npm's [scope documentation](https://docs.npmjs.com/about-scopes/) and [name validation rules](https://github.com/npm/validate-npm-package-name)), so a nested name such as `@saga-a2ui/genui/lit` is not a publishable package name. A `genui` group package would instead be one package with one version and one set of dependency and peer declarations. That would tie the maturity of the Lit, React and Lynx renderers together and make it harder to keep an application's own catalog free of what it did not choose.

Grouping belongs in the documentation, and bundling belongs in CLI templates, so neither needs a package. Where one concern has several entry points within a package, a subpath groups them: `@saga-a2ui/mcp` uses `/server`, `/view` and `/policy`. Nesting packages in subdirectories is optional and is not done.

## Packages by group

### Core

`core/` holds renderer-independent interfaces, value objects and processing.

- **A2UI protocols.** It owns the A2UI wire-version protocols, including A2UI decoding. Parsing and message cases live under `src/protocols/a2ui/<version>/`, not in generic utilities or renderer adapters. These modules use upstream `@a2ui/web_core` and Zod.
- **Actions.** The shared behavior of the [action binding](../blueprints/modules/action_binding.blueprint.md) module lives in `src/actions/`, exported as `@saga-a2ui/core/actions`. It provides local and server actions, prerequisites, bounded hooks, activation-scoped resources, `subject` freshness, and optional limits with error categories. The [action guide](../docs/actions.md) shows how an application uses them, and the [development reference](../docs/development-reference.md) records their limits. The actions subtree imports no renderer, DOM implementation, MCP runtime or third-party module.
- **Host links.** `@saga-a2ui/core/host-links` is the renderer- and delivery-neutral contract for asking a host to open a validated link (`HostLinks`, `LinkOpenOutcome`, `NO_HOST_LINKS`, `describeLinkOutcome`). The card renderers consume it and MCP delivery supplies an implementation, with no dependency between the two. It imports nothing. Actual-host acceptance and the Lynx adapter are not part of it.

### Delivery

`mcp/` is for MCP and MCP Apps delivery, host capabilities and lifecycle. It has separate `/server`, `/view` and `/policy` entry points. It uses core where needed (the host-link and delivered-result contracts, as types), does not own visual protocol parsing, and never depends on components or a renderer.

`/view` owns every ordering rule of a view. `runToolResultView` installs handlers before `connect`, holds early results until the view is ready, applies the host context before the first result, and ends the view once on dispose, host teardown or `pagehide`. It reports a throwing application callback without rolling its changes back. Beside it sit `hostLinksFromApp`, `startOwnSizing`, `readingProfile` and `deliveredResultFromToolResult`, which maps a tool result onto core's neutral `DeliveredResult` and interprets nothing; the application's definition reads the result.

### GenUI renderers

GenUI here means saga a2ui's graphical A2UI rendering, in which an application's handlers and catalogs supply the interface. It does not require a model to generate it. `lit/` and `react/` are the renderer adapters and hold their optional component implementations.

- **`lit/`** is the only full renderer package. Its optional exports are `@saga-a2ui/lit/actions` (`ActionButton`, `createLitActions`) and `@saga-a2ui/lit/faithful-card` (the Lit FaithfulCard element, its catalog entry and the content-view seam). The main `@saga-a2ui/lit` entry imports neither. `@saga-a2ui/components` is an optional peer, so installing Lit does not install it. The shipped Lit sources declare reactive state with `static properties` and `declare`, not decorators, because an application compiles them with its own settings.
- **`react/`** is not the full renderer. It holds the React action controls (the qualification of the shared action seam), the card slices and the composition capabilities of the view composition design:
  - `@saga-a2ui/react/actions`: `ActionButton`, `ActionButtonEntry`, `InstanceHostProvider`, `useActionSetup`.
  - `@saga-a2ui/react/faithful-card`: `FaithfulCard`, `faithfulCardEntry`, `FaithfulCardProvider`, the card factory and presenting surface, plus the explicit `@saga-a2ui/react/faithful-card.css`.
  - `@saga-a2ui/react/a2ui`: the typed bound surfaces `openSurface` and `Surface`.

  These deliver the named composition capabilities for React as the Lit package does for Lit. They do not by themselves establish full React parity or acceptance in a named host; host runs record the latter. `@saga-a2ui/components` is an optional peer of React as it is of Lit, and the supported React and React DOM are pinned to the one version its tests ran on.
- **Action controls.** Both renderers' controls share the renderer-neutral contract at `@saga-a2ui/core/actions/action-button-schema`.
- **No `lynx/` package exists.** `apps/lynx-fixture` is a retained qualification fixture and a separate project outside the npm workspace (the retired qualification is in the [development reference](../docs/development-reference.md#lynx-action-attachment-qualification-act3)). The owner retired the Lynx delivery chain on 2026-10-19. No `lynx/` package is planned, and the fixture is historical qualification evidence, not a Lynx recipe, adapter or requirement.

### Stacks

A stack package connects one renderer to one delivery, so an application installs one stack plus its framework peers and writes only its own decisions. The two stacks connect a renderer to the MCP Apps bridge:

- `react-mcp-stack/` is public on npm, like core, components, MCP and React.
- `lit-mcp-stack/` is private and unversioned, like Lit.

Each stack has these entries:

- **Main entry.** `startA2uiView`, which imports nothing from components or Markdown, so an own-catalog application's emitted bundle excludes both. It also re-exports the own-catalog authoring surface (`defineSurface`, `z`, the renderer's action helpers).
- **`/faithful-card`.** `startFaithfulCardApp` and the `FaithfulCardApp` definition from components with its one `result` reader, the card's host link and `readingProfile`. React also exports the stylesheet at `/faithful-card.css`.
- **`/content-policy`.** `createContentPolicy` and `embedContentPolicy`, for the application's server composition.
- **`/server`.** Node only. Budgets, operation registration, operation views and request lifetimes, re-exported from `@saga-a2ui/mcp/server`. No browser entry imports it.

An application installs one stack plus its framework peers (`react` and `react-dom`, both singletons, for React; `lit` for the Lit stack) and imports from the stack only. A stack declares components and the MCP Apps bridge as regular dependencies, so its installed tree includes them. That is the correct install result and not a footprint of the bundle.

The two stacks hold the same lifecycle code, copied, not shared. Consumer code (templates, examples, the `apps/lit-host` view modules, starter output, adopters) holds application meaning only. `scripts/consumer-boundary.test.ts` enforces that over an explicit include list, and each package's `exports.test.ts` enforces its own dependency direction. See [the stacks reference](../docs/development-reference.md#the-mcp-stacks-and-the-card-application-e1-e2).

### Components

`components/` holds renderer-neutral contracts and shared component behavior, one optional export per component. Today it has only `@saga-a2ui/components/faithful-card`: the versioned FaithfulCard content contract and reader, Markdown interpretation under a trusted dialect and bound, the content policy and image consent scopes, and the A2UI catalog contract.

The card is passive and accepts no action itself, and this package carries only that first slice: it is not the complete component. An authored control can sit beside the card, and the [development reference](../docs/development-reference.md#the-passive-faithfulcard-and-an-installed-second-consumer-card-prep) records that the pair works from installed packages.

It imports no MCP, renderer, DOM or server API. Its only dependencies are `markdown-it`, `zod`, upstream `@a2ui/web_core` and `@saga-a2ui/core` (for the Zod 3 alias). Each component owns its own contract; the next component does not inherit FaithfulCard's Markdown or policy requirements.

### Tooling

Publication tooling lives in [`scripts/publish/`](../scripts/publish/README.md), loaded only by `saga publish`. It checks a built application and its deployed endpoint, prepares a ChatGPT plugin package or Claude connector dossier, and records the later manual handoff. It deploys, uploads and submits nothing. There is no separate `@saga-a2ui/publish` package; core, MCP and renderers do not depend on this tooling, and applications do not need it at runtime.

## Dependencies and versions

Dependencies point toward renderer-independent contracts.

- Core must not depend on MCP, a renderer or a DOM runtime, and must not require the optional components package.
- MCP and renderer adapters can use core without depending on one another's implementations. A stack package connects them, and the application installs one stack.
- Components must not depend on MCP or renderers. Renderer support for optional components belongs in an optional export.
- Renderers keep independent maturity and independent dependency and peer declarations. A renderer used with an application's own catalog must not pull in the optional components, including `FaithfulCard`, a Markdown parser, or any renderer the application did not select.
- Keep server-only modules out of browser entry points.

The workspace root is not published. Core, components, MCP, React and the React stack use coordinated release versions (one major.minor across every package). Lit and the Lit stack remain unpublished workspace packages. CI also packs the seven implemented packages as a private candidate whose prerelease identity exists only in the packed copy, with every package pinned to its siblings' exact candidate version; see [candidate contents, update and rollback](../docs/candidate-update-and-rollback.md).

The new-project CLI templates and the existing-backend recipes are not packages. The maintained templates are in [`templates/`](../templates/README.md), and the design is in [application setup](https://github.com/MachineWisdomAI/saga-a2ui/blob/b10a8882fa5b15ad9a7243f592e5c3dc086d5340/blueprints/features/application_setup.blueprint.md).
