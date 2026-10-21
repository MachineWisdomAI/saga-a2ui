---
feature_name: view_composition
status: draft
module_blueprints: []
dependencies: [reusable_lit_adapter, reusable_mcp_connector, content_safety_levels, application_setup]
date_added: 2026-10-21
---

# SDK-owned view composition

## Status

- Design: draft. The owner's approval is recorded in a status-only follow-up commit that pins this revision.
- Implementation: not started. Target release `0.7.0`, developed on the integration branch `feat/v0.7-composition`.
- Length: above the 1,000-word guide because one design fixes the package layout, five layers for two renderers and partial amendments to three approved Blueprints.

<!-- Maintain this section using ../README.md#lifecycle-and-revision-records. Record completed scope as Blueprint <design SHA> implemented at <code repository>@<landed code SHA>, with review/verification links and remaining gaps. -->

## Problem and current behavior

Inspected at `MachineWisdomAI/saga-a2ui@00e23b080493432250c9ae84c90385f5e5acc4f9` and the Ansari Faithful Answers application (`app/ansari-faithful-answers`, 21 October 2026 revision `5acba0e`).

The React package stops at `A2uiSurface`, `FaithfulCardProvider` and `faithfulCardEntry`; everything above that is re-typed by each consumer. Hand-authored A2UI opening messages appear in four templates, three examples, `apps/lit-host` and Ansari; the `connectToolResultView` handshake (hold a result until ready, latest wins, retire before dispose, `pagehide`) in four templates, three examples and Ansari; the policy-in-document transport and `createContentView` in four places each. `createA2uiAppElement` takes `initialInput: unknown`. Ansari styles 31 rules against `.saga-card` internals and walks the card's DOM to find its attribution paragraph, because the card promises nine CSS variables and no class names. The examples are labelled development checks, yet they are the de facto API: Ansari's `main.tsx` is 133 lines, about 25 of them its own decisions.

## Proposed behavior

Before, the application owns every ordering rule:

```ts
const answer = openAnswerSurface(); // hand-written createSurface, updateComponents, updateDataModel
let ready = false, pending; // hold a result until the handshake and the fonts finish
window.addEventListener('pagehide', () => { retire(); connection?.dispose() ?? app.close(); });
```

After, it states only what is its own:

```tsx
import {FaithfulCardApp} from '@saga-a2ui/components/faithful-card';
import {startFaithfulCardApp} from '@saga-a2ui/react-mcp-stack/faithful-card';

const definition = FaithfulCardApp.define({name: BRANDING.name, version: APP_VERSION})
  .reader({dialect: 'commonmark-tables-strikethrough', maxLength: CARD_MAX_UTF16_UNITS})
  .policy('document')
  .result(answerEnvelope, env => ({markdown: env.answer, heading: env.question}))
  .texts({waiting: BRANDING.waitingText, connectFailure: BRANDING.connectFailureText})
  .build();

await startFaithfulCardApp(definition, {
  container: document.getElementById('root'),
  readyWhen: signal => loadKitab(document, signal),
  sizing: 'own',
  hostContext: (context, host) => applyAnsariTheme(document.documentElement, context, host),
  chrome: ({card, state}) => <AnswerView card={card} state={state} />,
});
```

`build()` validates once and returns an immutable value. `start` reads the embedded policy and fails closed on an invalid one, opens the card surface, connects the MCP bridge with handlers installed before `connect`, holds the latest result until the handshake and `readyWhen` finish, revokes image consent before each presentation, applies host context on handshake and on every change, and on teardown or `pagehide` retires the view before disposing the connection. A Lit application uses the same definition with `@saga-a2ui/lit-mcp-stack/faithful-card`.

## Responsibilities and interfaces

Stack packages are the decision. `@saga-a2ui/react-mcp-stack` and `@saga-a2ui/lit-mcp-stack` each connect one renderer to one delivery; `@saga-a2ui/{react,lit}-a2a-stack` follow later. An application installs exactly one stack and inherits the adapters and core transitively, so `@saga-a2ui/react` and `@saga-a2ui/mcp` stay independent of each other. Each stack has a components-free main entry (`startA2uiView`, for own-catalog applications) and a `/faithful-card` subpath (`startFaithfulCardApp`) with `@saga-a2ui/components` as an optional peer. `@modelcontextprotocol/ext-apps` becomes a stack dependency; no consumer imports it. This amends [package layout](../../packages/README.md): "the application connects them" becomes "a stack package connects them; the application installs one stack", and the own-catalog rule extends to stack main entries. The CLI's `--a2ui-stack lit-mcp` maps to `@saga-a2ui/lit-mcp-stack`.

