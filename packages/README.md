# Package layout

Create implementation directories with working consumers as their tasks begin. Follow [the coding standards](../CODING_STANDARDS.md) for module/file placement and typed strategies and visitors.

## Package names

Package names are flat under the `@saga-a2ui` scope: `@saga-a2ui/core`, `@saga-a2ui/mcp`, `@saga-a2ui/components`, `@saga-a2ui/lit`, `@saga-a2ui/react` and `@saga-a2ui/lynx`. Tooling packages take a name only when implemented; `@saga-a2ui/publish` remains a proposal. There are no aggregate `protocol`, `transport`, `genui` or `tools` packages, and no `a2a` package before a working consumer needs one.

Flat names follow from how npm names work. A scoped name has the form `@scope/name` (see npm's [scope documentation](https://docs.npmjs.com/about-scopes/) and [name validation rules](https://github.com/npm/validate-npm-package-name)), so a nested name such as `@saga-a2ui/genui/lit` is not a publishable package name. A `genui` group package would instead be one package with one version and one set of dependency and peer declarations. That would tie the maturity of the Lit, React and Lynx renderers together and make it harder to keep an application's own catalog free of what it did not choose.

Grouping belongs in the documentation and bundling belongs in CLI templates, so neither needs a package. Where one concern has several entry points within a package, a subpath groups them. The proposed `@saga-a2ui/mcp` package would do this with `/server`, `/view` and `/policy`. Moving packages into nested directories is optional and is not done now. Names are fixed before the first npm publish. Nothing is published now.

## Packages by group

### Core

`core/` (implemented, private) holds renderer-independent interfaces, value objects and processing. It owns the A2UI wire-version protocols, including A2UI decoding, and keeps parsing and message cases under `src/protocols/a2ui/<version>/`, not in generic utilities or renderer adapters. The shared behavior of the [action binding](../blueprints/modules/action_binding.blueprint.md) module lives in its own subtree, `src/actions/`, exported as `@saga-a2ui/core/actions`. It is provisional and implements only the ACT1 subset (see the README's "Direct action attachment (ACT1)"); it imports no renderer, DOM implementation, MCP runtime or third-party module.

### Delivery

`mcp/` is for MCP/MCP Apps delivery, host capabilities and lifecycle. It would provide separate `/server`, `/view` and `/policy` entry points. It consumes core where needed; it does not own visual protocol parsing.

### GenUI renderers

GenUI here means SAGA's graphical A2UI rendering, in which an application's handlers and catalogs supply the interface. It does not require a model to generate it. `lit/`, `react/` and `lynx/` are the renderer adapters and hold their optional component implementations. `lit/` is the only one implemented; its opt-in action control and setup (`ActionButton`, `createLitActions`) are the optional `@saga-a2ui/lit/actions` export, which the main `@saga-a2ui/lit` entry does not import. No `react/` or `lynx/` package exists: `apps/lynx-fixture` is a retained qualification fixture and a separate project outside the npm workspace, not that package (see the README's "Lynx action attachment qualification (ACT3)").

### Components

`components/` holds renderer-neutral contracts and shared component behavior.

### Tooling

No tooling package is implemented. The draft [host publication design](../blueprints/features/host_publication.blueprint.md) proposes `@saga-a2ui/publish` as optional developer tooling behind the planned SAGA CLI. It would validate and prepare application packages for host directories, with host-specific formats kept outside runtime packages. The package and commands remain unapproved and unimplemented. Core, MCP and renderers must not depend on publication tooling, and an application's runtime does not need it.

## Dependencies and versions

Dependency direction points toward renderer-independent contracts. Core must not depend on MCP, a renderer, or a DOM runtime. MCP and renderer adapters can consume core without depending on one another's implementations; the application connects them. The components package must not depend on MCP or renderers, and core must not require the optional components package. Renderer support for optional components belongs in an optional export.

Renderers keep independent maturity and independent dependency and peer declarations. A renderer used with an application's own catalog must not pull in the optional components, including `FaithfulCard`, a Markdown parser, or any renderer the application did not select.

The workspace root is not published. `core/`, `lit/` and `mcp/` are implemented as private, unreleased workspace packages (no version, not installable from a registry); the other packages are not yet implemented. Keep server-only modules out of browser entry points. Use coordinated package versions initially, enrolling actual owned versions when introduced.

The new-project CLI templates and the existing-backend recipes are not packages. They are described in [application setup](https://github.com/MachineWisdomAI/saga-a2ui/blob/b10a8882fa5b15ad9a7243f592e5c3dc086d5340/blueprints/features/application_setup.blueprint.md).
