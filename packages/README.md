# Package layout

Create implementation directories as their tasks begin:

- `mcp/` — protocol integration and server/view boundaries.
- `components/` — renderer-neutral contracts and shared FaithfulCard behavior.
- `lit/`, `react/`, `lynx/` — renderer adapters and their optional component implementations.

The workspace root is not published. Packages are not yet implemented or installable. Keep server-only modules out of browser entry points; do not introduce renderer or MCP dependencies into the components package. Use coordinated package versions initially, enrolling actual owned versions when introduced.
