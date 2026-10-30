---
feature_name: own_catalog_attribution
status: approved
module_blueprints: []
dependencies: [hosted_tic_tac_toe]
date_added: 2026-10-30
---

# A removable credit for React own-catalog applications

## Status

- Design: approved on 30 October 2026 by the operator's delegation of this showcase's delivery decisions, not by a human review of this revision. The delegation covered the concrete interface, styling and removal behavior; [the pull request that introduced this file](https://github.com/MachineWisdomAI/saga-a2ui/pull/353) is the design revision, landed at [`9476d8099c4aeff38ecfbe80b2fd6976cd5c1729`](https://github.com/MachineWisdomAI/saga-a2ui/blob/9476d8099c4aeff38ecfbe80b2fd6976cd5c1729/blueprints/features/own_catalog_attribution.blueprint.md). Per that delegation, the pull request's independent review stands in for human sign-off.
- Implementation: **Blueprint `9476d8099c4aeff38ecfbe80b2fd6976cd5c1729` implemented at `MachineWisdomAI/saga-a2ui@9476d8099c4aeff38ecfbe80b2fd6976cd5c1729`** ([PR #353](https://github.com/MachineWisdomAI/saga-a2ui/pull/353)). `SagaAttribution` (`@saga-a2ui/react/attribution`), its stylesheet and the React stack's `host.links` landed there, with unit, export-graph and bridge tests and the Chromium spec `apps/lit-host/e2e/attribution.spec.ts`. The tic-tac-toe example is its first consumer (see [hosted Tic Tac Toe](hosted_tic_tac_toe.blueprint.md#status)).
- Acceptance: package publication, installation from the registry and any actual host's display of the credit remain open. A local browser run is not host evidence.

This design replaces an earlier, never-approved proposal for a FaithfulCard-centred credit (`card`, `app` and `none` placements on the card provider). Lit parity, a logo, telemetry and default-on insertion are not part of it.

## Problem and current behavior

An application built on SAGA with its own catalog, such as the hosted Tic Tac Toe game, has no way to credit the framework. The only link-opening rules in the React package belong to the FaithfulCard (`useHostLink`), which needs a card view, a content policy and the components package. An application that never renders a card should not install any of that to say "Built with saga a2ui".

## Proposed behavior

```tsx
import { SagaAttribution } from '@saga-a2ui/react-mcp-stack';
import '@saga-a2ui/react-mcp-stack/attribution.css';

// In the application's own footer; `links` is `host.links` from the actions factory.
<footer><SagaAttribution links={links} /></footer>
```

This renders one small line, "Built with saga a2ui", whose name is a button. Pressing it asks the host to open `https://saga-ai.dev/`. Removing the credit means deleting that element. No option, account or payment is involved, and the credit never appears unless the application renders it.

`SagaAttribution` takes optional, trusted props: `links` (the host's way to open a link), `prefix` (default "Built with"), `name` (default "saga a2ui") and `href` (default `https://saga-ai.dev/`). The application's own code supplies all of them; answer, tool and catalog data never do.

## Responsibilities and interfaces

| Owner | Responsibility |
| --- | --- |
| `@saga-a2ui/react/attribution` | The component, its stylesheet and the rules below. It imports only React and the renderer-neutral `@saga-a2ui/core/host-links`, so it carries no card, Markdown parser or components package. |
| React stack | Re-exports the component and stylesheet, and gives the actions factory `host.links` (the Lit stack already does), bound to the view's lifetime. |
| Application | Chooses where the credit goes and whether it exists, once per page or per card. It passes `links`; the SDK never mounts the credit itself. |

Decisions and reasons:

- **A component, not a provider setting.** Placement is the application's layout concern. A provider option would need a default, nesting rules and deduplication; deleting an element needs none.
- **Host links only.** The name is a button that calls `links.open`. Without `links` the credit is text followed by its destination, and nothing navigates, as in a page with no host. A plain anchor would navigate a sandboxed MCP view by itself.
- **Fail closed on configuration.** A destination that is not an absolute `https:` URL without credentials leaves plain text and no destination. Blank text falls back to the defaults. Text is rendered as text, never as markup.
- **Styling.** Inherited font and colour, 0.875rem, no badge or animation, a visible focus outline, all rules under `.saga-attribution`. Tokens `--saga-attribution-font-size`, `-text-color`, `-link-color` and `-margin` override it.
- **Required notices stay.** Removing the credit removes no licence notice or answer-source attribution; those are not part of this component.

## Failure and recovery

| Condition | Result |
| --- | --- |
| The host denies, cannot open or fails the request | The credit stays; a status line says so and shows the destination as text. |
| Pressed again while a request is pending | No second request. |
| Host, destination or component changes, or the view ends, before the answer | The late answer is dropped. |
| Host throws | Treated as a failed request. |

## Verification outcomes

- Rendering makes no request and sends nothing to the host (unit and browser).
- One activation sends exactly one request for the configured destination; repeated presses while pending add none (unit, with a mutation check).
- Each non-opened outcome yields its sentence with the destination; a late answer after removal or replacement changes nothing.
- Unacceptable destinations (`http:`, `javascript:`, `data:`, credentials, relative, malformed, empty) yield no control and no request.
- The component's module graph holds no card, components or Markdown module; the stack's main entry stays free of components.
- In Chromium: 14px text, inherited light and dark colours, a solid 2px focus outline on keyboard focus, activation by Enter, and no overflow at 240px in a right-to-left page.
- Through a real MCP Apps bridge, `host.links` reaches the host's open-link handler once and reports `unavailable` after the view ends.

Still required elsewhere: the hosted game's credit in both target hosts, where the host's own link handling decides what a reader sees.

## References

[Hosted Tic Tac Toe](hosted_tic_tac_toe.blueprint.md), [React consumers](../../docs/react-consumers.md#removable-credit), `packages/react/src/attribution/` and `apps/lit-host/e2e/attribution.spec.ts`.
