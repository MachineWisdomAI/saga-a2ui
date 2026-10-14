# Package layout

Create implementation directories with working consumers as their tasks begin. Follow [the coding standards](../CODING_STANDARDS.md) for module/file placement and typed strategies and visitors.

- `core/` — renderer-independent interfaces, value objects and processing. Keep A2UI parsing and message cases under `src/protocols/a2ui/<version>/`, not in generic utilities or renderer adapters.
- `mcp/` — MCP/MCP Apps delivery, host capabilities and lifecycle, with separate server/view/policy entry points. It consumes core where needed; it does not own visual protocol parsing.
- `components/` — renderer-neutral contracts and shared FaithfulCard behavior.
- `lit/`, `react/`, `lynx/` — renderer adapters and their optional component implementations.

Dependency direction points toward renderer-independent contracts. Core must not depend on MCP, a renderer, or a DOM runtime. MCP and renderer adapters can consume core without depending on one another's implementations; the application connects them. The components package must not depend on MCP or renderers, and core must not require the optional components package. Renderer support for optional components belongs in an optional export.

The workspace root is not published. Packages are not yet implemented or installable. Keep server-only modules out of browser entry points. Use coordinated package versions initially, enrolling actual owned versions when introduced.
