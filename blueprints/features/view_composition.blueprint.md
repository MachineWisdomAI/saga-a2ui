---
feature_name: view_composition
status: draft
module_blueprints: []
dependencies: [reusable_lit_adapter, reusable_mcp_connector, content_safety_levels, application_setup]
date_added: 2026-10-21
---

# SDK-owned view composition

The application states what its domain data means; the SDK composes how that data is rendered and delivered. An application installs one stack package, `@saga-a2ui/react-mcp-stack` or `@saga-a2ui/lit-mcp-stack`, plus its framework peers, and imports from the stack only. The SDK holds no domain schema and hardcodes no answer schema.

## Status

This draft, proposed in [PR #237](https://github.com/MachineWisdomAI/saga-a2ui/pull/237), awaits one human-owner decision on the final independently reviewed commit and grants no implementation approval. Until then the three earlier design approvals stay current: the baseline ([`db83e84a`](https://github.com/MachineWisdomAI/saga-a2ui/blob/db83e84a7d8d6d9527c5ab350472e82809afd609/blueprints/features/view_composition.blueprint.md)), the revision ([`4b1215a4`](https://github.com/MachineWisdomAI/saga-a2ui/blob/4b1215a4d588f537e93e8a4099cdfc5268a26ab3/blueprints/features/view_composition.blueprint.md)) and the correction ([`49e39bdb`](https://github.com/MachineWisdomAI/saga-a2ui/blob/49e39bdb434f5848ded9c042e425c5cefe735b31/blueprints/features/view_composition.blueprint.md)). The correction is implemented at `MachineWisdomAI/saga-a2ui@18153793795d4ecfc12d2785d96422d2e397a3b2` via [PR #234](https://github.com/MachineWisdomAI/saga-a2ui/pull/234). The repairs in this draft have not landed.

Main (`a4ec1ab`) holds the SDK source integration; the five public packages remain at `0.7.0-rc.1` and stable promotion is held. Two historical pieces of evidence are separate: the motivating consumer's rehearsal against a packed candidate from `20b370df`, and the SDK's own qualification of a packed candidate from `a4ec1ab`. Neither qualifies these repairs or proves acceptance in a named host. The full approval, review, delivery and Hapi history is in the immutable [prior record at `fe4e256a026f266291ff039fbe1cd0f667c06fbc`](https://github.com/MachineWisdomAI/saga-a2ui/blob/fe4e256a026f266291ff039fbe1cd0f667c06fbc/blueprints/features/view_composition.blueprint.md).

## Ownership and example

The SDK owns the ordering between rendering and delivery; the application owns every domain schema and the whole-result logic. Dependencies point one way. Core imports no MCP, renderer or DOM. Among SDK packages, MCP and components depend on core, not on one another or on the renderers; renderer packages consume core and components. `@saga-a2ui/react` and `@saga-a2ui/mcp` stay independent; only a stack connects a renderer to a delivery.

The starter template becomes a minimal application like this one. The surface is defined once, and the stack mounts it and routes each tool result to the application's update. The id constants are application-owned.

```ts
const CLEAR_ID = 'clear';
const layout = defineSurface({
  surfaceId: 'starter', catalogId: CATALOG_ID,
  data: z.object({headline: z.string()}), initial: {headline: ''},
  root: {component: 'Column', bind: {}, props: {children: ['headline', CLEAR_ID]}},
  components: [
    {id: 'headline', component: 'Line', kind: 'title', text: {path: '/headline'}},
    {id: CLEAR_ID, component: 'ActionButton', child: 'clear-label'},
    {id: 'clear-label', component: 'Line', kind: 'title', text: 'Clear'},
  ],
});
const view = startA2uiView({
  container, layout, catalog: starterCatalog,
  onToolResult: (result, {surface}) => surface.update({headline: headlineFor(result)}),
});
await view.ready;
```

## Layers

**A. Surface authoring** (`@saga-a2ui/core/protocols/a2ui/v0_9`). `defineSurface({surfaceId, catalogId, data, root, components?, initial})` returns a `SurfaceLayout<TData>` holding the opening messages and typed, validated `update(data)` messages. `data` is a Zod 3 schema. `root` is one component object `{component, bind, props}` with no `id` and no top-level `children`; child ids go in `props`. `components` lists the rest. The root is never a string id and never repeats a root id.

**B. Bound surface** (`@saga-a2ui/react/a2ui`, `@saga-a2ui/lit`). In React, `openSurface(layout, catalog)` returns a `BoundSurface<TData>` with `update(data)` and `dispose`, rendered by `<Surface of={handle}/>`. In Lit, `createA2uiAppElement({catalog, layout, actions?})` builds an element that exposes `updateData(data)`. Each connect creates a default session from catalog and layout using the SDK decoder; injecting a session is an optional advanced choice. An update validates against the layout schema and applies in place, so mounted controls, focus, component state and action bindings survive. A rejected update returns `{ok: false, failure}` in both renderers, with `failure` as `{kind, message}`, and changes nothing. Presenting an equal answer again is a selection, not an update (layer C).

**C. Card conveniences** (`@saga-a2ui/{react,lit,components}/faithful-card`). Both renderers provide `createFaithfulCardView({dialect, maxLength, policy, contentSecurityPolicies, hostLinks})`, `openFaithfulCardSurface()` (a `CardSurface` with `present(content)` and `clear()`) and a host-link helper (React `useHostLink`, Lit `bindHostLink`). The stack reads the document, including the embedded policy and the CSP meta values, and passes them in; the renderer establishes image enforcement from them and takes no document.

`present` revokes image consent, retires late link and image outcomes of the previous presentation and advances a presentation token, even for equal text. Rejected content leaves the previous presentation in place.

The public semantic content set includes `strong`, `em` and `hr`. No weight, size or colour is imposed on `strong` or `em`, and a closing strong footer inherits the footer treatment. `hr` is a divider, and one divider remains possible. The closing marker `data-saga-closing="paragraph"` goes on the final top-level block only when it is a paragraph; a trailing list, quote or table gets none, nested paragraphs are never marked, and the SDK gives the marker no attribution meaning. The private `data-testid` and `data-annotation` attributes are not styling contracts; styling follows the [faithful-card styling guide](../../docs/faithful-card-styling.md).

**D. Delivery and transport.** Core owns `HostLinks`, `LinkOpenOutcome` and `DeliveredResult`. `@saga-a2ui/mcp/view` provides `runToolResultView`, `hostLinksFromApp`, `startOwnSizing` and `readingProfile`. `@saga-a2ui/mcp/server` provides `operationViewFromHtml` with a structural CSP value, so mcp never imports components. Components owns the one policy transport pair, `embedContentPolicy(html, policy)` and `contentPolicyFromEmbedded(text)`:

- The configuration JSON writes every less-than sign as the six ASCII characters backslash, `u`, `0`, `0`, `3`, `c`, and JSON decoding restores it. A `</script>` inside a value stays inert, and a round trip returns an equal policy.
- The charset meta, if any, comes first, then the CSP meta and the configuration script, all before any other script. Insertion is immediately after `<head …>`, or after a `<meta charset>` only when that meta is head's first element.
- Rejected: no `<head>`, any `<script` before the insertion point, a charset meta after a script, and a double quote in the CSP value.

**E. Card application.** E1, in `@saga-a2ui/components/faithful-card`, is `FaithfulCardApp.define(identity).reader(...).policy('document').result(read).texts({waiting, problem, connectFailure, readyFailure, policyFailure}).build()`, an immutable value that `build()` validates once. The result reader is `read: (DeliveredResult) => {kind: 'content', content} | {kind: 'rejected', text?}`, specified below. E2, in the stacks, is `startFaithfulCardApp(definition, {container, readyWhen, sizing, hostContext, chrome, onError})` and `startA2uiView({container, layout, catalog, actions, readyWhen, sizing, hostContext, onToolResult, onError})`. Each returns `{ready, dispose}` at once, and the A2UI view also exposes its `BoundSurface`. A second start on a busy container throws `container-busy` and keeps the first view. Builder or start misuse throws naming the field and leaves a running view alone.

## Whole-result reading

`DeliveredResult` is `{isError: boolean, content: ContentBlock[], structuredContent?: unknown}`. `content` keeps every block in delivered order. Each block keeps its `type`; a text block also keeps its `text`, and any other block is opaque and carried as supplied. `structuredContent` is unchecked, and an absent field, a present `null` and malformed data stay distinct. MCP view maps `ToolResult` to this value, and the stacks pass it unchanged to the definition's single `result` reader; there is no `classifyResult` override.

Schema, fallback and wording belong to the application's reader, and the SDK enforces none of them. The motivating application's reader keeps these rules, in order of precedence:

- An error result rejects with zero cards, even beside valid structured content. Its text is its first usable error text, otherwise the application's unsupported wording.
- For any other result, the text comes from the first text block, which is then tested for a nonempty string; an empty first text block is not skipped.
- Absent or `null` structured data may show the application's exact fallback text with an empty heading.
- Present but malformed structured data, or an empty answer, rejects even beside fallback text.

The stack owns what follows. A rejection, or content the card rejects, clears the stale card, image consent and link state, then shows the rejection text, or `texts.problem` when there is none. A reader that throws is reported with phase `result` and gets the same clearing and `texts.problem`; so does a throwing result map. The next valid result recovers.

## Startup and failure

Startup runs in order: policy, handlers installed, bridge connect, then `readyWhen`. The negotiated host context is applied before `readyWhen` and before anything is shown. The font gate receives an abort signal. A result that arrives before `ready` is held, a later one replaces it, and only the latest is shown, once, when the view is ready. Each failure rejects `ready` with its own kind:

- An absent policy means Standard with empty lists. A malformed or invalid policy gives kind `policy` and shows `texts.policyFailure`; no view mounts on a guessed policy.
- A connect rejection gives kind `connect` and shows `texts.connectFailure`.
- A `readyWhen` rejection disposes the connection and gives kind `ready` and `texts.readyFailure`.
- An application callback that throws during startup completes connection, listener and sizing cleanup, then gives kind `application`.
- `dispose()`, teardown or `pagehide` during startup aborts the readiness signal, drops held results and gives kind `disposed`. It shows nothing, and a late readiness outcome never remounts, delivers or shows a failure.

Teardown in any state retires consent, the host-context hook and the unmount once, before the connection closes. Cleanup runs even when `onTeardown`, the chrome unmount or the reporter throws, and never skips connection disposal. It releases the container and removes the `pagehide` listener, so a later `pagehide` calls no retired callback and a restart works.

After `ready`, a throwing callback is reported to `onError(error, phase)`, which defaults to `console.error`. The rest of that event's work is skipped and what the callback already changed stays, because the stack cannot roll back application side effects. A throwing ordinary host-context callback leaves the view running with its listeners in place.

## Exports and installation

Each stack's convenience entries export exactly these sets, re-exporting existing owners, so browser imports reach no server module and server imports reach no browser code:

- `content-policy`: `createContentPolicy`, `embedContentPolicy`; types `ContentPolicy`, `CreatePolicyResult`, `PolicyConfiguration`, `PolicyFailure`.
- `server`: `attachRequestLifetime`, `createServerBudgets`, `operationViewFromHtml`, `registerPublicOperation`, `viewUriForHtml`; types `OperationView`, `RequestLifetime`.
- Card entry: React `useHostLink`, `HostLink`, `HostLinkOutcome`; Lit `bindHostLink`, `HostLinkBinding`, `HostLinkOutcome`; both the `readingProfile` function and the `ReadingProfile` type, and the definition, content, outcome and card startup contracts.

The general A2UI main entry exports the `readingProfile` function, the `ReadingProfile` type and the delivery callback types it needs, and nothing card-specific, so it never depends on components. Its catalog authoring exports follow the types supported consumers use.

Components and markdown-it are expected in an installed full application, but the emitted browser graph of an own-catalog application excludes components, markdown-it and the server entry. Server-only consumers keep `@saga-a2ui/mcp/server` and install without a renderer. A renderer-named stack keeps its renderer install and peer obligations even for its `server` subpath, which makes no renderer-free promise; full applications such as Ansari may use it.

Host aliases cover `HTMLFragmentWrapper`, the retained Alexa and mobile reading cases and Echo Show classes. `echo_show` and `echo_show_15` match a whole underscore-separated word, not a substring. These are recorded observations, not fresh host acceptance.

## Open decision

Whether a stateless-handler lifetime helper for Node/Hono ships, following the Hapi precedent in the prior record, is unresolved. This draft does not settle it.

## Acceptance

Acceptance is a working Ansari build on the latest `0.7.x` release candidate, covering font gate, branding and attribution, consent reset, sizing, and failure and recovery. Its behavioral assertions stay, and mechanical selector changes are recorded as a before-and-after mapping. Stable promotion, publication and host acceptance need their own evidence. The checks below are separate; passing one does not stand in for another.

- **Boundary scan.** One known-bad consumer line per rule is reported, and the near-misses (a `before` fence, an excluded fixture, an exempted line naming its rule, a `pagehide` listener) are not. The include list covers consumer source, documentation and server code, with zero hits. Consumers may not import `@modelcontextprotocol/ext-apps` or `@saga-a2ui/mcp/view`, nor use A2UI wire literals, `createMessageSession`, `a2uiV0_9Decoder` or `IngestResult`. The supported `@saga-a2ui/mcp/server` is allowed, and blanket `@a2ui` imports are prohibited except qualified catalog authoring under justified, reviewed-line exemptions.
- **Exports and directions.** Each stack subpath export set is tested individually, apart from the dependency-direction check.
- **Install and bundle.** Both recipes (one stack plus framework peers) install isolated and from packed tarballs, with one React instance and the stack's declared dependencies present. Separately, the own-catalog emitted browser graph and runtime import graph exclude components, markdown-it and the server entry.
- **Result reading.** Every reader rule runs through both stacks: an error beside valid structured content, an empty first text block, absent versus `null` versus malformed structured data, and a reader that throws with phase `result`.
- **Browser lifecycle, both stacks.** Early result, dispose during startup, late readiness outcome, duplicate start, restart after dispose, font gate with `readyFailure`, invalid policy, and a host-context callback that changes a CSS variable then throws (error reported, change left, cleanup intact). Pagehide removal after a throwing cleanup is checked in startup and after `ready`.
- **Branding in a stack-started card.** Computed styles for `strong` (including a closing strong footer), `em`, `hr`, the closing marker, right-to-left text and fonts match layer C.
- **Update versus selection.** An own-catalog label update keeps the control, binding and focus; presenting an equal answer again resets consent.

## Replacement scope

If approved, this text replaces the prior layer E result signature and stack options, the whole-result amendment row, the classifier-based verification paragraph, and the "Result unsupported" and result-related "Application callback throws" failure clauses. It also carries the export, host-alias and styling corrections and the Lit `updateData` and root-shape corrections. Other approved clauses remain current.
