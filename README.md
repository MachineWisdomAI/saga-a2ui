# SAGA A2UI

Safe Agentic Generative Applications — by [Machine Wisdom](https://machine-wisdom.ai).

TypeScript middleware for connecting existing services to assistant experiences, with renderer choice, explicit data-sharing rules, and server authorization hooks.

## Status

Repository setup is underway. No SDK packages, runnable example, or host compatibility are available yet. This repository starts private and is intended to become public after a separate publication decision.

The first implementation will exercise a small Lit application in ChatGPT and Claude. React and Lynx remain Stage A targets; Alexa+ enters the initial host investigation.

## Planned packages

| Package | Responsibility |
| --- | --- |
| `@saga-a2ui/mcp` | MCP app integration, data and action boundaries, and protocol error mapping |
| `@saga-a2ui/components` | Optional renderer-neutral component definitions and Markdown behavior, starting with FaithfulCard |
| `@saga-a2ui/lit` | Lit renderer integration |
| `@saga-a2ui/react` | React renderer integration |
| `@saga-a2ui/lynx` | Lynx renderer integration |

Developers retain their normal renderer tools and write the code that calls their APIs. A2A is a later integration; no placeholder package is published.

## Content safety

**Standard** permits validated HTTPS links through the host and images from explicitly allowed HTTPS hosts. **Strict** displays link and image references as inert text. Both preserve ordinary Markdown formatting and retain server authorization and data-sharing checks. Application code controls the policy.

FaithfulCard is planned to display supplied Markdown without rewriting or silent truncation. Ansari-specific branding and presentation rules remain in Ansari.

## Development

This is an npm workspace skeleton; the root is private and is never published. There are no build/test commands until the first implementation establishes a working dependency recipe. See [contributing](CONTRIBUTING.md) and [package layout](packages/README.md).

## License

The SDK uses [Apache-2.0](LICENSE). Preserve applicable third-party licenses and notices when adding dependencies or extracted code.