| Layer | Owner | Proposed interface |
| --- | --- | --- |
| A. Surface authoring | `@saga-a2ui/core/protocols/a2ui/v0_9` | `defineSurface({surfaceId, catalogId, data, root, components?, initial})` → `SurfaceLayout<TData>` with `opening` and typed, validated `update(data)`; `data` is a Zod 3 schema. One root over a flat data model plus an explicit component list; generated messages pass through the existing decoder. Not a binding engine. |
| B. Bound surface | `@saga-a2ui/react/a2ui`; `@saga-a2ui/lit` | React: `openSurface(layout, catalog)` → `BoundSurface<TData>` (opaque handle, `update`, `selection`, `dispose`) and `<Surface of={handle}/>`. Lit: `createA2uiAppElement` takes a `SurfaceLayout` (amends the Lit adapter's `initialInput: unknown`). `SurfaceModel`, `createMessageSession`, the decoder and `IngestResult` leave consumer code. `selection` advances on every update, so an equal answer is still a new selection. |
| C. FaithfulCard conveniences | `@saga-a2ui/components/faithful-card`; `@saga-a2ui/react/faithful-card`; `@saga-a2ui/lit/faithful-card` | Components: `contentPolicyFromEmbedded(text)`, `documentContentSecurityPolicies(doc)` and `contentPolicyFromDocument(doc)` over structural parameter types (no DOM import); a documented, versioned styling surface for both renderers; a closing-paragraph seam (`data-saga-closing="paragraph"`). Both renderers: `createFaithfulCardView({dialect, maxLength, policy, hostLinks, document})`, `openFaithfulCardSurface()` and a host-link helper (`useHostLink` / `bindHostLink`). |
| D. Delivery and transport | `@saga-a2ui/core`; `@saga-a2ui/mcp/view`; `@saga-a2ui/components/faithful-card`; `@saga-a2ui/mcp/server` | Core: `HostLinks` and `LinkOpenOutcome` move here from components, shared by delivery and components without a dependency between them. mcp/view: `runToolResultView({app, transport, readyWhen, onToolResult, onHostContext, onTeardown})` (amends the connector's `connectToolResultView`), `hostLinksFromApp`, `startOwnSizing`, `readingProfile` (neutral enum; host names cited from the host-compatibility observations). Components: pure `embedContentPolicy(html, policy)`, the one owner of the transport format. mcp/server: `operationViewFromHtml({html, filename, title, csp})` with a structural CSP value, so mcp never imports components. |
| E. Card app | `@saga-a2ui/components/faithful-card` (E1); the stacks (E2) | E1: `FaithfulCardApp.define(...).reader(...).policy(...).result(schema, map).texts(...).build()`, pure, neutral to renderer and delivery, reusable by a future A2A stack. E2: `startFaithfulCardApp(definition, {container, readyWhen, sizing, hostContext, chrome})` and `startA2uiView`, idempotent per container. |

Below these layers ownership is unchanged: core imports no MCP, renderer or DOM; mcp never depends on components or a renderer; components imports no DOM, MCP or renderer; renderer packages consume core and components. Only a stack package connects a renderer to a delivery. Consumer code (templates, examples, `apps/`, adopters) holds application meaning only; a source scan over those directories enforces it, with `// saga-boundary: <reason>` as the reviewable exemption. Every versioned package shares one major.minor; patch may vary.

## Failure and recovery

| Trigger | Outcome |
| --- | --- |
| Embedded policy absent, malformed or invalid | Absent means Standard with empty lists; otherwise `start` fails closed and shows the application's failure text. No view mounts on a guessed policy. |
| Result delivered before the handshake or `readyWhen` completes | Held; a later result replaces it; the latest is shown once when ready. |
| Result rejected by the application's contract or by the surface | The shown answer clears, the failure text shows, image consent is revoked; the next valid result recovers. |
| Host teardown or `pagehide` | Retire (consent, host-context hook, unmount) before the connection is disposed; later results reach nothing. |
| `readyWhen` rejects | Connection disposed and the failure text shown, distinct from a connect failure. |
| Builder misuse (missing identity, unknown policy source, `start` twice on one container) | `build()` or `start` throws naming the field; nothing mounts. |

## Verification outcomes

| Condition | Observable result |
| --- | --- |
| A known-bad consumer line (`createSurface:`, an import from `@modelcontextprotocol/ext-apps`, `addEventListener('toolresult'`, `pagehide`) and a near-miss | The scan reports the bad line and not the near-miss; zero hits across `templates/`, `examples/`, `apps/` and doc snippets; one `// saga-boundary:` line exempts one file. |
| Glue lines per consumer, before and after migration | Counts recorded here. |
| Lifecycle scenarios in the browser, both stacks | Early result, teardown during pending, host theme change, font gate, own sizing and invalid policy behave per the failure table. |
| Policy transport negative tests | CSP after a script, malformed JSON, `<` in configuration and a missing `<head>` fail closed; a round-tripped policy equals the original. |
| Packed install outside the workspace | The own-catalog consumer carries no components or Markdown parser; the FaithfulCard consumer renders through the stack's subpath; `mw-version.py check` shows one major.minor across all packages. |
| Ansari adopts the stack | Its browser suite passes unchanged; `main.tsx` holds only application decisions. |

## Implementation sequence

On `feat/v0.7-composition`: the shared-version policy and branch CI first; A in core with the Lit adapter and the templates' `surface.ts` as consumers; B in React; D with the lit-host and template `view.ts` as consumers; C in both renderers; E1 and the two stack packages with `react-card-consumer`, `answer-consumer` and `pack1-consumer` as consumers; the remaining migrations, deletions, the scan and documentation; then one `feat!:` merge to `main` at `0.7.0-rc.1`, promotion and release. Ansari adopts the published `0.7.0`.

## Open decisions

- Whether `BoundSurface` exposes an opaque handle for `<Surface>` or only the component.
- Whether the closing-paragraph seam is a DOM marker or an `onInterpreted` callback.
- Whether a stateless-handler lifetime helper for Node and Hono (the Hapi precedent) ships in 0.7.

## References

- [Package layout](../../packages/README.md), [coding standards](../../CODING_STANDARDS.md)
- [Reusable Lit adapter](reusable_lit_adapter.blueprint.md), [reusable MCP connector](reusable_mcp_connector.blueprint.md), [content safety levels](content_safety_levels.blueprint.md), [application setup](application_setup.blueprint.md)
- [Host compatibility observations](../../docs/2026-10-19_host-compatibility-observations_v1.md)
- Consumers: `examples/react-card-consumer`, `examples/answer-consumer`, `examples/pack1-consumer`, `templates/lit-*`, `apps/lit-host`
