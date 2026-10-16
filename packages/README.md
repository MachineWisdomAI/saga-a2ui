# Package layout

Create implementation directories with working consumers as their tasks begin. Follow [the coding standards](../CODING_STANDARDS.md) for module/file placement and typed strategies and visitors.

- `core/` — renderer-independent interfaces, value objects and processing. Keep A2UI parsing and message cases under `src/protocols/a2ui/<version>/`, not in generic utilities or renderer adapters.
- `mcp/` — MCP/MCP Apps delivery, host capabilities and lifecycle, with separate server/view/policy entry points. It consumes core where needed; it does not own visual protocol parsing.
- `components/` — renderer-neutral contracts and shared component behavior.
- `lit/`, `react/`, `lynx/` — renderer adapters and their optional component implementations.

Dependency direction points toward renderer-independent contracts. Core must not depend on MCP, a renderer, or a DOM runtime. MCP and renderer adapters can consume core without depending on one another's implementations; the application connects them. The components package must not depend on MCP or renderers, and core must not require the optional components package. Renderer support for optional components belongs in an optional export.

The workspace root is not published. Packages are not yet implemented or installable. Keep server-only modules out of browser entry points. Use coordinated package versions initially, enrolling actual owned versions when introduced.

The draft [host publication design](../blueprints/features/host_publication.blueprint.md)
proposes `@saga-a2ui/publish` as developer tooling behind the planned SAGA CLI.
It would validate and prepare application packages for host directories, with
host-specific formats kept outside runtime packages. The package and commands
remain unapproved and unimplemented; core, MCP and renderers must not depend on
publication tooling.
